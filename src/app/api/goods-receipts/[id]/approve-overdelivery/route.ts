import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';

// POST /api/goods-receipts/[id]/approve-overdelivery - 审批超收收货单
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const body = await request.json();
    const { actor, role } = getActorInfo(request);

    // 只有 manager 可以审批
    if (role !== 'manager') {
      return NextResponse.json({ error: '只有 Manager 可以审批超收' }, { status: 403 });
    }

    const approved = body.approved !== false;

    // 获取待审批的收货单
    const { data: gr, error } = await client
      .from('goods_receipts')
      .select('*, purchase_order_lines(*)')
      .eq('id', parseInt(id, 10))
      .eq('status', 'pending_approval')
      .single();

    if (error || !gr) {
      return NextResponse.json({ error: '收货单不存在或不在待审批状态' }, { status: 404 });
    }

    if (approved) {
      // 审批通过：更新收货单状态，更新 PO 行
      await client
        .from('goods_receipts')
        .update({
          status: 'approved',
          approved_by: actor,
          approved_at: new Date().toISOString(),
        })
        .eq('id', parseInt(id, 10));

      // 更新 PO 行
      const poLine = gr.purchase_order_lines;
      await client
        .from('purchase_order_lines')
        .update({
          received_qty: gr.received_qty || (parseFloat(poLine.received_qty) + parseFloat(gr.quantity)),
          pending_qty: Math.max(0, parseFloat(poLine.quantity) - (parseFloat(poLine.received_qty) + parseFloat(gr.quantity))),
          status: 'received',
          updated_at: new Date().toISOString(),
        })
        .eq('id', gr.po_line_id);

      // 检查是否需要更新 PO 头状态
      await updatePOStatus(client, gr.po_id);

      // 记录超收审批审计日志
      await client.from('audit_logs').insert({
        entity_type: 'goods_receipt',
        entity_id: gr.id,
        action: 'overdelivery_approved',
        actor,
        actor_role: role,
        detail: {
          gr_number: gr.gr_number,
          approved: true,
          note: body.note,
        },
      });

      return NextResponse.json({ success: true, status: 'approved' });
    } else {
      // 审批拒绝：更新收货单状态为 rejected
      await client
        .from('goods_receipts')
        .update({
          status: 'rejected',
          approved_by: actor,
          approved_at: new Date().toISOString(),
        })
        .eq('id', parseInt(id, 10));

      // 记录超收拒绝审计日志
      await client.from('audit_logs').insert({
        entity_type: 'goods_receipt',
        entity_id: gr.id,
        action: 'overdelivery_rejected',
        actor,
        actor_role: role,
        detail: {
          gr_number: gr.gr_number,
          approved: false,
          note: body.note,
        },
      });

      return NextResponse.json({ success: true, status: 'rejected' });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// 获取当前用户信息
function getActorInfo(request: NextRequest): { actor: string; role: string } {
  return {
    actor: request.headers.get('X-Actor') || 'system',
    role: request.headers.get('X-Role') || 'manager',
  };
}

// 更新 PO 头状态
async function updatePOStatus(client: any, poId: number) {
  try {
    const { data: lines } = await client
      .from('purchase_order_lines')
      .select('status')
      .eq('order_id', poId);

    if (!lines || lines.length === 0) return;

    const statuses = (lines as any[]).map((l: any) => l.status);
    
    let newStatus = 'draft';
    if (statuses.every((s: string) => s === 'received')) {
      newStatus = 'received';
    } else if (statuses.some((s: string) => s === 'partial_received' || s === 'received')) {
      newStatus = 'partial';
    } else if (statuses.every((s: string) => s === 'ordered')) {
      newStatus = 'sent';
    }

    await client
      .from('purchase_orders')
      .update({
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', poId);
  } catch (error) {
    console.error('Error updating PO status:', error);
  }
}
