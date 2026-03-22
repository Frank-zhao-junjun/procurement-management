import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';

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

// PUT /api/materials/[id] - 更新物料
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const body = await request.json();

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

    const { data, error } = await client
      .from('materials')
      .update({
        ...body,
        updated_at: new Date().toISOString(),
      })
      .eq('id', parseInt(id, 10))
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 记录审计日志
    const actor = request.headers.get('X-Actor') || 'system';
    await client.from('audit_logs').insert({
      entity_type: 'material',
      entity_id: parseInt(id, 10),
      action: 'update',
      actor,
      detail: body,
    });

    return NextResponse.json({ data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/materials/[id] - 删除物料
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();

    const { error } = await client
      .from('materials')
      .delete()
      .eq('id', parseInt(id, 10));

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 记录审计日志
    const actor = request.headers.get('X-Actor') || 'system';
    await client.from('audit_logs').insert({
      entity_type: 'material',
      entity_id: parseInt(id, 10),
      action: 'delete',
      actor,
      detail: {},
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
