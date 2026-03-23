import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { generateGRNumber } from '@/storage/database/number-generator';
import { getUserIdentityWithLookup, filterGoodsReceipts, type Role } from '@/lib/role-filter';
import { getManagerWebhooks } from '@/storage/database/agent-binding';

// 超收阈值（5%）
const OVERDELIVERY_THRESHOLD = 0.05;

// GET /api/goods-receipts - 获取收货单列表
export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);
    const searchParams = request.nextUrl.searchParams;
    const grType = searchParams.get('grType');
    const poId = searchParams.get('poId');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
    const offset = (page - 1) * pageSize;

    let query = client
      .from('goods_receipts')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (grType) {
      query = query.eq('gr_type', grType);
    }

    if (poId) {
      query = query.eq('po_id', parseInt(poId, 10));
    }

    // 按角色过滤
    query = filterGoodsReceipts(query, role as Role, actor);

    const { data, error, count } = await query;

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

// POST /api/goods-receipts - 创建收货单
export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);
    const body = await request.json();

    // 校验必填参数
    if (!body.poLineId) {
      return NextResponse.json({ error: 'poLineId 为必填参数' }, { status: 400 });
    }

    const grQuantity = parseFloat(body.quantity);
    if (isNaN(grQuantity) || grQuantity <= 0) {
      return NextResponse.json({ error: 'quantity 必须为正数' }, { status: 400 });
    }

    // 获取 PO 行信息 - 严格校验
    const { data: poLine, error: poLineError } = await client
      .from('purchase_order_lines')
      .select('*')
      .eq('id', body.poLineId)
      .single();

    if (poLineError) {
      console.error('Error fetching PO line:', poLineError);
      return NextResponse.json({ error: '采购订单行查询失败', detail: poLineError.message }, { status: 500 });
    }

    if (!poLine) {
      return NextResponse.json({ error: `采购订单行不存在 (ID: ${body.poLineId})` }, { status: 404 });
    }

    // 校验 PO 行数据完整性
    const orderQty = parseFloat(poLine.quantity);
    if (isNaN(orderQty) || orderQty <= 0) {
      return NextResponse.json({ error: '采购订单行数量无效', detail: `quantity: ${poLine.quantity}` }, { status: 400 });
    }

    // 获取 PO 头信息用于快照
    const { data: poHeader } = await client
      .from('purchase_orders')
      .select('*')
      .eq('id', body.poId || poLine.order_id)
      .single();

    // 生成 GR/RT 编号（使用上海时区 + 99上限）
    const grType = body.grType || 'in';
    const grNumber = await generateGRNumber(grType);

    // 计算收货后的净收货数量
    const currentReceived = parseFloat(poLine.received_qty || '0');
    
    let newReceivedQty: number;
    if (grType === 'out') {
      // 退货：减少净收货数量
      newReceivedQty = Math.max(0, currentReceived - grQuantity);
    } else {
      // 收货：增加净收货数量
      newReceivedQty = currentReceived + grQuantity;
    }

    // 计算未收货数量
    const pendingQty = Math.max(0, orderQty - newReceivedQty);

    // 检测超收（收货数量超过订单的 5%）
    let isOverdelivery = false;
    let overdeliveryRatio = 0;
    
    if (grType === 'in' && newReceivedQty > orderQty) {
      overdeliveryRatio = (newReceivedQty - orderQty) / orderQty;
      isOverdelivery = overdeliveryRatio > OVERDELIVERY_THRESHOLD;
    }

    // 构建快照数据
    const poSnapshot = poHeader ? JSON.stringify({
      po_number: poHeader.po_number,
      supplier_snapshot: poHeader.supplier_snapshot,
      status: poHeader.status,
    }) : null;
    
    const poLineSnapshot = JSON.stringify({
      material_snapshot: poLine.material_snapshot,
      quantity: poLine.quantity,
      unit_price: poLine.unit_price,
      received_qty: poLine.received_qty,
    });

    // 如果超收且当前角色不是 manager，需要审批
    if (isOverdelivery && role !== 'manager') {
      // 插入待审批的收货单
      const { data: gr, error: grError } = await client
        .from('goods_receipts')
        .insert({
          gr_number: grNumber,
          po_id: body.poId || poLine.order_id,
          po_line_id: body.poLineId,
          gr_type: grType,
          quantity: body.quantity,
          receipt_date: body.receiptDate,
          receipt_time: new Date().toTimeString().slice(0, 8),
          receiver: actor,
          notes: body.notes || null,
          status: 'pending_approval', // 待审批状态
          is_overdelivery: true,
          overdelivery_ratio: overdeliveryRatio,
          po_snapshot: poSnapshot,
          po_line_snapshot: poLineSnapshot,
        })
        .select()
        .single();

      if (grError) {
        return NextResponse.json({ error: grError.message }, { status: 500 });
      }

      // 记录超收审计日志
      await client.from('audit_logs').insert({
        entity_type: 'goods_receipt',
        entity_id: gr.id,
        action: 'overdelivery_pending_approval',
        actor,
        actor_role: role,
        detail: {
          gr_number: grNumber,
          po_line_id: body.poLineId,
          order_qty: orderQty,
          current_received_qty: currentReceived,
          gr_quantity: grQuantity,
          new_received_qty: newReceivedQty,
          overdelivery_ratio: overdeliveryRatio,
          threshold: OVERDELIVERY_THRESHOLD,
        },
      });

      // 通知所有 Manager Agent 有超收待审批
      notifyOverdeliveryPending({
        event: 'overdelivery_pending',
        grId: gr.id,
        grNumber: grNumber,
        poId: body.poId || poLine.order_id,
        poLineId: body.poLineId,
        orderQty: orderQty,
        grQuantity: grQuantity,
        overdeliveryRatio: overdeliveryRatio,
        requestedBy: actor,
        requestedAt: new Date().toISOString(),
      }).catch(err => {
        console.error('Failed to notify managers:', err);
      });

      return NextResponse.json({
        data: gr,
        warning: '超收超过5%，需要Manager审批',
        requires_approval: true,
      }, { status: 202 });
    }

    // 正常更新 PO 行
    await client
      .from('purchase_order_lines')
      .update({
        received_qty: newReceivedQty,
        pending_qty: pendingQty,
        status: pendingQty === 0 ? 'received' : (newReceivedQty > 0 ? 'partial_received' : 'ordered'),
        updated_at: new Date().toISOString(),
      })
      .eq('id', body.poLineId);

    // 检查是否需要更新 PO 头状态
    await updatePOStatus(client, poLine.order_id);

    // 插入收货单
    const { data: gr, error: grError } = await client
      .from('goods_receipts')
      .insert({
        gr_number: grNumber,
        po_id: body.poId || poLine.order_id,
        po_line_id: body.poLineId,
        gr_type: grType,
        quantity: body.quantity,
        receipt_date: body.receiptDate,
        receipt_time: new Date().toTimeString().slice(0, 8),
        receiver: actor,
        notes: body.notes || null,
        po_snapshot: poSnapshot,
        po_line_snapshot: poLineSnapshot,
      })
      .select()
      .single();

    if (grError) {
      return NextResponse.json({ error: grError.message }, { status: 500 });
    }

    // 更新 PR 行进度
    if (poLine.pr_line_id) {
      const prLineStatus = pendingQty === 0 ? 'received' : 'partial_received';
      await client
        .from('purchase_request_lines')
        .update({
          progress: prLineStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', poLine.pr_line_id);
    }

    // 记录审计日志
    await client.from('audit_logs').insert({
      entity_type: 'goods_receipt',
      entity_id: gr.id,
      action: grType === 'out' ? 'return' : 'receive',
      actor,
      actor_role: role,
      detail: {
        gr_number: grNumber,
        po_id: body.poId,
        po_line_id: body.poLineId,
        quantity: body.quantity,
        gr_type: grType,
        new_received_qty: newReceivedQty,
        pending_qty: pendingQty,
      },
    });

    return NextResponse.json({ data: gr }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
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

// 通知所有 Manager Agent 有超收待审批
async function notifyOverdeliveryPending(payload: {
  event: string;
  grId: number;
  grNumber: string;
  poId: number;
  poLineId: number;
  orderQty: number;
  grQuantity: number;
  overdeliveryRatio: number;
  requestedBy: string;
  requestedAt: string;
}): Promise<void> {
  const webhooks = await getManagerWebhooks();

  if (webhooks.length === 0) {
    console.log('No manager webhooks configured');
    return;
  }

  const results = await Promise.allSettled(
    webhooks.map(async (webhookUrl) => {
      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'ProcurementSystem-Webhook/1.0',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return { url: webhookUrl, success: true };
      } catch (err) {
        return { url: webhookUrl, success: false, error: err instanceof Error ? err.message : 'Unknown error' };
      }
    })
  );

  const succeeded = results.filter(r => r.status === 'fulfilled' && (r as any).value.success).length;
  const failed = results.filter(r => r.status === 'rejected' || !(r as any).value.success).length;

  console.log(`Webhook notifications: ${succeeded} succeeded, ${failed} failed`);
}
