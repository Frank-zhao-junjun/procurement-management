import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { numberGenerators } from '@/storage/database/number-generator';
import { getUserIdentity, filterQuotes, type Role } from '@/lib/role-filter';

// GET /api/quotes - 获取报价单列表
export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { actor, role } = getUserIdentity(request);
    const searchParams = request.nextUrl.searchParams;
    const sourcingTaskId = searchParams.get('sourcingTaskId');
    const supplierId = searchParams.get('supplierId');
    const status = searchParams.get('status');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
    const offset = (page - 1) * pageSize;

    let query = client
      .from('quotes')
      .select('*, sourcing_tasks(task_number), suppliers(name), materials(name)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (sourcingTaskId) {
      query = query.eq('sourcing_task_id', parseInt(sourcingTaskId, 10));
    }

    if (supplierId) {
      query = query.eq('supplier_id', parseInt(supplierId, 10));
    }

    if (status) {
      query = query.eq('status', status);
    }

    // 按角色过滤
    query = filterQuotes(query, role as Role, actor);

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

// POST /api/quotes - 创建报价单
export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { actor, role } = getUserIdentity(request);
    const body = await request.json();

    // 生成报价单编号（使用 Q- 前缀 + 上海时区 + 99上限）
    const quoteNumber = await numberGenerators.quote();

    // 计算总价
    const quantity = parseFloat(body.quantity || '0');
    const unitPrice = parseFloat(body.unitPrice || '0');
    const totalPrice = quantity * unitPrice;

    // 获取供应商快照
    let supplierSnapshot = body.supplierSnapshot || '';
    if (body.supplierId) {
      const { data: supplier } = await client
        .from('suppliers')
        .select('name')
        .eq('id', body.supplierId)
        .single();
      if (supplier) {
        supplierSnapshot = supplier.name;
      }
    }

    // 获取物料快照
    let materialSnapshot = body.materialSnapshot || '';
    if (body.materialId) {
      const { data: material } = await client
        .from('materials')
        .select('name')
        .eq('id', body.materialId)
        .single();
      if (material) {
        materialSnapshot = material.name;
      }
    }

    // 插入数据
    const { data: quote, error } = await client
      .from('quotes')
      .insert({
        quote_number: quoteNumber,
        sourcing_task_id: body.sourcingTaskId,
        supplier_id: body.supplierId,
        supplier_snapshot: supplierSnapshot,
        material_id: body.materialId || null,
        material_snapshot: materialSnapshot,
        unit_price: body.unitPrice,
        quantity: body.quantity,
        total_price: totalPrice,
        valid_until: body.validUntil || null,
        status: 'draft',
        awarded: 'pending',
        notes: body.notes || null,
        created_by: actor,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 记录审计日志
    await client.from('audit_logs').insert({
      entity_type: 'quote',
      entity_id: quote.id,
      action: 'create',
      actor,
      actor_role: role,
      detail: { quote_number: quoteNumber },
    });

    return NextResponse.json({ data: quote }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
