import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { getUserIdentity, canApprove, type Role } from '@/lib/role-filter';

// GET /api/goods-receipts/pending-approval - 获取待审批的超收收货单
// 仅 Manager 可访问
export async function GET(request: NextRequest) {
  try {
    const { role } = getUserIdentity(request) as { role: Role };
    
    // 仅 Manager 可查看待审批列表
    if (!canApprove(role)) {
      return NextResponse.json({ error: '只有 Manager 可以查看待审批列表' }, { status: 403 });
    }

    const client = getSupabaseClient();
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
    const offset = (page - 1) * pageSize;

    const { data, error, count } = await client
      .from('goods_receipts')
      .select('*, purchase_orders(po_number, supplier_snapshot), purchase_order_lines(*)', { count: 'exact' })
      .eq('status', 'pending_approval')
      .eq('is_overdelivery', true)
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

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
