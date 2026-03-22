import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';

// 生成 GR 编号
async function generateGRNumber(client: any, grType: string = 'in'): Promise<string> {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = grType === 'out' ? 'RT' : 'GR'; // RT = Return, GR = Goods Receipt
  
  const { count } = await client
    .from('goods_receipts')
    .select('*', { count: 'exact', head: true })
    .like('gr_number', `${prefix}-${dateStr}-%`);

  const seq = String((count || 0) + 1).padStart(2, '0');
  return `${prefix}-${dateStr}-${seq}`;
}

// 获取当前用户信息
function getActorInfo(request: NextRequest): { actor: string; role: string } {
  return {
    actor: request.headers.get('X-Actor') || 'system',
    role: request.headers.get('X-Role') || 'requester',
  };
}

// GET /api/goods-receipts - 获取收货单列表
export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const searchParams = request.nextUrl.searchParams;
    const grType = searchParams.get('grType');
    const poId = searchParams.get('poId');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
    const offset = (page - 1) * pageSize;

    let query = client
      .from('goods_receipts')
      .select('*, purchase_orders(po_number, supplier_snapshot), purchase_order_lines(*)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (grType) {
      query = query.eq('gr_type', grType);
    }

    if (poId) {
      query = query.eq('po_id', parseInt(poId, 10));
    }

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
    const body = await request.json();
    const { actor, role } = getActorInfo(request);

    // 获取 PO 行信息
    const { data: poLine, error: poLineError } = await client
      .from('purchase_order_lines')
      .select('*, purchase_orders(*)')
      .eq('id', body.poLineId)
      .single();

    if (poLineError) {
      return NextResponse.json({ error: 'PO line not found' }, { status: 404 });
    }

    // 生成 GR 编号
    const grType = body.grType || 'in';
    const grNumber = await generateGRNumber(client, grType);

    // 计算收货后的净收货数量
    const currentReceived = parseFloat(poLine.received_qty || '0');
    const grQuantity = parseFloat(body.quantity);
    
    let newReceivedQty: number;
    if (grType === 'out') {
      // 退货：减少净收货数量
      newReceivedQty = Math.max(0, currentReceived - grQuantity);
    } else {
      // 收货：增加净收货数量
      newReceivedQty = currentReceived + grQuantity;
    }

    // 计算未收货数量
    const orderQty = parseFloat(poLine.quantity);
    const pendingQty = Math.max(0, orderQty - newReceivedQty);

    // 更新 PO 行
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
