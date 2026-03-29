import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient, getServiceRoleClient } from '@/storage/database';
import { generateGRNumber } from '@/storage/database/number-generator';
import { getUserIdentityWithLookup } from '@/lib/role-filter';
import { getBeijingDateString, getBeijingTimeString, getBeijingISOString } from '@/lib/datetime';
import { notifyManagers } from '@/lib/webhook';

// 超收阈值（5%）
const OVERDELIVERY_THRESHOLD = 0.05;

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

    // 所有 Agent 都可以查询任何收货单（移除角色过滤）
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
    // 使用用户身份的客户端进行操作记录
    const client = getSupabaseClient();
    // 使用服务角色客户端查询基础数据（绕过 RLS）
    const serviceClient = getServiceRoleClient();
    const { actor, role } = await getUserIdentityWithLookup(request);
    const body = await request.json();

    // 支持多种参数格式（驼峰式和下划线式）
    // 日期格式: YYYY-MM-DD (北京时间)
    // 时间格式: HH:mm:ss (北京时间)
    const poLineId = body.poLineId || body.po_line_id;
    const poId = body.poId || body.po_id;
    const grType = body.grType || body.gr_type || 'in';
    // receiptDate 支持驼峰和下划线格式，未提供时使用今天(北京时间)
    const receiptDate = body.receiptDate || body.receipt_date || getBeijingDateString();
    const receiptTime = getBeijingTimeString();

    // 校验必填参数
    if (!poLineId) {
      return NextResponse.json({ error: 'poLineId 为必填参数' }, { status: 400 });
    }

    const grQuantity = Number(body.quantity);
    if (isNaN(grQuantity) || grQuantity <= 0) {
      return NextResponse.json({ error: 'quantity 必须为正数' }, { status: 400 });
    }

    // 获取 PO 行信息 - 使用服务角色客户端绕过 RLS
    const { data: poLine, error: poLineError } = await serviceClient
      .from('purchase_order_lines')
      .select('*')
      .eq('id', poLineId)
      .single();

    if (poLineError) {
      console.error('Error fetching PO line:', poLineError);
      return NextResponse.json({ error: '采购订单行查询失败', detail: poLineError.message }, { status: 500 });
    }

    if (!poLine) {
      return NextResponse.json({ error: `采购订单行不存在 (ID: ${poLineId})` }, { status: 404 });
    }

    // 校验 PO 行数据完整性
    const orderQty = Number(poLine.quantity);
    if (isNaN(orderQty) || orderQty <= 0) {
      return NextResponse.json({ error: '采购订单行数量无效', detail: `quantity: ${poLine.quantity}` }, { status: 400 });
    }

    // 获取 PO 头信息用于快照 - 使用服务角色客户端
    const { data: poHeader } = await serviceClient
      .from('purchase_orders')
      .select('*')
      .eq('id', poId || poLine.order_id)
      .single();

    // 生成 GR/RT 编号（使用上海时区 + 99上限）
    const grNumber = await generateGRNumber(grType);

    // 计算收货后的净收货数量
    const currentReceived = Number(poLine.received_qty || '0');
    
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

    // 构建快照数据（如果 PO 头存在）
    let poSnapshot: string | null = null;
    if (poHeader) {
      poSnapshot = poHeader.po_number;
    }
    
    let poLineSnapshot: string | null = null;
    if (poLine.material_snapshot) {
      poLineSnapshot = poLine.material_snapshot;
    }

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
          quantity: Number(body.quantity),
          receipt_date: receiptDate,
          receipt_time: receiptTime,
          receiver: actor,
          notes: body.notes || null,
          status: 'pending_approval', // 待审批状态
          is_overdelivery: true,
          overdelivery_ratio: overdeliveryRatio,
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

      // 通知所有配置了 Webhook 的 Manager（统一 payload / 审计 / 重试）
      notifyManagers(
        'overdelivery_pending',
        {
          gr_id: gr.id,
          gr_number: grNumber,
          po_id: poId || poLine.order_id,
          po_line_id: poLineId,
          order_qty: orderQty,
          gr_quantity: grQuantity,
          overdelivery_ratio: overdeliveryRatio,
          requested_by: actor,
          requested_at: getBeijingISOString(),
          notes: body.notes || null,
        },
        { entityType: 'goods_receipt', entityId: gr.id }
      ).catch((err: Error) => {
        console.error('Failed to notify managers via webhook:', err);
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
        updated_at: getBeijingISOString(),
      })
      .eq('id', poLineId);

    // 检查是否需要更新 PO 头状态
    await updatePOStatus(client, poLine.order_id);

    // 插入收货单
    const { data: gr, error: grError } = await client
      .from('goods_receipts')
      .insert({
        gr_number: grNumber,
        po_id: poId || poLine.order_id,
        po_line_id: poLineId,
        gr_type: grType,
        quantity: Number(body.quantity),
        receipt_date: receiptDate,
        receipt_time: receiptTime,
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
          updated_at: getBeijingISOString(),
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
        po_id: poId,
        po_line_id: poLineId,
        quantity: body.quantity,
        gr_type: grType,
        receipt_date: receiptDate,
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
        updated_at: getBeijingISOString(),
      })
      .eq('id', poId);
  } catch (error) {
    console.error('Error updating PO status:', error);
  }
}
