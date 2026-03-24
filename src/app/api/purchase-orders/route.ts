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

    // 获取每个订单的行数
    let dataWithLinesCount = data;
    if (data && data.length > 0) {
      const poIds = data.map(po => po.id);
      const { data: linesData } = await client
        .from('purchase_order_lines')
        .select('order_id')
        .in('order_id', poIds);

      // 统计每个订单的行数
      const lineCounts: Record<number, number> = {};
      (linesData || []).forEach(line => {
        lineCounts[line.order_id] = (lineCounts[line.order_id] || 0) + 1;
      });

      dataWithLinesCount = data.map(po => ({
        ...po,
        lines_count: lineCounts[po.id] || 0,
      }));
    }

    return NextResponse.json({
      data: dataWithLinesCount,
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

    // 生成 PO 编号
    const poNumber = await numberGenerators.po();

    // 支持多种参数格式（驼峰式和下划线式）
    const supplierId = body.supplierId || body.supplier_id || null;
    const supplierSnapshot = body.supplierSnapshot || body.supplier_snapshot || 
      (typeof body.supplier_snapshot === 'object' ? body.supplier_snapshot?.name : body.supplier_snapshot) || '';
    const deliveryDate = body.deliveryDate || body.delivery_date || null;
    const prId = body.prId || body.pr_id || null;
    
    // 订单行支持多种格式
    const orderLines = body.lines || body.items || [];

    // 插入主表
    const { data: po, error: poError } = await client
      .from('purchase_orders')
      .insert({
        po_number: poNumber,
        supplier_id: supplierId,
        supplier_snapshot: supplierSnapshot,
        delivery_date: deliveryDate,
        status: 'draft',
        created_by: actor,
      })
      .select()
      .single();

    if (poError) {
      console.error('PO创建失败:', poError);
      return NextResponse.json({ error: poError.message }, { status: 500 });
    }

    // 插入行项目
    if (orderLines.length > 0) {
      const lines = orderLines.map((line: any, index: number) => ({
        order_id: po.id,
        line_number: index + 1,
        pr_id: line.prId || line.pr_id || prId,
        pr_line_id: line.prLineId || line.pr_line_id || null,
        material_id: line.materialId || line.material_id || null,
        material_snapshot: line.materialSnapshot || line.material_snapshot || 
          line.materialName || line.material_name || '',
        quantity: line.quantity || line.qty || 0,
        unit_price: line.unitPrice || line.unit_price || line.price || 0,
        total_price: (line.quantity || line.qty || 0) * (line.unitPrice || line.unit_price || line.price || 0),
        received_qty: 0,
        pending_qty: line.quantity || line.qty || 0,
        status: 'ordered',
        fa_id: line.faId || line.fa_id || null,
        sourcing_task_id: line.sourcingTaskId || line.sourcing_task_id || null,
      }));

      const { error: linesError } = await client
        .from('purchase_order_lines')
        .insert(lines);

      if (linesError) {
        console.error('订单行创建失败:', linesError);
        // 回滚
        await client.from('purchase_orders').delete().eq('id', po.id);
        return NextResponse.json({ error: `订单行创建失败: ${linesError.message}` }, { status: 500 });
      }

      // 更新 PR 行状态
      for (const line of orderLines) {
        const prLineId = line.prLineId || line.pr_line_id;
        if (prLineId) {
          await client
            .from('purchase_request_lines')
            .update({
              progress: 'ordered',
              purchase_order_id: po.id,
              po_line_number: orderLines.indexOf(line) + 1,
              updated_at: new Date().toISOString(),
            })
            .eq('id', prLineId);
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
      detail: { po_number: poNumber, lines_count: orderLines.length },
    });

    // 返回完整数据
    const { data: fullPo } = await client
      .from('purchase_orders')
      .select('*')
      .eq('id', po.id)
      .single();

    const { data: poLines } = await client
      .from('purchase_order_lines')
      .select('*')
      .eq('order_id', po.id);

    return NextResponse.json({ 
      success: true,
      data: {
        ...fullPo,
        lines: poLines || [],
      }
    }, { status: 201 });
  } catch (error: any) {
    console.error('PO创建异常:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
