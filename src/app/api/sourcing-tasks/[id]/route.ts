import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { getUserIdentityWithLookup } from '@/lib/role-filter';

// PUT /api/sourcing-tasks/[id] - 更新寻源任务（仅 buyer）
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);
    const body = await request.json();

    // 仅 buyer 可以更新寻源任务
    if (role !== 'buyer') {
      return NextResponse.json(
        { error: '只有 Buyer 可以更新寻源任务' },
        { status: 403 }
      );
    }

    const taskId = parseInt(id, 10);
    if (isNaN(taskId)) {
      return NextResponse.json({ error: '无效的任务 ID' }, { status: 400 });
    }

    // 获取当前任务
    const { data: existing, error: fetchError } = await client
      .from('sourcing_tasks')
      .select('*')
      .eq('id', taskId)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: '寻源任务不存在' }, { status: 404 });
    }

    // 校验状态：只能更新 pending 或 in_progress 状态的任务
    if (!['pending', 'in_progress'].includes(existing.status)) {
      return NextResponse.json(
        { error: `无法更新状态为 ${existing.status} 的任务` },
        { status: 400 }
      );
    }

    // 构建更新数据
    const updateData: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    // 1. 分配供应商
    if (body.supplierId !== undefined || body.supplierSnapshot !== undefined) {
      if (body.supplierId) {
        // 查询供应商快照
        const { data: supplier } = await client
          .from('suppliers')
          .select('name, code')
          .eq('id', body.supplierId)
          .single();

        updateData.target_supplier_id = body.supplierId;
        updateData.target_supplier_snapshot = supplier?.name || body.supplierSnapshot || '';
      } else if (body.supplierSnapshot) {
        updateData.target_supplier_snapshot = body.supplierSnapshot;
      }
    }

    // 2. 更新需求描述
    if (body.requirementText !== undefined) {
      updateData.requirement_text = body.requirementText;
    }

    // 3. 更新截止日期
    if (body.dueDate !== undefined) {
      updateData.due_date = body.dueDate;
    }

    // 4. 更新状态
    if (body.status !== undefined) {
      const validStatuses = ['pending', 'in_progress', 'completed', 'cancelled'];
      if (!validStatuses.includes(body.status)) {
        return NextResponse.json(
          { error: `无效状态: ${body.status}，可选值: ${validStatuses.join(', ')}` },
          { status: 400 }
        );
      }
      updateData.status = body.status;
    }

    // 5. 更新寻源结果
    if (body.result !== undefined) {
      updateData.result = body.result;
    }

    // 6. 完成寻源（快捷操作）
    if (body.complete === true) {
      if (!body.supplierId && !existing.target_supplier_id) {
        return NextResponse.json(
          { error: '完成寻源任务必须指定供应商' },
          { status: 400 }
        );
      }
      updateData.status = 'completed';
      updateData.result = body.result || '寻源完成';
      updateData.updated_at = new Date().toISOString();

      // 如果有 PR 行，更新其进度
      if (existing.pr_line_id) {
        await client
          .from('purchase_request_lines')
          .update({
            progress: 'sourced',
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.pr_line_id);
      }
    }

    // 执行更新
    const { data: updated, error: updateError } = await client
      .from('sourcing_tasks')
      .update(updateData)
      .eq('id', taskId)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating sourcing task:', updateError);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // 记录审计日志
    await client.from('audit_logs').insert({
      entity_type: 'sourcing_task',
      entity_id: taskId,
      action: 'update',
      actor,
      actor_role: role,
      detail: {
        task_number: existing.task_number,
        changes: body,
        previous_status: existing.status,
        new_status: updateData.status,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        id: updated.id,
        taskNumber: updated.task_number,
        status: updated.status,
        targetSupplierId: updated.target_supplier_id,
        targetSupplierSnapshot: updated.target_supplier_snapshot,
        result: updated.result,
        updatedAt: updated.updated_at,
      },
    });
  } catch (error: any) {
    console.error('Error in update sourcing task:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// GET /api/sourcing-tasks/[id] - 获取寻源任务详情
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const { role } = await getUserIdentityWithLookup(request);

    // 仅 buyer 和 manager 可以查看详情
    if (role !== 'buyer' && role !== 'manager') {
      return NextResponse.json(
        { error: '只有 Buyer 或 Manager 可以查看寻源任务详情' },
        { status: 403 }
      );
    }

    const taskId = parseInt(id, 10);
    if (isNaN(taskId)) {
      return NextResponse.json({ error: '无效的任务 ID' }, { status: 400 });
    }

    const { data: task, error } = await client
      .from('sourcing_tasks')
      .select('*')
      .eq('id', taskId)
      .single();

    if (error || !task) {
      return NextResponse.json({ error: '寻源任务不存在' }, { status: 404 });
    }

    // 手动查询关联数据（sourcing_tasks 表没有外键约束，Supabase 无法自动 join）
    let prData = null;
    let materialData = null;
    let supplierData = null;

    if (task.pr_id) {
      const { data: pr } = await client
        .from('purchase_requests')
        .select('id, pr_number, applicant, reason')
        .eq('id', task.pr_id)
        .single();
      prData = pr;
    }

    if (task.material_id) {
      const { data: mat } = await client
        .from('materials')
        .select('id, code, name, unit')
        .eq('id', task.material_id)
        .single();
      materialData = mat;
    }

    if (task.target_supplier_id) {
      const { data: sup } = await client
        .from('suppliers')
        .select('id, name, code, contact, email')
        .eq('id', task.target_supplier_id)
        .single();
      supplierData = sup;
    }

    // 格式化返回
    return NextResponse.json({
      data: {
        id: task.id,
        taskNumber: task.task_number,
        prId: task.pr_id,
        prNumber: prData?.pr_number,
        prApplicant: prData?.applicant,
        prReason: prData?.reason,
        prLineId: task.pr_line_id,
        materialId: task.material_id,
        materialCode: materialData?.code,
        materialName: materialData?.name || task.material_snapshot,
        materialUnit: materialData?.unit,
        requirementText: task.requirement_text,
        targetSupplierId: task.target_supplier_id,
        targetSupplierName: supplierData?.name || task.target_supplier_snapshot,
        targetSupplierCode: supplierData?.code,
        targetSupplierContact: supplierData?.contact,
        targetSupplierEmail: supplierData?.email,
        status: task.status,
        dueDate: task.due_date,
        result: task.result,
        createdBy: task.created_by,
        createdAt: task.created_at,
        updatedAt: task.updated_at,
      },
    });
  } catch (error: any) {
    console.error('Error in get sourcing task:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
