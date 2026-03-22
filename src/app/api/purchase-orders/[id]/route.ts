import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { getUserIdentity, type Role } from '@/lib/role-filter';

// GET /api/purchase-orders/[id] - 获取单个采购订单
// 按角色过滤：requester 只能看自己 PR 对应的 PO
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const { actor, role } = getUserIdentity(request) as { actor: string; role: Role };

    // 获取 PO 信息
    const { data: po, error } = await client
      .from('purchase_orders')
      .select('*, purchase_order_lines(*)')
      .eq('id', parseInt(id, 10))
      .single();

    if (error || !po) {
      if (error?.code === 'PGRST116' || !po) {
        return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 });
      }
      return NextResponse.json({ error: error?.message }, { status: 500 });
    }

    // Requester 角色需要验证 PO 是否与自己的 PR 关联
    if (role === 'requester') {
      const poLineIds = (po.purchase_order_lines || []).map((l: any) => l.pr_line_id).filter(Boolean);
      
      if (poLineIds.length > 0) {
        // 检查是否有关联的需求人的 PR
        const { data: prLines } = await client
          .from('purchase_request_lines')
          .select('id, request_id, purchase_requests(applicant)')
          .in('id', poLineIds);

        const hasAccess = (prLines || []).some((pl: any) => 
          pl.purchase_requests?.applicant === actor
        );

        if (!hasAccess) {
          return NextResponse.json({ error: '无权访问此采购订单' }, { status: 403 });
        }
      } else {
        return NextResponse.json({ error: '无权访问此采购订单' }, { status: 403 });
      }
    }

    return NextResponse.json({ data: po });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
