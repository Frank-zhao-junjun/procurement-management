import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { getUserIdentityWithLookup, canCreatePO, type Role } from '@/lib/role-filter';

// GET /api/purchase-orders/[id]/lines - 获取订单行列表
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const poId = parseInt(id, 10);

    // 验证订单存在
    const { data: po, error: poError } = await client
      .from('purchase_orders')
      .select('id, po_number')
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

    return NextResponse.json({ data: lines || [] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/purchase-orders/[id]/lines - 批量创建订单行
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);
    const poId = parseInt(id, 10);
    const body = await request.json();

    // 权限检查
    if (!canCreatePO(role as Role)) {
      return NextResponse.json({ error: '只有 Buyer 或 Manager 可以添加订单行' }, { status: 403 });
    }

    // 验证订单存在且为草稿状态
    const { data: po, error: poError } = await client
      .from('purchase_orders')
      .select('id, po_number, status')
      .eq('id', poId)
      .single();

    if (poError || !po) {
      return NextResponse.json({ error: '采购订单不存在' }, { status: 404 });
    }

    if (po.status !== 'draft') {
      return NextResponse.json({ error: '只能向草稿状态的订单添加行' }, { status: 400 });
    }

    // 获取当前最大行号
    const { data: existingLines } = await client
      .from('purchase_order_lines')
      .select('line_number')
      .eq('order_id', poId)
      .order('line_number', { ascending: false })
      .limit(1);

    const startLineNumber = existingLines && existingLines.length > 0 
      ? existingLines[0].line_number + 1 
      : 1;

    // 支持 items 和 lines 两种参数格式
    const linesData = body.lines || body.items || [];
    
    if (linesData.length === 0) {
      return NextResponse.json({ error: '未提供订单行数据' }, { status: 400 });
    }

    // 构建订单行
    const lines = linesData.map((line: any, index: number) => ({
      order_id: poId,
      line_number: startLineNumber + index,
      pr_id: line.prId || line.pr_id || null,
      pr_line_id: line.prLineId || line.pr_line_id || null,
      material_id: line.materialId || line.material_id || null,
      material_snapshot: line.materialSnapshot || line.material_name || '',
      quantity: line.quantity || line.qty || 0,
      unit_price: line.unitPrice || line.unit_price || 0,
      total_price: (line.quantity || line.qty || 0) * (line.unitPrice || line.unit_price || 0),
      received_qty: 0,
      pending_qty: line.quantity || line.qty || 0,
      status: 'ordered',
      fa_id: line.faId || line.fa_id || null,
      sourcing_task_id: line.sourcingTaskId || line.sourcing_task_id || null,
    }));

    // 批量插入
    const { data: insertedLines, error: linesError } = await client
      .from('purchase_order_lines')
      .insert(lines)
      .select();

    if (linesError) {
      return NextResponse.json({ error: linesError.message }, { status: 500 });
    }

    // 记录审计日志
    await client.from('audit_logs').insert({
      entity_type: 'purchase_order_line',
      entity_id: poId,
      action: 'create_batch',
      actor,
      actor_role: role,
      detail: { lines_count: linesData.length },
    });

    return NextResponse.json({ 
      success: true,
      data: insertedLines,
      count: insertedLines?.length || 0,
    }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
