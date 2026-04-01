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

    // 使用子查询获取行数，并按角色过滤可见性。
    let query = client
      .from('purchase_requests')
      .select(`
        *,
        purchase_request_lines(count)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (status) {
      query = query.eq('status', status);
    }

    if (applicant) {
      query = query.eq('applicant', applicant);
    }

    query = filterPurchaseRequests(query, role as Role, actor);

    const { data, error, count } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 处理 Supabase 嵌套查询返回的格式
    // purchase_request_lines 会返回为 { count: number }[] 格式
    const processedData = (data || []).map((item: any) => {
      if (item.purchase_request_lines && Array.isArray(item.purchase_request_lines)) {
        // 提取 count 值
        item.lines_count = item.purchase_request_lines[0]?.count || 0;
        delete item.purchase_request_lines;
      }
      return item;
    });

    return NextResponse.json({
      data: processedData,
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

    // 支持 items 和 lines 两种参数格式
    const linesData = body.lines || body.items || [];
    
    // 构建行项目快照
    const linesSnapshot = linesData.length > 0 ? JSON.stringify(linesData) : null;

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
    if (linesData.length > 0) {
      const lines = linesData.map((line: any, index: number) => ({
        request_id: pr.id,
        line_number: index + 1,
        material_id: line.materialId || line.material_id || null,
        material_snapshot: line.materialSnapshot || line.material_name || line.requirementText || '',
        requirement_text: line.requirementText || line.description || '',
        quantity: line.quantity || line.qty || 0,
        est_unit_price: line.estUnitPrice || line.est_unit_price || null,
        expected_delivery_date: line.expectedDeliveryDate || line.expected_delivery_date || null,
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
      detail: { pr_number: prNumber, lines_count: linesData.length },
    });

    // 返回完整数据（包括行项目）
    const { data: fullPr } = await client
      .from('purchase_requests')
      .select('*')
      .eq('id', pr.id)
      .single();

    const { data: prLines } = await client
      .from('purchase_request_lines')
      .select('*')
      .eq('request_id', pr.id);

    return NextResponse.json({ 
      data: {
        ...fullPr,
        lines: prLines || [],
      }
    }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
