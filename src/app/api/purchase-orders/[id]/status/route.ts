import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';

// 获取当前用户信息
function getActorInfo(request: NextRequest): { actor: string; role: string } {
  return {
    actor: request.headers.get('X-Actor') || 'system',
    role: request.headers.get('X-Role') || 'buyer',
  };
}

// PUT /api/purchase-orders/[id]/status - 更新采购订单状态
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const body = await request.json();
    const { actor, role } = getActorInfo(request);

    const newStatus = body.status;
    const validStatuses = ['draft', 'sent', 'partial', 'received', 'cancelled'];

    if (!validStatuses.includes(newStatus)) {
      return NextResponse.json(
        { error: `Invalid status: ${newStatus}` },
        { status: 400 }
      );
    }

    // 更新状态
    const { data, error } = await client
      .from('purchase_orders')
      .update({
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', parseInt(id, 10))
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 记录审计日志
    await client.from('audit_logs').insert({
      entity_type: 'purchase_order',
      entity_id: parseInt(id, 10),
      action: 'update_status',
      actor,
      actor_role: role,
      detail: { new_status: newStatus },
    });

    return NextResponse.json({ data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
