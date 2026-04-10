/**
 * Price Comparison API - 多供应商比价
 * 
 * 用于比较同一物料在不同供应商处的价格
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { getUserIdentityWithLookup } from '@/lib/role-filter';

// ============ GET /api/materials/compare-price - 比价查询 ============

export async function GET(request: NextRequest) {
  try {
    // 权限检查
    const { role } = await getUserIdentityWithLookup(request);
    if (!role) {
      return NextResponse.json({ error: '未认证' }, { status: 401 });
    }

    const client = getSupabaseClient();
    const searchParams = request.nextUrl.searchParams;

    // 查询参数
    const materialId = searchParams.get('materialId');
    const materialName = searchParams.get('materialName');
    const supplierId = searchParams.get('supplierId');
    const fromDate = searchParams.get('from');
    const toDate = searchParams.get('to');

    // 必须提供物料标识
    if (!materialId && !materialName) {
      return NextResponse.json(
        { error: '必须提供 materialId 或 materialName' },
        { status: 400 }
      );
    }

    // 构建查询
    let query = client
      .from('quotes')
      .select(`
        id,
        unit_price,
        quantity,
        total_price,
        status,
        awarded,
        created_at,
        sourcing_task_id,
        sourcing_tasks (
          id,
          requirement_text
        ),
        suppliers (
          id,
          name,
          contact,
          email
        )
      `)
      .not('unit_price', 'is', null)
      .order('created_at', { ascending: false });

    // 物料过滤（通过 sourcing_task）
    if (materialId) {
      query = query.eq('sourcing_task_id', parseInt(materialId, 10));
    }

    // 日期过滤
    if (fromDate) {
      query = query.gte('created_at', fromDate);
    }
    if (toDate) {
      query = query.lte('created_at', toDate);
    }

    const { data: quotes, error: quotesError } = await query;

    if (quotesError) {
      return NextResponse.json({ error: quotesError.message }, { status: 500 });
    }

    // 如果有物料名称，还需要从 PO 行获取历史价格
    let poLineHistory: any[] = [];
    if (materialName) {
      const poQuery = client
        .from('purchase_order_lines')
        .select(`
          id,
          unit_price,
          quantity,
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
        .ilike('material_snapshot', `%${materialName}%`)
        .not('unit_price', 'is', null)
        .order('created_at', { ascending: false });

      if (fromDate) poQuery.gte('created_at', fromDate);
      if (toDate) poQuery.lte('created_at', toDate);
      if (supplierId) poQuery.eq('purchase_orders.supplier_id', parseInt(supplierId, 10));

      const { data, error } = await poQuery;
      if (!error && data) {
        poLineHistory = data.map((line: any) => ({
          source: 'po',
          id: line.id,
          unitPrice: line.unit_price,
          quantity: line.quantity,
          materialSnapshot: line.material_snapshot,
          createdAt: line.created_at,
          poId: line.purchase_orders?.id,
          poNumber: line.purchase_orders?.po_number,
          orderDate: line.purchase_orders?.order_date,
          supplierId: line.purchase_orders?.supplier_id,
          supplierName: line.purchase_orders?.suppliers?.name,
          awarded: null, // PO 行不记录授标状态
        }));
      }
    }

    // 转换报价数据
    const quoteHistory = (quotes || []).map((q: any) => ({
      source: 'quote',
      id: q.id,
      unitPrice: q.unit_price,
      quantity: q.quantity,
      totalPrice: q.total_price,
      status: q.status,
      awarded: q.awarded,
      createdAt: q.created_at,
      supplierId: q.suppliers?.id,
      supplierName: q.suppliers?.name,
      contact: q.suppliers?.contact,
      email: q.suppliers?.email,
      requirementText: q.sourcing_tasks?.requirement_text,
    }));

    // 合并所有价格数据
    const allPrices = [...quoteHistory, ...poLineHistory];

    // 按供应商分组
    const supplierPrices = new Map<string, any[]>();
    for (const item of allPrices) {
      const key = `${item.supplierId}-${item.supplierName}`;
      if (!supplierPrices.has(key)) {
        supplierPrices.set(key, []);
      }
      supplierPrices.get(key)!.push(item);
    }

    // 计算每个供应商的统计数据
    const comparison = Array.from(supplierPrices.entries()).map(([key, items]) => {
      const prices = items.map((i) => i.unitPrice);
      const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
      const latestPrice = prices[0];
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      const awardedCount = items.filter((i) => i.awarded === 'winner').length;

      return {
        supplierId: items[0].supplierId,
        supplierName: items[0].supplierName,
        contact: items[0].contact,
        email: items[0].email,
        quoteCount: items.filter((i) => i.source === 'quote').length,
        poCount: items.filter((i) => i.source === 'po').length,
        totalCount: items.length,
        avgPrice: Math.round(avgPrice * 100) / 100,
        latestPrice,
        minPrice,
        maxPrice,
        awardedCount,
        lastQuoteDate: items[0].createdAt,
      };
    });

    // 按平均价格排序
    comparison.sort((a, b) => a.avgPrice - b.avgPrice);

    // 找出最低价供应商
    const lowestPriceSupplier = comparison.length > 0 ? comparison[0] : null;

    // 计算市场平均价
    const allPrices_ = allPrices.map((i) => i.unitPrice);
    const marketAvgPrice = allPrices_.length > 0
      ? allPrices_.reduce((a, b) => a + b, 0) / allPrices_.length
      : 0;

    return NextResponse.json({
      data: {
        totalSuppliers: comparison.length,
        marketAvgPrice: Math.round(marketAvgPrice * 100) / 100,
        lowestPriceSupplier: lowestPriceSupplier
          ? {
              name: lowestPriceSupplier.supplierName,
              avgPrice: lowestPriceSupplier.avgPrice,
              diffFromMarket: lowestPriceSupplier.avgPrice - marketAvgPrice,
              diffPercent: marketAvgPrice > 0
                ? Math.round(((lowestPriceSupplier.avgPrice - marketAvgPrice) / marketAvgPrice) * 100)
                : 0,
            }
          : null,
        suppliers: comparison,
        details: allPrices.slice(0, 50), // 最多返回 50 条详情
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
