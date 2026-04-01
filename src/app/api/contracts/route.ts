import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { getUserIdentityWithLookup } from '@/lib/role-filter';
import { onContractPending } from '@/lib/agent-notify';

// GET /api/contracts - 获取框架协议列表
export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status');
    const supplierId = searchParams.get('supplierId');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
    const offset = (page - 1) * pageSize;

    let query = client
      .from('contracts')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (status) {
      query = query.eq('status', status);
    }

    if (supplierId) {
      query = query.eq('supplier_id', parseInt(supplierId, 10));
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

// POST /api/contracts - 创建框架协议
export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);
    const body = await request.json();

    const supplierId = body.supplierId || body.supplier_id;
    
    // 验证供应商存在
    if (supplierId) {
      const { data: supplier, error: supplierError } = await client
        .from('suppliers')
        .select('id, name')
        .eq('id', supplierId)
        .single();
      
      if (supplierError || !supplier) {
        return NextResponse.json({ 
          error: `无效的供应商 ID: ${supplierId}，该供应商不存在` 
        }, { status: 400 });
      }
    }

    const insertData: any = {
      title: body.title,
      supplier_id: supplierId,
      supplier_snapshot: body.supplierSnapshot || body.supplier_snapshot || '',
      contract_type: body.contractType || body.contract_type || 'framework',
      valid_from: body.validFrom || body.valid_from,
      valid_until: body.validUntil || body.valid_until,
      payment_terms: body.paymentTerms || body.payment_terms,
      delivery_terms: body.deliveryTerms || body.delivery_terms,
      description: body.description,
      status: body.status || 'draft',
      created_by: actor,
    };

    const { data, error } = await client
      .from('contracts')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 记录审计日志
    await client.from('audit_logs').insert({
      entity_type: 'contract',
      entity_id: data.id,
      action: 'create',
      actor,
      actor_role: role,
      detail: { title: body.title },
    });

    return NextResponse.json({ data }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
