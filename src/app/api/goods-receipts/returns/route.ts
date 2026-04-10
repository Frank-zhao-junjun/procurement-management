/**
 * Goods Receipt Return API - 退货审批接口
 * 
 * Manager 审批退货申请
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { getUserIdentityWithLookup } from '@/lib/role-filter';
import { getBeijingISOString } from '@/lib/datetime';
import { publishGrReturnApproved } from '@/events/publisher';

// ============ GET /api/goods-receipts/returns/pending - 获取待审批退货列表 ============

export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { role } = await getUserIdentityWithLookup(request);

    // 权限检查：只有 manager 可以查看待审批退货
    if (role !== 'manager') {
      return NextResponse.json({ error: '只有 Manager 可以查看待审批退货列表' }, { status: 403 });
    }

    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
    const offset = (page - 1) * pageSize;

    // 查询退货申请列表（gr_type = 'out' 且 status = 'pending_approval'）
    let query = client
      .from('goods_receipts')
      .select(`
        *,
        purchase_orders (
          id,
          po_number,
          supplier_id,
          suppliers (
            id,
            name
          )
        ),
        purchase_order_lines (
          id,
          material_snapshot,
          quantity,
          received_qty,
          unit_price
        )
      `, { count: 'exact' })
      .eq('gr_type', 'out')
      .eq('status', 'pending_approval')
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    const { data, error, count } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 转换数据格式
    const returns = (data || []).map((gr: any) => ({
      id: gr.id,
      grNumber: gr.gr_number,
      grType: gr.gr_type,
      quantity: gr.quantity,
      receiptDate: gr.receipt_date,
      receiptTime: gr.receipt_time,
      receiver: gr.receiver,
      notes: gr.notes,
      status: gr.status,
      createdAt: gr.created_at,
      poId: gr.purchase_orders?.id,
      poNumber: gr.purchase_orders?.po_number,
      supplierId: gr.purchase_orders?.supplier_id,
      supplierName: gr.purchase_orders?.suppliers?.name,
      poLineId: gr.purchase_order_lines?.id,
      materialSnapshot: gr.purchase_order_lines?.material_snapshot,
      orderQty: gr.purchase_order_lines?.quantity,
      receivedQty: gr.purchase_order_lines?.received_qty,
      unitPrice: gr.purchase_order_lines?.unit_price,
    }));

    return NextResponse.json({
      data: returns,
      total: count || 0,
      page,
      pageSize,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
