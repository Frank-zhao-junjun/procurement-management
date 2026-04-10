/**
 * Material Price History API - 物料历史成交价查询
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { getUserIdentityWithLookup } from '@/lib/role-filter';

// ============ GET /api/materials/:id/price-history - 获取物料价格历史 ============

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const materialId = parseInt(id, 10);

    if (isNaN(materialId)) {
      return NextResponse.json({ error: '无效的物料 ID' }, { status: 400 });
    }

    // 权限检查
    const { role } = await getUserIdentityWithLookup(request);
    if (!role) {
      return NextResponse.json({ error: '未认证' }, { status: 401 });
    }

    const client = getSupabaseClient();
    const searchParams = request.nextUrl.searchParams;

    // 查询参数
    const supplierId = searchParams.get('supplierId');
    const fromDate = searchParams.get('from');
    const toDate = searchParams.get('to');
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    // 从 PO 行获取历史成交价格
    let query = client
      .from('purchase_order_lines')
      .select(`
        id,
        unit_price,
        quantity,
        received_qty,
        material_snapshot,
        created_at,
        purchase_orders (
          id,
          po_number,
          order_date,
          supplier_id,
          suppliers (
            id,
            name
          )
        )
      `)
      .not('unit_price', 'is', null)
      .order('created_at', { ascending: false })
      .limit(limit);

    // 如果有物料名称/快照过滤（因为 PO 行是快照）
    // 需要从 PO 关联的 PR 行获取物料 ID
    // 这里我们直接通过搜索 PO 行的 material_snapshot 来过滤
    if (searchParams.get('materialName')) {
      query = query.ilike('material_snapshot', `%${searchParams.get('materialName')}%`);
    }

    // 日期过滤
    if (fromDate) {
      query = query.gte('created_at', fromDate);
    }
    if (toDate) {
      query = query.lte('created_at', toDate);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 过滤和转换数据
    const priceHistory = (data || [])
      .filter((line: any) => {
        // 过滤掉价格为 0 的记录
        if (!line.unit_price || line.unit_price <= 0) return false;
        return true;
      })
      .map((line: any) => ({
        id: line.id,
        poLineId: line.id,
        unitPrice: line.unit_price,
        quantity: line.quantity,
        receivedQty: line.received_qty,
        materialSnapshot: line.material_snapshot,
        createdAt: line.created_at,
        poId: line.purchase_orders?.id,
        poNumber: line.purchase_orders?.po_number,
        orderDate: line.purchase_orders?.order_date,
        supplierId: line.purchase_orders?.supplier_id,
        supplierName: line.purchase_orders?.suppliers?.name,
      }));

    // 计算统计信息
    const prices = priceHistory.map((p: any) => p.unitPrice);
    const avgPrice = prices.length > 0 ? prices.reduce((a: number, b: number) => a + b, 0) / prices.length : 0;
    const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
    const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
    const latestPrice = prices.length > 0 ? prices[0] : 0;

    return NextResponse.json({
      data: {
        materialId,
        statistics: {
          avgPrice: Math.round(avgPrice * 100) / 100,
          minPrice,
          maxPrice,
          latestPrice,
          count: prices.length,
        },
        history: priceHistory,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
