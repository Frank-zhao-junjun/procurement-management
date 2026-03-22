import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { numberGenerators } from '@/storage/database/number-generator';

// 获取当前用户信息
function getActorInfo(request: NextRequest): { actor: string; role: string } {
  return {
    actor: request.headers.get('X-Actor') || 'system',
    role: request.headers.get('X-Role') || 'buyer',
  };
}

// GET /api/sourcing-tasks - 获取寻源任务列表
export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status');
    const prId = searchParams.get('prId');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
    const offset = (page - 1) * pageSize;

    let query = client
      .from('sourcing_tasks')
      .select('*, purchase_requests(pr_number), suppliers(name)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (status) {
      query = query.eq('status', status);
    }

    if (prId) {
      query = query.eq('pr_id', parseInt(prId, 10));
    }

    const { data, error, count } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      data,
      total: count || 0,
      page,
      pageSize,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/sourcing-tasks - 创建寻源任务
export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const body = await request.json();
    const { actor, role } = getActorInfo(request);

    // 生成 SC 编号（使用上海时区 + 99上限）
    const taskNumber = await numberGenerators.sc();

    // 获取 PR 快照
    let prSnapshot = '';
    if (body.prId) {
      const { data: pr } = await client
        .from('purchase_requests')
        .select('pr_number')
        .eq('id', body.prId)
        .single();
      if (pr) {
        prSnapshot = pr.pr_number;
      }
    }

    // 插入数据
    const { data: task, error } = await client
      .from('sourcing_tasks')
      .insert({
        task_number: taskNumber,
        pr_id: body.prId,
        pr_line_id: body.prLineId,
        material_id: body.materialId || null,
        material_snapshot: body.materialSnapshot || body.requirementText || '',
        requirement_text: body.requirementText || '',
        target_supplier_id: body.targetSupplierId || null,
        target_supplier_snapshot: body.targetSupplierSnapshot || '',
        status: 'pending',
        due_date: body.dueDate || null,
        created_by: actor,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 更新 PR 行状态
    if (body.prLineId) {
      await client
        .from('purchase_request_lines')
        .update({
          progress: 'sourced',
          sourcing_task_id: task.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', body.prLineId);
    }

    // 记录审计日志
    await client.from('audit_logs').insert({
      entity_type: 'sourcing_task',
      entity_id: task.id,
      action: 'create',
      actor,
      actor_role: role,
      detail: { task_number: taskNumber, pr_id: body.prId },
    });

    return NextResponse.json({ data: task }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
