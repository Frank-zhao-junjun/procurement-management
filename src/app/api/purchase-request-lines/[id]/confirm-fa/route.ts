import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { numberGenerators } from '@/storage/database/number-generator';
import { getUserIdentity, canCreatePO, type Role } from '@/lib/role-filter';

// PUT /api/purchase-request-lines/[id]/confirm-fa - 确认 FA 匹配并创建 PO
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const { actor, role } = getUserIdentity(request);
    const body = await request.json();

    const confirmed = body.confirmed !== false;
    const faId = body.faId;  // 可选，如果不传则使用之前推荐的

    // 获取 PR 行信息
    const { data: prLine, error: lineError } = await client
      .from('purchase_request_lines')
      .select('*, purchase_requests(*)')
      .eq('id', parseInt(id, 10))
      .single();

    if (lineError || !prLine) {
      return NextResponse.json({ error: 'PR line not found' }, { status: 404 });
    }

    if (confirmed) {
      // 确认 FA 匹配
      let targetFaId = faId || prLine.matched_fa_id;
      
      if (!targetFaId) {
        return NextResponse.json({ error: 'No FA matched. Please match first.' }, { status: 400 });
      }

      // 获取 FA 信息
      const { data: fa, error: faError } = await client
        .from('framework_agreements')
        .select('*')
        .eq('id', targetFaId)
        .single();

      if (faError || !fa) {
        return NextResponse.json({ error: 'FA not found' }, { status: 404 });
      }

      // 更新 PR 行状态
      await client
        .from('purchase_request_lines')
        .update({
          progress: 'matched_protocol',
          material_id: fa.material_id,
          material_snapshot: fa.material_snapshot,
          match_confirm: 'confirmed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', parseInt(id, 10));

      // 记录审计日志
      await client.from('audit_logs').insert({
        entity_type: 'purchase_request_line',
        entity_id: parseInt(id, 10),
        action: 'confirm_fa',
        actor,
        actor_role: role,
        detail: {
          fa_id: targetFaId,
          fa_number: fa.fa_number,
          unit_price: fa.unit_price,
        },
      });

      // 自动创建 PO（如果用户请求）
      if (body.autoCreatePO) {
        const poResult = await createPOFromFAMatch(client, prLine, fa, actor, role);
        
        if (poResult.success) {
          return NextResponse.json({
            success: true,
            prLineUpdated: true,
            poCreated: true,
            poId: poResult.poId,
            poNumber: poResult.poNumber,
          });
        }
      }

      return NextResponse.json({
        success: true,
        prLineUpdated: true,
        poCreated: false,
      });
    } else {
      // 拒绝 FA 匹配，创建寻源任务
      await client
        .from('purchase_request_lines')
        .update({
          match_confirm: 'rejected',
          matched_fa_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', parseInt(id, 10));

      // 创建寻源任务
      const taskNumber = await numberGenerators.sc();
      const { data: sourcingTask, error: scError } = await client
        .from('sourcing_tasks')
        .insert({
          task_number: taskNumber,
          pr_id: prLine.request_id,
          pr_line_id: prLine.id,
          material_id: null,
          material_snapshot: prLine.requirement_text,
          requirement_text: prLine.requirement_text,
          status: 'pending',
          created_by: actor,
        })
        .select()
        .single();

      if (!scError && sourcingTask) {
        await client
          .from('purchase_request_lines')
          .update({
            progress: 'sourced',
            sourcing_task_id: sourcingTask.id,
            updated_at: new Date().toISOString(),
          })
          .eq('id', parseInt(id, 10));
      }

      // 记录审计日志
      await client.from('audit_logs').insert({
        entity_type: 'purchase_request_line',
        entity_id: parseInt(id, 10),
        action: 'reject_fa_create_sc',
        actor,
        actor_role: role,
        detail: {
          sourcing_task_id: sourcingTask?.id,
          task_number: taskNumber,
        },
      });

      return NextResponse.json({
        success: true,
        sourcingTaskCreated: !!sourcingTask,
        taskNumber: taskNumber,
      });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// 从 FA 匹配创建 PO
async function createPOFromFAMatch(
  client: any,
  prLine: any,
  fa: any,
  actor: string,
  role: string
): Promise<{ success: boolean; poId?: number; poNumber?: string; error?: string }> {
  try {
    // 生成 PO 编号
    const poNumber = await numberGenerators.po();

    // 获取 PR 行最晚期望日期
    let deliveryDate = prLine.purchase_requests?.expected_delivery_date;

    // 创建 PO
    const { data: po, error: poError } = await client
      .from('purchase_orders')
      .insert({
        po_number: poNumber,
        supplier_id: fa.supplier_id,
        supplier_snapshot: fa.supplier_snapshot,
        delivery_date: deliveryDate,
        status: 'draft',
      })
      .select()
      .single();

    if (poError || !po) {
      return { success: false, error: poError?.message || 'Failed to create PO' };
    }

    // 创建 PO 行
    const { error: lineError } = await client
      .from('purchase_order_lines')
      .insert({
        order_id: po.id,
        line_number: 1,
        pr_id: prLine.request_id,
        pr_line_id: prLine.id,
        material_id: fa.material_id,
        material_snapshot: fa.material_snapshot,
        quantity: prLine.quantity,
        unit_price: fa.unit_price,
        total_price: parseFloat(fa.unit_price) * parseFloat(prLine.quantity),
        received_qty: 0,
        pending_qty: prLine.quantity,
        status: 'ordered',
        fa_id: fa.id,
      });

    if (lineError) {
      // 回滚 PO
      await client.from('purchase_orders').delete().eq('id', po.id);
      return { success: false, error: lineError.message };
    }

    // 更新 PR 行状态
    await client
      .from('purchase_request_lines')
      .update({
        progress: 'ordered',
        purchase_order_id: po.id,
        po_line_number: 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', prLine.id);

    // 记录审计日志
    await client.from('audit_logs').insert({
      entity_type: 'purchase_order',
      entity_id: po.id,
      action: 'create_from_fa',
      actor,
      actor_role: role,
      detail: {
        po_number: poNumber,
        fa_id: fa.id,
        pr_line_id: prLine.id,
      },
    });

    return { success: true, poId: po.id, poNumber };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
