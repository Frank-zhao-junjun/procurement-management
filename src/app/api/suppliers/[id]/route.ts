import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { updateSupplierSchema } from '@/storage/database/shared/schema';
import { getUserIdentityWithLookup, type Role } from '@/lib/role-filter';

// GET /api/suppliers/[id] - 获取单个供应商
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();

    const { data, error } = await client
      .from('suppliers')
      .select('*')
      .eq('id', parseInt(id, 10))
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT /api/suppliers/[id] - 更新供应商（仅 buyer/manager）
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);
    const body = await request.json();

    if (role !== 'buyer' && role !== 'manager') {
      return NextResponse.json({ error: '只有 Buyer 或 Manager 可以更新供应商' }, { status: 403 });
    }

    const parsed = updateSupplierSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.issues },
        { status: 400 }
      );
    }

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (parsed.data.code !== undefined) updateData.code = parsed.data.code;
    if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
    if (parsed.data.contact !== undefined) updateData.contact = parsed.data.contact;
    if (parsed.data.email !== undefined) updateData.email = parsed.data.email;
    if (parsed.data.phone !== undefined) updateData.phone = parsed.data.phone;
    if (parsed.data.address !== undefined) updateData.address = parsed.data.address;
    if (parsed.data.note !== undefined) updateData.note = parsed.data.note;
    if (parsed.data.isActive !== undefined) updateData.is_active = parsed.data.isActive;

    const { data, error } = await client
      .from('suppliers')
      .update(updateData)
      .eq('id', parseInt(id, 10))
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await client.from('audit_logs').insert({
      entity_type: 'supplier',
      entity_id: parseInt(id, 10),
      action: 'update',
      actor,
      actor_role: role,
      detail: parsed.data,
    });

    return NextResponse.json({ data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/suppliers/[id] - 删除供应商（仅 buyer/manager）
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);

    if (role !== 'buyer' && role !== 'manager') {
      return NextResponse.json({ error: '只有 Buyer 或 Manager 可以删除供应商' }, { status: 403 });
    }

    const { error } = await client
      .from('suppliers')
      .delete()
      .eq('id', parseInt(id, 10));

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await client.from('audit_logs').insert({
      entity_type: 'supplier',
      entity_id: parseInt(id, 10),
      action: 'delete',
      actor,
      actor_role: role,
      detail: {},
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
