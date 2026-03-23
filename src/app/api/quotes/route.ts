import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { numberGenerators } from '@/storage/database/number-generator';
import { insertQuoteSchema } from '@/storage/database/shared/schema';
import { getUserIdentityWithLookup, filterQuotes, type Role } from '@/lib/role-filter';

// GET /api/quotes - 获取报价单列表
export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);
    const searchParams = request.nextUrl.searchParams;
    const sourcingTaskId = searchParams.get('sourcingTaskId');
    const supplierId = searchParams.get('supplierId');
    const status = searchParams.get('status');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
    const offset = (page - 1) * pageSize;

    let query = client
      .from('quotes')
      .select('*', { count: 'exact' })
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

// POST /api/quotes - 创建报价单（仅 buyer/manager）
export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);
    const body = await request.json();

    if (role !== 'buyer' && role !== 'manager') {
      return NextResponse.json({ error: '只有 Buyer 或 Manager 可以创建报价单' }, { status: 403 });
    }

    const parsed = insertQuoteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.issues },
        { status: 400 }
      );
    }

    const quoteNumber = await numberGenerators.quote();

    const quantity = parseFloat(String(parsed.data.quantity || '0'));
    const unitPrice = parseFloat(String(parsed.data.unitPrice || '0'));
    const totalPrice = quantity * unitPrice;

    let supplierSnapshot = parsed.data.supplierSnapshot || '';
    if (parsed.data.supplierId) {
      const { data: supplier } = await client
        .from('suppliers')
        .select('name')
        .eq('id', parsed.data.supplierId)
        .single();
      if (supplier) supplierSnapshot = supplier.name;
    }

    let materialSnapshot = parsed.data.materialSnapshot || '';
    if (parsed.data.materialId) {
      const { data: material } = await client
        .from('materials')
        .select('name')
        .eq('id', parsed.data.materialId)
        .single();
      if (material) materialSnapshot = material.name;
    }

    const { data: quote, error } = await client
      .from('quotes')
      .insert({
        quote_number: quoteNumber,
        sourcing_task_id: parsed.data.sourcingTaskId,
        supplier_id: parsed.data.supplierId,
        supplier_snapshot: supplierSnapshot,
        material_id: parsed.data.materialId ?? null,
        material_snapshot: materialSnapshot,
        unit_price: parsed.data.unitPrice,
        quantity: parsed.data.quantity,
        total_price: totalPrice,
        valid_until: parsed.data.validUntil ?? null,
        status: 'draft',
        awarded: 'pending',
        notes: parsed.data.notes ?? null,
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
