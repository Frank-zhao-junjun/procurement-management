import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { numberGenerators } from '@/storage/database/number-generator';
import { insertSourcingTaskSchema } from '@/storage/database/shared/schema';
import { getUserIdentityWithLookup, filterSourcingTasks, type Role } from '@/lib/role-filter';

// GET /api/sourcing-tasks - 获取寻源任务列表
export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status');
    const prId = searchParams.get('prId');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
    const offset = (page - 1) * pageSize;

    let query = client
      .from('sourcing_tasks')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (status) {
      query = query.eq('status', status);
    }

    if (prId) {
      query = query.eq('pr_id', parseInt(prId, 10));
    }

    // 按角色过滤
    query = filterSourcingTasks(query, role as Role, actor);

    // Requester 角色：需要额外过滤，只看自己 PR 关联的任务
    if (role === 'requester') {
      // 先查询 requester 自己的 PR IDs
      const { data: ownPRs } = await client
        .from('purchase_requests')
        .select('id')
        .eq('applicant', actor);

      const ownPRIds = ownPRs?.map((pr: any) => pr.id) || [];
      if (ownPRIds.length > 0) {
        query = client
          .from('sourcing_tasks')
          .select('*', { count: 'exact' })
          .in('pr_id', ownPRIds)
          .order('created_at', { ascending: false })
          .range(offset, offset + pageSize - 1);

        if (status) {
          query = query.eq('status', status);
        }
      } else {
        // 没有自己的 PR，返回空
        return NextResponse.json({
          data: [],
          total: 0,
          page,
          pageSize,
        });
      }
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

// POST /api/sourcing-tasks - 创建寻源任务（仅 buyer/manager）
export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);
    const body = await request.json();

    if (role !== 'buyer') {
      return NextResponse.json({ error: '只有 Buyer 可以创建寻源任务' }, { status: 403 });
    }

    const parsed = insertSourcingTaskSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.issues },
        { status: 400 }
      );
    }

    const taskNumber = await numberGenerators.sc();

    let prSnapshot = '';
    if (parsed.data.prId) {
      const { data: pr } = await client
        .from('purchase_requests')
        .select('pr_number')
        .eq('id', parsed.data.prId)
        .single();
      if (pr) prSnapshot = pr.pr_number;
    }

    const { data: task, error } = await client
      .from('sourcing_tasks')
      .insert({
        task_number: taskNumber,
        pr_id: parsed.data.prId,
        pr_line_id: parsed.data.prLineId,
        material_id: parsed.data.materialId ?? null,
        material_snapshot: parsed.data.materialSnapshot ?? parsed.data.requirementText ?? '',
        requirement_text: parsed.data.requirementText ?? '',
        target_supplier_id: parsed.data.targetSupplierId ?? null,
        target_supplier_snapshot: parsed.data.targetSupplierSnapshot ?? '',
        status: 'pending',
        due_date: parsed.data.dueDate ?? null,
        created_by: actor,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (parsed.data.prLineId) {
      await client
        .from('purchase_request_lines')
        .update({
          progress: 'sourced',
          sourcing_task_id: task.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', parsed.data.prLineId);
    }

    await client.from('audit_logs').insert({
      entity_type: 'sourcing_task',
      entity_id: task.id,
      action: 'create',
      actor,
      actor_role: role,
      detail: { task_number: taskNumber, pr_id: parsed.data.prId },
    });

    return NextResponse.json({ data: task }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
