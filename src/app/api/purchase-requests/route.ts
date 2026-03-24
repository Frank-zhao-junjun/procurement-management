import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { numberGenerators } from '@/storage/database/number-generator';
import { getUserIdentityWithLookup, filterPurchaseRequests, type Role } from '@/lib/role-filter';

// GET /api/purchase-requests - 获取采购申请列表
export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status');
    const applicant = searchParams.get('applicant');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
    const offset = (page - 1) * pageSize;

    // 所有 Agent 都可以查询任何采购申请（移除角色过滤）
    let query = client
      .from('purchase_requests')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (status) {
      query = query.eq('status', status);
    }

    if (applicant) {
      query = query.eq('applicant', applicant);
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

// POST /api/purchase-requests - 创建采购申请
export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);
    const body = await request.json();

    // 生成 PR 编号（使用上海时区 + 99上限）
    const prNumber = await numberGenerators.pr();

    // 构建行项目快照
    const linesSnapshot = body.lines ? JSON.stringify(body.lines) : null;

    // 插入主表
    const { data: pr, error: prError } = await client
      .from('purchase_requests')
      .insert({
        pr_number: prNumber,
        applicant: actor,
        applicant_role: role,
        reason: body.reason,
        status: 'draft',
        lines_snapshot: linesSnapshot,
      })
      .select()
      .single();

    if (prError) {
      return NextResponse.json({ error: prError.message }, { status: 500 });
    }

    // 插入行项目
    if (body.lines && body.lines.length > 0) {
      const lines = body.lines.map((line: any, index: number) => ({
        request_id: pr.id,
        line_number: index + 1,
        material_id: line.materialId || null,
        material_snapshot: line.materialSnapshot || line.requirementText,
        requirement_text: line.requirementText,
        quantity: line.quantity,
        est_unit_price: line.estUnitPrice || null,
        expected_delivery_date: line.expectedDeliveryDate || null,
        note: line.note || null,
        progress: 'pending',
      }));

      const { error: linesError } = await client
        .from('purchase_request_lines')
        .insert(lines);

      if (linesError) {
        // 回滚
        await client.from('purchase_requests').delete().eq('id', pr.id);
        return NextResponse.json({ error: linesError.message }, { status: 500 });
      }
    }

    // 记录审计日志
    await client.from('audit_logs').insert({
      entity_type: 'purchase_request',
      entity_id: pr.id,
      action: 'create',
      actor,
      actor_role: role,
      detail: { pr_number: prNumber, lines_count: body.lines?.length || 0 },
    });

    return NextResponse.json({ data: pr }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
