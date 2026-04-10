/**
 * Goods Receipt Return Approval API - 退货审批接口
 * 
 * POST /api/goods-receipts/returns/:id/approve - Manager 审批退货
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { getUserIdentityWithLookup } from '@/lib/role-filter';
import { getBeijingISOString } from '@/lib/datetime';
import { publishGrReturnApproved } from '@/events/publisher';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const grId = parseInt(id, 10);

    if (isNaN(grId)) {
      return NextResponse.json({ error: '无效的收货单 ID' }, { status: 400 });
    }

    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);

    // 权限检查：只有 manager 可以审批退货
    if (role !== 'manager') {
      return NextResponse.json({ error: '只有 Manager 可以审批退货' }, { status: 403 });
    }

    const body = await request.json();
    const approved = body.approved !== false; // 默认批准
    const reason = body.reason || body.notes || '';

    // 查询退货单
    const { data: gr, error: grError } = await client
      .from('goods_receipts')
      .select(`
        *,
        purchase_order_lines (
          id,
          order_id,
          received_qty,
          pending_qty
        )
      `)
      .eq('id', grId)
      .single();

    if (grError || !gr) {
      return NextResponse.json({ error: '退货单不存在' }, { status: 404 });
    }

    // 检查状态
    if (gr.status !== 'pending_approval' || gr.gr_type !== 'out') {
      return NextResponse.json(
        { error: '该收货单不是待审批的退货单', currentStatus: gr.status },
        { status: 400 }
      );
    }

    if (approved) {
      // 批准退货：更新收货单状态，并处理库存

      // 计算新的已收货数量（退货需要减少）
      const poLine = gr.purchase_order_lines;
      const returnQty = gr.quantity;
      const newReceivedQty = Math.max(0, (poLine.received_qty || 0) - returnQty);
      const newPendingQty = (poLine.pending_qty || 0) + returnQty;

      // 更新 PO 行
      await client
        .from('purchase_order_lines')
        .update({
          received_qty: newReceivedQty,
          pending_qty: newPendingQty,
          status: newPendingQty === 0 ? 'received' : 'partial_received',
          updated_at: getBeijingISOString(),
        })
        .eq('id', poLine.id);

      // 更新收货单状态
      await client
        .from('goods_receipts')
        .update({
          status: 'approved',
          notes: gr.notes ? `${gr.notes}\n[审批通过] ${reason}` : `[审批通过] ${reason}`,
          updated_at: getBeijingISOString(),
        })
        .eq('id', grId);

      // 记录审计日志
      await client.from('audit_logs').insert({
        entity_type: 'goods_receipt',
        entity_id: grId,
        action: 'return_approved',
        actor,
        actor_role: role,
        detail: {
          gr_number: gr.gr_number,
          return_quantity: returnQty,
          new_received_qty: newReceivedQty,
          new_pending_qty: newPendingQty,
          reason,
        },
      });

      // 发布退货审批通过事件
      publishGrReturnApproved(
        {
          grId: gr.id,
          grNumber: gr.gr_number,
          approvedBy: actor,
          approvedAt: getBeijingISOString(),
          notes: reason,
        },
        actor
      ).catch((err) =>
        console.error('[Event] Failed to emit GR_RETURN_APPROVED:', err)
      );

      return NextResponse.json({
        success: true,
        data: {
          grId: gr.id,
          grNumber: gr.gr_number,
          status: 'approved',
          newReceivedQty,
          newPendingQty,
        },
      });
    } else {
      // 拒绝退货：更新收货单状态为已拒绝
      await client
        .from('goods_receipts')
        .update({
          status: 'rejected',
          notes: gr.notes ? `${gr.notes}\n[审批拒绝] ${reason}` : `[审批拒绝] ${reason}`,
          updated_at: getBeijingISOString(),
        })
        .eq('id', grId);

      // 记录审计日志
      await client.from('audit_logs').insert({
        entity_type: 'goods_receipt',
        entity_id: grId,
        action: 'return_rejected',
        actor,
        actor_role: role,
        detail: {
          gr_number: gr.gr_number,
          return_quantity: gr.quantity,
          reason,
        },
      });

      return NextResponse.json({
        success: true,
        data: {
          grId: gr.id,
          grNumber: gr.gr_number,
          status: 'rejected',
          reason,
        },
      });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
