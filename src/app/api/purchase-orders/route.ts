import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { numberGenerators } from '@/storage/database/number-generator';
import { getUserIdentityWithLookup, filterPurchaseOrders, getRequesterAccessiblePOIds, type Role } from '@/lib/role-filter';

// GET /api/purchase-orders - 获取采购订单列表
export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status');
    const supplierId = searchParams.get('supplierId');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
    const offset = (page - 1) * pageSize;

    let query = client
      .from('purchase_orders')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (status) {
      query = query.eq('status', status);
    }

    if (supplierId) {
      query = query.eq('supplier_id', parseInt(supplierId, 10));
    }

    // 按角色过滤：requester 仅能看自己 PR 对应的 PO
    if (role === 'requester') {
      const allowedIds = await getRequesterAccessiblePOIds(client, actor);
      query = allowedIds.length > 0 ? query.in('id', allowedIds) : query.eq('id', -1);
    } else {
      query = filterPurchaseOrders(query, role as Role, actor);
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

// POST /api/purchase-orders - 创建采购订单
export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);
    const body = await request.json();

    // 生成 PO 编号（使用上海时区 + 99上限）
    const poNumber = await numberGenerators.po();

    // 计算到货日期（最晚日期）
    let deliveryDate = body.deliveryDate;
    if (body.lines && body.lines.length > 0) {
      const dates = body.lines
        .map((line: any) => line.expectedDeliveryDate)
        .filter(Boolean);
      if (dates.length > 0) {
        deliveryDate = dates.sort().reverse()[0];
      }
    }

    // 构建行项目快照
    const linesSnapshot = body.lines ? JSON.stringify(body.lines) : null;

    // 插入主表
    const { data: po, error: poError } = await client
      .from('purchase_orders')
      .insert({
        po_number: poNumber,
        supplier_id: body.supplierId || null,
        supplier_snapshot: body.supplierSnapshot || '',
        delivery_date: deliveryDate || null,
        status: 'draft',
        created_by: actor,
        lines_snapshot: linesSnapshot,
      })
      .select()
      .single();

    if (poError) {
      return NextResponse.json({ error: poError.message }, { status: 500 });
    }

    // 插入行项目
    if (body.lines && body.lines.length > 0) {
      const lines = body.lines.map((line: any, index: number) => ({
        order_id: po.id,
        line_number: index + 1,
        pr_id: line.prId,
        pr_line_id: line.prLineId,
        material_id: line.materialId || null,
        material_snapshot: line.materialSnapshot || line.materialName || '',
        quantity: line.quantity,
        unit_price: line.unitPrice || 0,
        total_price: (line.quantity || 0) * (line.unitPrice || 0),
        received_qty: 0,
        pending_qty: line.quantity,
        status: 'ordered',
        fa_id: line.faId || null,
        sourcing_task_id: line.sourcingTaskId || null,
      }));

      const { error: linesError } = await client
        .from('purchase_order_lines')
        .insert(lines);

      if (linesError) {
        // 回滚
        await client.from('purchase_orders').delete().eq('id', po.id);
        return NextResponse.json({ error: linesError.message }, { status: 500 });
      }

      // 更新 PR 行状态
      for (const line of body.lines) {
        if (line.prLineId) {
          await client
            .from('purchase_request_lines')
            .update({
              progress: 'ordered',
              purchase_order_id: po.id,
              po_line_number: body.lines.indexOf(line) + 1,
              updated_at: new Date().toISOString(),
            })
            .eq('id', line.prLineId);
        }
      }
    }

    // 记录审计日志
    await client.from('audit_logs').insert({
      entity_type: 'purchase_order',
      entity_id: po.id,
      action: 'create',
      actor,
      actor_role: role,
      detail: { po_number: poNumber, lines_count: body.lines?.length || 0 },
    });

    return NextResponse.json({ data: po }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
