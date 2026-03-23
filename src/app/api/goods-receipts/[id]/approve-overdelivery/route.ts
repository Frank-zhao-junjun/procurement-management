import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { getUserIdentityWithLookup } from '@/lib/role-filter';

// POST /api/goods-receipts/[id]/approve-overdelivery - 审批超收收货单
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const body = await request.json();
    const { actor, role } = await getUserIdentityWithLookup(request);

    // 只有 manager 可以审批
    if (role !== 'manager') {
      return NextResponse.json({ error: '只有 Manager 可以审批超收' }, { status: 403 });
    }

    const approved = body.approved !== false;

    // 获取待审批的收货单
    const { data: gr, error: grError } = await client
      .from('goods_receipts')
      .select('*')
      .eq('id', parseInt(id, 10))
      .eq('status', 'pending_approval')
      .single();

    if (grError || !gr) {
      return NextResponse.json({ error: '收货单不存在或不在待审批状态' }, { status: 404 });
    }

    // 校验 PO 行 ID
    if (!gr.po_line_id) {
      return NextResponse.json({ error: '收货单缺少关联的采购订单行ID' }, { status: 400 });
    }

    // 获取 PO 行数据 - 必须校验
    const { data: poLine, error: poLineError } = await client
      .from('purchase_order_lines')
      .select('*')
      .eq('id', gr.po_line_id)
      .single();

    // 严格校验 PO 行是否存在
    if (poLineError) {
      console.error('Error fetching PO line:', poLineError);
      return NextResponse.json({ 
        error: '采购订单行查询失败', 
        detail: poLineError.message 
      }, { status: 500 });
    }

    if (!poLine) {
      return NextResponse.json({ 
        error: `采购订单行不存在 (ID: ${gr.po_line_id})` 
      }, { status: 404 });
    }

    // 校验 PO 行数据完整性
    const orderQty = parseFloat(poLine.quantity);
    if (isNaN(orderQty) || orderQty <= 0) {
      return NextResponse.json({ 
        error: '采购订单行数量无效',
        detail: `quantity: ${poLine.quantity}`
      }, { status: 400 });
    }

    const grQty = parseFloat(gr.quantity);
    if (isNaN(grQty) || grQty <= 0) {
      return NextResponse.json({ 
        error: '收货数量无效',
        detail: `quantity: ${gr.quantity}`
      }, { status: 400 });
    }

    if (approved) {
      // 审批通过：更新收货单状态，更新 PO 行
      const { error: grUpdateError } = await client
        .from('goods_receipts')
        .update({
          status: 'approved',
          approved_by: actor,
          approved_at: new Date().toISOString(),
        })
        .eq('id', parseInt(id, 10));

      if (grUpdateError) {
        console.error('Error updating goods receipt:', grUpdateError);
        return NextResponse.json({ 
          error: '更新收货单状态失败' 
        }, { status: 500 });
      }

      // 更新 PO 行：审批通过后把本次收货量加入已收货
      const oldReceived = parseFloat(poLine.received_qty || '0');
      const newReceivedQty = oldReceived + grQty;
      const pendingQty = Math.max(0, orderQty - newReceivedQty);
      const lineStatus = pendingQty === 0 ? 'received' : 'partial_received';

      const { error: lineUpdateError } = await client
        .from('purchase_order_lines')
        .update({
          received_qty: newReceivedQty,
          pending_qty: pendingQty,
          status: lineStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', gr.po_line_id);

      if (lineUpdateError) {
        console.error('Error updating PO line:', lineUpdateError);
        // 尝试回滚收货单状态
        await client
          .from('goods_receipts')
          .update({ status: 'pending_approval', approved_by: null, approved_at: null })
          .eq('id', parseInt(id, 10));
        
        return NextResponse.json({ 
          error: '更新采购订单行失败' 
        }, { status: 500 });
      }

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
          old_received_qty: oldReceived,
          gr_quantity: grQty,
          new_received_qty: newReceivedQty,
          order_qty: orderQty,
        },
      });

      return NextResponse.json({ 
        success: true, 
        status: 'approved',
        data: {
          newReceivedQty,
          pendingQty,
          lineStatus,
        }
      });
    } else {
      // 审批拒绝：更新收货单状态为 rejected
      const { error: grUpdateError } = await client
        .from('goods_receipts')
        .update({
          status: 'rejected',
          approved_by: actor,
          approved_at: new Date().toISOString(),
        })
        .eq('id', parseInt(id, 10));

      if (grUpdateError) {
        console.error('Error updating goods receipt:', grUpdateError);
        return NextResponse.json({ 
          error: '更新收货单状态失败' 
        }, { status: 500 });
      }

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
    console.error('Error in approve-overdelivery:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// 更新 PO 头状态
async function updatePOStatus(client: any, poId: number) {
  try {
    const { data: lines, error } = await client
      .from('purchase_order_lines')
      .select('status')
      .eq('order_id', poId);

    if (error || !lines || lines.length === 0) return;

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
