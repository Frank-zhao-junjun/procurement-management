import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { insertSupplierSchema } from '@/storage/database/shared/schema';
import { getUserIdentity, type Role } from '@/lib/role-filter';

// GET /api/suppliers - 获取供应商列表
export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get('search') || '';
    const isActive = searchParams.get('isActive');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
    const offset = (page - 1) * pageSize;

    let query = client
      .from('suppliers')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (search) {
      query = query.or(`name.ilike.%${search}%,code.ilike.%${search}%,contact.ilike.%${search}%`);
    }

    if (isActive !== null && isActive !== undefined) {
      query = query.eq('is_active', isActive === 'true');
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

// POST /api/suppliers - 创建供应商
// 仅 buyer 和 manager 可创建
export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { actor, role } = getUserIdentity(request) as { actor: string; role: Role };
    const body = await request.json();

    // 仅 buyer 和 manager 可创建供应商
    if (role !== 'buyer' && role !== 'manager') {
      return NextResponse.json({ error: '只有 Buyer 或 Manager 可以创建供应商' }, { status: 403 });
    }

    // 验证输入
    const parsed = insertSupplierSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { data: supplier, error } = await client
      .from('suppliers')
      .insert(parsed.data)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 记录审计日志
    await client.from('audit_logs').insert({
      entity_type: 'supplier',
      entity_id: supplier.id,
      action: 'create',
      actor,
      actor_role: role,
      detail: { name: supplier.name },
    });

    return NextResponse.json({ data: supplier }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
