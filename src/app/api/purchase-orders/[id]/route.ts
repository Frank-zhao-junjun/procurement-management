import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { canAccessPurchaseOrder, getUserIdentityWithLookup, canCreatePO, type Role } from '@/lib/role-filter';

// GET /api/purchase-orders/[id] - 获取采购订单详情
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const poId = parseInt(id, 10);
    const { actor, role } = await getUserIdentityWithLookup(request);

    if (!(await canAccessPurchaseOrder(client, role as Role, actor, poId))) {
      return NextResponse.json({ error: '无权限查看该采购订单' }, { status: 403 });
    }

    const { data: po, error: poError } = await client
      .from('purchase_orders')
      .select('*')
      .eq('id', poId)
      .single();

    if (poError || !po) {
      return NextResponse.json({ error: '采购订单不存在' }, { status: 404 });
    }

    // 获取订单行
    const { data: lines, error: linesError } = await client
      .from('purchase_order_lines')
      .select('*')
      .eq('order_id', poId)
      .order('line_number', { ascending: true });

    if (linesError) {
      return NextResponse.json({ error: linesError.message }, { status: 500 });
    }

    return NextResponse.json({
      data: {
        ...po,
        lines: lines || [],
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH /api/purchase-orders/[id] - 更新采购订单
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

    // 权限检查：只有 buyer 和 manager 可以更新
    if (!canCreatePO(role as Role)) {
      return NextResponse.json({ error: '只有 Buyer 或 Manager 可以更新订单' }, { status: 403 });
    }

    // 获取现有订单
    const { data: existingPo, error: fetchError } = await client
      .from('purchase_orders')
      .select('*')
      .eq('id', poId)
      .single();

    if (fetchError || !existingPo) {
      return NextResponse.json({ error: '采购订单不存在' }, { status: 404 });
    }

    // 只允许更新草稿状态的订单
    if (existingPo.status !== 'draft') {
      return NextResponse.json({ error: '只能更新草稿状态的订单' }, { status: 400 });
    }

    // 更新订单主表字段
    const updateFields: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (body.supplier_id !== undefined) {
      // 如果设置 supplier_id，必须验证其有效性
      if (body.supplier_id !== null) {
        const { data: supplier, error: supplierError } = await client
          .from('suppliers')
          .select('id, name')
          .eq('id', body.supplier_id)
          .single();
        
        if (supplierError || !supplier) {
          return NextResponse.json({ 
            error: `无效的供应商 ID: ${body.supplier_id}，该供应商不存在` 
          }, { status: 400 });
        }
      }
      updateFields.supplier_id = body.supplier_id;
    }
    if (body.supplier_snapshot !== undefined) {
      updateFields.supplier_snapshot = body.supplier_snapshot;
    }
    if (body.delivery_date !== undefined) {
      updateFields.delivery_date = body.delivery_date;
    }

    // 更新主表
    const { error: updateError } = await client
      .from('purchase_orders')
      .update(updateFields)
      .eq('id', poId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // 更新订单行（如果提供）
    if (body.lines && Array.isArray(body.lines)) {
      // 先删除现有订单行
      await client.from('purchase_order_lines').delete().eq('order_id', poId);

      // 插入新的订单行
      const linesToInsert = body.lines.map((line: any, index: number) => ({
        order_id: poId,
        line_number: index + 1,
        pr_id: line.pr_id || null,
        pr_line_id: line.pr_line_id || null,
        material_id: line.material_id || null,
        material_snapshot: line.material_snapshot || line.material_name || '',
        quantity: line.quantity,
        unit_price: line.unit_price || 0,
        total_price: (line.quantity || 0) * (line.unit_price || 0),
        received_qty: 0,
        pending_qty: line.quantity,
        status: 'ordered',
        fa_id: line.fa_id || null,
        sourcing_task_id: line.sourcing_task_id || null,
      }));

      const { error: linesError } = await client
        .from('purchase_order_lines')
        .insert(linesToInsert);

      if (linesError) {
        return NextResponse.json({ error: linesError.message }, { status: 500 });
      }
    }

    // 记录审计日志
    await client.from('audit_logs').insert({
      entity_type: 'purchase_order',
      entity_id: poId,
      action: 'update',
      actor,
      actor_role: role,
      detail: { updated_fields: Object.keys(updateFields), lines_updated: body.lines?.length || 0 },
    });

    // 返回更新后的数据
    const { data: updatedPo } = await client
      .from('purchase_orders')
      .select('*')
      .eq('id', poId)
      .single();

    const { data: updatedLines } = await client
      .from('purchase_order_lines')
      .select('*')
      .eq('order_id', poId)
      .order('line_number', { ascending: true });

    return NextResponse.json({
      success: true,
      data: {
        ...updatedPo,
        lines: updatedLines || [],
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/purchase-orders/[id] - 删除采购订单
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);
    const poId = parseInt(id, 10);

    // 权限检查：只有 buyer 和 manager 可以删除
    if (!canCreatePO(role as Role)) {
      return NextResponse.json({ error: '只有 Buyer 或 Manager 可以删除订单' }, { status: 403 });
    }

    // 获取现有订单
    const { data: existingPo, error: fetchError } = await client
      .from('purchase_orders')
      .select('*')
      .eq('id', poId)
      .single();

    if (fetchError || !existingPo) {
      return NextResponse.json({ error: '采购订单不存在' }, { status: 404 });
    }

    // 只允许删除草稿或已取消状态的订单
    if (!['draft', 'cancelled'].includes(existingPo.status)) {
      return NextResponse.json({ error: '只能删除草稿或已取消状态的订单' }, { status: 400 });
    }

    // 检查是否有关联的收货单
    const { data: receipts } = await client
      .from('goods_receipts')
      .select('id')
      .eq('po_id', poId)
      .limit(1);

    if (receipts && receipts.length > 0) {
      return NextResponse.json({ error: '该订单已有关联的收货单，无法删除' }, { status: 400 });
    }

    // 删除订单行
    await client.from('purchase_order_lines').delete().eq('order_id', poId);

    // 删除订单主表
    const { error: deleteError } = await client
      .from('purchase_orders')
      .delete()
      .eq('id', poId);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    // 记录审计日志
    await client.from('audit_logs').insert({
      entity_type: 'purchase_order',
      entity_id: poId,
      action: 'delete',
      actor,
      actor_role: role,
      detail: { po_number: existingPo.po_number, deleted_at: new Date().toISOString() },
    });

    return NextResponse.json({
      success: true,
      message: `采购订单 ${existingPo.po_number} 已删除`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
