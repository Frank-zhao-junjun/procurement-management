import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { getUserIdentityWithLookup, type Role } from '@/lib/role-filter';

// GET /api/goods-receipts/[id] - 获取收货单详情
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);
    const grId = parseInt(id, 10);

    // 获取收货单
    const { data: gr, error: grError } = await client
      .from('goods_receipts')
      .select('*')
      .eq('id', grId)
      .single();

    if (grError || !gr) {
      return NextResponse.json({ error: '收货单不存在' }, { status: 404 });
    }

    // 权限检查：requester 只能看自己创建的收货单
    if (role === 'requester' && gr.receiver !== actor) {
      return NextResponse.json({ error: '无权访问此收货单' }, { status: 403 });
    }

    // 获取关联的采购订单行信息
    let poLine = null;
    if (gr.po_line_id) {
      const { data: poLineData } = await client
        .from('purchase_order_lines')
        .select('*')
        .eq('id', gr.po_line_id)
        .single();
      poLine = poLineData;
    }

    // 获取关联的采购订单信息
    let po = null;
    if (gr.po_id) {
      const { data: poData } = await client
        .from('purchase_orders')
        .select('*')
        .eq('id', gr.po_id)
        .single();
      po = poData;
    }

    return NextResponse.json({
      data: {
        ...gr,
        po_line: poLine,
        purchase_order: po,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/goods-receipts/[id] - 删除收货单（仅草稿状态）
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);
    const grId = parseInt(id, 10);

    // 获取收货单
    const { data: gr, error: grError } = await client
      .from('goods_receipts')
      .select('*')
      .eq('id', grId)
      .single();

    if (grError || !gr) {
      return NextResponse.json({ error: '收货单不存在' }, { status: 404 });
    }

    // 只能删除草稿或待审批状态的收货单
    if (!['draft', 'pending_approval'].includes(gr.status)) {
      return NextResponse.json({ error: '只能删除草稿或待审批状态的收货单' }, { status: 400 });
    }

    // 权限检查：只能删除自己创建的收货单
    if (gr.receiver !== actor && role !== 'manager') {
      return NextResponse.json({ error: '只能删除自己创建的收货单' }, { status: 403 });
    }

    // 删除收货单
    const { error: deleteError } = await client
      .from('goods_receipts')
      .delete()
      .eq('id', grId);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    // 记录审计日志
    await client.from('audit_logs').insert({
      entity_type: 'goods_receipt',
      entity_id: grId,
      action: 'delete',
      actor,
      actor_role: role,
      detail: { gr_number: gr.gr_number },
    });

    return NextResponse.json({
      success: true,
      message: `收货单 ${gr.gr_number} 已删除`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
