import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { getUserIdentityWithLookup, filterPurchaseOrders, getRequesterAccessiblePOIds, type Role } from '@/lib/role-filter';

// GET /api/purchase-orders/[id] - 获取采购订单详情
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);
    const poId = parseInt(id, 10);

    // 获取订单主表
    const { data: po, error: poError } = await client
      .from('purchase_orders')
      .select('*')
      .eq('id', poId)
      .single();

    if (poError || !po) {
      return NextResponse.json({ error: '采购订单不存在' }, { status: 404 });
    }

    // 权限检查
    if (role === 'requester') {
      const allowedIds = await getRequesterAccessiblePOIds(client, actor);
      if (!allowedIds.includes(poId)) {
        return NextResponse.json({ error: '无权访问此订单' }, { status: 403 });
      }
    }

    // 获取订单行
    const { data: lines, error: linesError } = await client
      .from('purchase_order_lines')
      .select('*')
      .eq('order_id', poId)
      .order('line_number', { ascending: true });

    if (linesError) {
      return NextResponse.json({ error: linesError.message }, { status: 500 });
    }

    return NextResponse.json({
      data: {
        ...po,
        lines: lines || [],
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
