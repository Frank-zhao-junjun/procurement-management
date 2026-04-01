import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { updateMaterialSchema } from '@/storage/database/shared/schema';
import { getUserIdentityWithLookup, type Role } from '@/lib/role-filter';

// GET /api/materials/[id] - 获取单个物料
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();

    const { data, error } = await client
      .from('materials')
      .select('*')
      .eq('id', parseInt(id, 10))
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Material not found' }, { status: 404 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT /api/materials/[id] - 更新物料（仅 buyer/manager）
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
      return NextResponse.json({ error: '只有 Buyer 或 Manager 可以更新物料' }, { status: 403 });
    }

    const parsed = updateMaterialSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { data: existing, error: findError } = await client
      .from('materials')
      .select('id')
      .eq('id', parseInt(id, 10))
      .single();

    if (findError) {
      if (findError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Material not found' }, { status: 404 });
      }
      return NextResponse.json({ error: findError.message }, { status: 500 });
    }

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (parsed.data.code !== undefined) updateData.code = parsed.data.code;
    if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
    if (parsed.data.unit !== undefined) updateData.unit = parsed.data.unit;
    if (parsed.data.isActive !== undefined) updateData.is_active = parsed.data.isActive;

    const { data, error } = await client
      .from('materials')
      .update(updateData)
      .eq('id', parseInt(id, 10))
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await client.from('audit_logs').insert({
      entity_type: 'material',
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

// DELETE /api/materials/[id] - 删除物料（仅 buyer/manager）
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);

    if (role !== 'buyer' && role !== 'manager') {
      return NextResponse.json({ error: '只有 Buyer 或 Manager 可以删除物料' }, { status: 403 });
    }

    const { error } = await client
      .from('materials')
      .delete()
      .eq('id', parseInt(id, 10));

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await client.from('audit_logs').insert({
      entity_type: 'material',
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
