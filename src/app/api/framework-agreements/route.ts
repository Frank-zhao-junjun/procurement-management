import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { numberGenerators } from '@/storage/database/number-generator';

// 获取当前用户信息
function getActorInfo(request: NextRequest): { actor: string; role: string } {
  return {
    actor: request.headers.get('X-Actor') || 'system',
    role: request.headers.get('X-Role') || 'buyer',
  };
}

// GET /api/framework-agreements - 获取框架协议列表
export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status') || 'active';
    const supplierId = searchParams.get('supplierId');
    const materialId = searchParams.get('materialId');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
    const offset = (page - 1) * pageSize;

    let query = client
      .from('framework_agreements')
      .select('*, suppliers(name), materials(name)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (status) {
      query = query.eq('status', status);
    }

    if (supplierId) {
      query = query.eq('supplier_id', parseInt(supplierId, 10));
    }

    if (materialId) {
      query = query.eq('material_id', parseInt(materialId, 10));
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

// POST /api/framework-agreements - 创建框架协议
export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const body = await request.json();
    const { actor, role } = getActorInfo(request);

    // 生成 FA 编号（使用上海时区 + 99上限）
    const faNumber = await numberGenerators.fa();

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
    let materialSnapshot = body.materialSnapshot || body.materialOriginalText;
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
    const { data: fa, error } = await client
      .from('framework_agreements')
      .insert({
        fa_number: faNumber,
        supplier_id: body.supplierId || null,
        supplier_snapshot: supplierSnapshot,
        material_id: body.materialId || null,
        material_snapshot: materialSnapshot,
        material_original_text: body.materialOriginalText,
        match_confirm: 'confirmed',
        unit_price: body.unitPrice,
        valid_from: body.validFrom,
        valid_to: body.validTo,
        status: 'active',
        created_by: actor,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 记录审计日志
    await client.from('audit_logs').insert({
      entity_type: 'framework_agreement',
      entity_id: fa.id,
      action: 'create',
      actor,
      actor_role: role,
      detail: { fa_number: faNumber },
    });

    return NextResponse.json({ data: fa }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
