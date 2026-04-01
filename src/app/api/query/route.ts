import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';

// 统一的 Agent 查询接口 - 无权限限制
// GET /api/query?entity=pr|po|gr|fa&q=关键词

export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const searchParams = request.nextUrl.searchParams;
    const entity = searchParams.get('entity');
    const query = searchParams.get('q');
    const id = searchParams.get('id');
    const status = searchParams.get('status');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
    const offset = (page - 1) * pageSize;

    if (!entity) {
      return NextResponse.json({ error: 'entity 参数必填 (pr|po|gr|fa)' }, { status: 400 });
    }

    let result: any;
    const baseSelect = '*, count:id';

    switch (entity.toLowerCase()) {
      case 'pr':
        result = await queryPurchaseRequests(client, { query, id, status, page, pageSize, offset });
        break;
      
      case 'po':
        result = await queryPurchaseOrders(client, { query, id, status, page, pageSize, offset });
        break;
      
      case 'gr':
        result = await queryGoodsReceipts(client, { query, id, status, page, pageSize, offset });
        break;
      
      case 'fa':
        result = await queryFrameworkAgreements(client, { query, id, status, page, pageSize, offset });
        break;
      
      case 'consistency':
        // 数据一致性检查
        const consistency = await client.rpc('check_gr_po_consistency');
        return NextResponse.json({
          data: consistency.data,
          total: consistency.data?.length || 0,
        });
      
      case 'sync':
        // 同步数据一致性
        const syncResult = await client.rpc('sync_gr_po_consistency');
        return NextResponse.json({
          success: true,
          message: '数据同步完成',
          synced_count: syncResult.data?.length || 0,
        });
      
      default:
        return NextResponse.json({ error: '不支持的 entity 类型' }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Query API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function queryPurchaseRequests(client: any, params: any) {
  let query = client
    .from('purchase_requests')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(params.offset, params.offset + params.pageSize - 1);

  if (params.id) {
    query = query.eq('id', parseInt(params.id, 10));
  }

  if (params.status) {
    query = query.eq('status', params.status);
  }

  if (params.query) {
    // 模糊搜索
    query = query.or(`pr_number.ilike.%${params.query}%,reason.ilike.%${params.query}%,applicant.ilike.%${params.query}%`);
  }

  const { data, error, count } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return {
    data,
    total: count || 0,
    page: params.page,
    pageSize: params.pageSize,
    entity: 'purchase_request',
  };
}

async function queryPurchaseOrders(client: any, params: any) {
  let query = client
    .from('purchase_orders')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(params.offset, params.offset + params.pageSize - 1);

  if (params.id) {
    query = query.eq('id', parseInt(params.id, 10));
  }

  if (params.status) {
    query = query.eq('status', params.status);
  }

  if (params.query) {
    query = query.or(`po_number.ilike.%${params.query}%,supplier_snapshot.ilike.%${params.query}%,created_by.ilike.%${params.query}%`);
  }

  const { data, error, count } = await query;

  if (error) {
    throw new Error(error.message);
  }

  // 获取每个订单的行数
  if (data && data.length > 0) {
    const poIds = data.map((po: any) => po.id);
    const { data: linesData } = await client
      .from('purchase_order_lines')
      .select('order_id')
      .in('order_id', poIds);

    const lineCounts: Record<number, number> = {};
    (linesData || []).forEach((line: any) => {
      lineCounts[line.order_id] = (lineCounts[line.order_id] || 0) + 1;
    });

    data.forEach((po: any) => {
      po.lines_count = lineCounts[po.id] || 0;
    });
  }

  return {
    data,
    total: count || 0,
    page: params.page,
    pageSize: params.pageSize,
    entity: 'purchase_order',
  };
}

async function queryGoodsReceipts(client: any, params: any) {
  let query = client
    .from('goods_receipts')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(params.offset, params.offset + params.pageSize - 1);

  if (params.id) {
    query = query.eq('id', parseInt(params.id, 10));
  }

  if (params.status) {
    query = query.eq('status', params.status);
  }

  if (params.query) {
    query = query.or(`gr_number.ilike.%${params.query}%,receiver.ilike.%${params.query}%`);
  }

  const { data, error, count } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return {
    data,
    total: count || 0,
    page: params.page,
    pageSize: params.pageSize,
    entity: 'goods_receipt',
  };
}

async function queryFrameworkAgreements(client: any, params: any) {
  let query = client
    .from('framework_agreements')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(params.offset, params.offset + params.pageSize - 1);

  if (params.id) {
    query = query.eq('id', parseInt(params.id, 10));
  }

  if (params.status) {
    query = query.eq('status', params.status);
  }

  if (params.query) {
    query = query.or(`fa_number.ilike.%${params.query}%,supplier_snapshot.ilike.%${params.query}%`);
  }

  const { data, error, count } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return {
    data,
    total: count || 0,
    page: params.page,
    pageSize: params.pageSize,
    entity: 'framework_agreement',
  };
}
