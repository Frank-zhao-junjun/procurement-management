import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { getUserIdentity, type Role } from '@/lib/role-filter';

// GET /api/purchase-requests/[id] - 获取单个采购申请
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();

    const { data, error } = await client
      .from('purchase_requests')
      .select('*, purchase_request_lines(*)')
      .eq('id', parseInt(id, 10))
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Purchase request not found' }, { status: 404 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT /api/purchase-requests/[id] - 更新采购申请
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const body = await request.json();
    const { actor, role } = getUserIdentity(request) as { actor: string; role: Role };

    // 检查当前状态
    const { data: existing, error: findError } = await client
      .from('purchase_requests')
      .select('id, status')
      .eq('id', parseInt(id, 10))
      .single();

    if (findError) {
      return NextResponse.json({ error: findError.message }, { status: 500 });
    }

    // 只有草稿状态才能更新
    if (existing.status !== 'draft') {
      return NextResponse.json(
        { error: 'Only draft requests can be updated' },
        { status: 400 }
      );
    }

    const updateData: any = {
      reason: body.reason,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await client
      .from('purchase_requests')
      .update(updateData)
      .eq('id', parseInt(id, 10))
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 更新行项目
    if (body.lines && body.lines.length > 0) {
      // 删除旧行
      await client
        .from('purchase_request_lines')
        .delete()
        .eq('request_id', parseInt(id, 10));

      // 插入新行
      const lines = body.lines.map((line: any, index: number) => ({
        request_id: parseInt(id, 10),
        line_number: index + 1,
        material_id: line.materialId || null,
        material_snapshot: line.materialSnapshot || line.requirementText,
        requirement_text: line.requirementText,
        quantity: line.quantity,
        est_unit_price: line.estUnitPrice || null,
        expected_delivery_date: line.expectedDeliveryDate || null,
        note: line.note || null,
        progress: 'pending',
      }));

      await client.from('purchase_request_lines').insert(lines);
    }

    // 获取完整数据
    const { data: fullPR } = await client
      .from('purchase_requests')
      .select('*, purchase_request_lines(*)')
      .eq('id', parseInt(id, 10))
      .single();

    // 记录审计日志
    await client.from('audit_logs').insert({
      entity_type: 'purchase_request',
      entity_id: parseInt(id, 10),
      action: 'update',
      actor,
      actor_role: role,
      detail: body,
    });

    return NextResponse.json({ data: fullPR });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/purchase-requests/[id] - 删除采购申请
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const { actor, role } = getUserIdentity(request) as { actor: string; role: Role };

    // 检查状态
    const { data: existing } = await client
      .from('purchase_requests')
      .select('id, status')
      .eq('id', parseInt(id, 10))
      .single();

    if (existing && existing.status !== 'draft') {
      return NextResponse.json(
        { error: 'Only draft requests can be deleted' },
        { status: 400 }
      );
    }

    await client
      .from('purchase_requests')
      .delete()
      .eq('id', parseInt(id, 10));

    // 记录审计日志
    await client.from('audit_logs').insert({
      entity_type: 'purchase_request',
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
