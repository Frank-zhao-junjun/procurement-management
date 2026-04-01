import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { getUserIdentityWithLookup, canAccessPurchaseOrder, canCreatePO, type Role } from '@/lib/role-filter';

// PATCH /api/purchase-orders/[id]/status - 更新采购订单状态
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);
    const poId = parseInt(id, 10);
    const body = await request.json();
    const { status } = body;

    // 权限检查：只有 buyer 和 manager 可以更新状态
    if (!canCreatePO(role as Role)) {
      return NextResponse.json({ error: '只有 Buyer 或 Manager 可以更新订单状态' }, { status: 403 });
    }

    // 验证状态值
    const validStatuses = ['draft', 'sent', 'partial', 'received', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: '无效的状态值' }, { status: 400 });
    }

    // 更新状态
    const { error } = await client
      .from('purchase_orders')
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', poId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 记录审计日志
    await client.from('audit_logs').insert({
      entity_type: 'purchase_order',
      entity_id: poId,
      action: 'update_status',
      actor,
      actor_role: role,
      detail: { new_status: status },
    });

    return NextResponse.json({ success: true, status });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
