import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { canAccessPurchaseRequest, getRequesterAccessiblePRIds, getUserIdentityWithLookup, type Role } from '@/lib/role-filter';

// GET /api/purchase-request-lines - 获取采购申请行列表
export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);
    const searchParams = request.nextUrl.searchParams;
    const requestId = searchParams.get('requestId');
    const status = searchParams.get('status');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
    const offset = (page - 1) * pageSize;

    let query = client
      .from('purchase_request_lines')
      .select('*, count:id', { count: 'exact' })
      .order('line_number', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (role === 'requester') {
      const accessiblePRIds = await getRequesterAccessiblePRIds(client, actor);
      if (accessiblePRIds.length === 0) {
        return NextResponse.json({
          data: [],
          total: 0,
          page,
          pageSize,
        });
      }
      query = query.in('request_id', accessiblePRIds);
    }

    if (requestId) {
      const parsedRequestId = parseInt(requestId, 10);
      if (!(await canAccessPurchaseRequest(client, role as Role, actor, parsedRequestId))) {
        return NextResponse.json({ error: '无权限查看该采购申请行' }, { status: 403 });
      }
      query = query.eq('request_id', parsedRequestId);
    }

    if (status) {
      query = query.eq('progress', status);
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

// POST /api/purchase-request-lines - 创建采购申请行
export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);
    const body = await request.json();

    // 如果提供了 requestId，创建关联到采购申请的明细行
    if (body.request_id) {
      const requestId = Number(body.request_id);
      if (!(await canAccessPurchaseRequest(client, role as Role, actor, requestId))) {
        return NextResponse.json({ error: '无权限修改该采购申请' }, { status: 403 });
      }

      const { data, error } = await client
        .from('purchase_request_lines')
        .insert({
          request_id: requestId,
          line_number: body.line_number || 1,
          material_id: body.material_id || null,
          material_snapshot: body.material_snapshot || body.materialName || '',
          requirement_text: body.requirement_text || body.requirementText || '',
          quantity: body.quantity || body.qty || 0,
          est_unit_price: body.est_unit_price || body.estUnitPrice || null,
          expected_delivery_date: body.expected_delivery_date || body.expectedDeliveryDate || null,
          note: body.note || null,
          progress: 'pending',
        })
        .select()
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ data }, { status: 201 });
    }

    // 如果没有 request_id，创建独立的行（后续可以关联）
    const { data, error } = await client
      .from('purchase_request_lines')
      .insert({
        line_number: body.line_number || 1,
        material_id: body.material_id || null,
        material_snapshot: body.material_snapshot || body.materialName || '',
        requirement_text: body.requirement_text || body.requirementText || '',
        quantity: body.quantity || body.qty || 0,
        est_unit_price: body.est_unit_price || body.estUnitPrice || null,
        expected_delivery_date: body.expected_delivery_date || body.expectedDeliveryDate || null,
        note: body.note || null,
        progress: 'pending',
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/purchase-request-lines/batch - 批量创建采购申请行
export async function PUT(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);
    const body = await request.json();

    if (!body.lines || !Array.isArray(body.lines) || body.lines.length === 0) {
      return NextResponse.json({ error: 'lines 参数必填且需要是数组' }, { status: 400 });
    }

    if (!body.request_id) {
      return NextResponse.json({ error: 'request_id 参数必填' }, { status: 400 });
    }

    const requestId = Number(body.request_id);
    if (!(await canAccessPurchaseRequest(client, role as Role, actor, requestId))) {
      return NextResponse.json({ error: '无权限修改该采购申请' }, { status: 403 });
    }

    // 删除旧的行
    await client
      .from('purchase_request_lines')
      .delete()
      .eq('request_id', requestId);

    // 批量插入新行
    const linesToInsert = body.lines.map((line: any, index: number) => ({
      request_id: requestId,
      line_number: index + 1,
      material_id: line.material_id || line.materialId || null,
      material_snapshot: line.material_snapshot || line.materialSnapshot || line.materialName || '',
      requirement_text: line.requirement_text || line.requirementText || '',
      quantity: line.quantity || line.qty || 0,
      est_unit_price: line.est_unit_price || line.estUnitPrice || null,
      expected_delivery_date: line.expected_delivery_date || line.expectedDeliveryDate || null,
      note: line.note || null,
      progress: 'pending',
    }));

    const { data, error } = await client
      .from('purchase_request_lines')
      .insert(linesToInsert)
      .select();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true,
      data,
      count: data.length,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
