import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { canAccessPurchaseRequest, getUserIdentityWithLookup, type Role } from '@/lib/role-filter';

// GET /api/purchase-requests/[id] - 获取单个采购申请
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);
    const requestId = parseInt(id, 10);

    if (!(await canAccessPurchaseRequest(client, role as Role, actor, requestId))) {
      return NextResponse.json({ error: '无权限查看该采购申请' }, { status: 403 });
    }

    const { data, error } = await client
      .from('purchase_requests')
      .select('*')
      .eq('id', requestId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Purchase request not found' }, { status: 404 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 获取行项目
    const { data: lines } = await client
      .from('purchase_request_lines')
      .select('*')
      .eq('request_id', requestId);

    return NextResponse.json({ data: { ...data, purchase_request_lines: lines } });
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
    const { actor, role } = await getUserIdentityWithLookup(request);
    const requestId = parseInt(id, 10);

    if (!(await canAccessPurchaseRequest(client, role as Role, actor, requestId))) {
      return NextResponse.json({ error: '无权限修改该采购申请' }, { status: 403 });
    }

    // 检查当前状态
    const { data: existing, error: findError } = await client
      .from('purchase_requests')
      .select('id, status')
      .eq('id', requestId)
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

    // 构建行项目快照
    const linesSnapshot = body.lines ? JSON.stringify(body.lines) : null;

    const updateData: any = {
      reason: body.reason,
      lines_snapshot: linesSnapshot,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await client
      .from('purchase_requests')
      .update(updateData)
      .eq('id', requestId)
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
        .eq('request_id', requestId);

      // 插入新行
      const lines = body.lines.map((line: any, index: number) => ({
        request_id: requestId,
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

    // 获取行项目
    const { data: lines } = await client
      .from('purchase_request_lines')
      .select('*')
      .eq('request_id', requestId);

    // 记录审计日志
    await client.from('audit_logs').insert({
      entity_type: 'purchase_request',
      entity_id: requestId,
      action: 'update',
      actor,
      actor_role: role,
      detail: body,
    });

    return NextResponse.json({ data: { ...data, purchase_request_lines: lines } });
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
    const { actor, role } = await getUserIdentityWithLookup(request);
    const requestId = parseInt(id, 10);

    if (!(await canAccessPurchaseRequest(client, role as Role, actor, requestId))) {
      return NextResponse.json({ error: '无权限删除该采购申请' }, { status: 403 });
    }

    // 检查状态
    const { data: existing } = await client
      .from('purchase_requests')
      .select('id, status')
      .eq('id', requestId)
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
      .eq('id', requestId);

    // 记录审计日志
    await client.from('audit_logs').insert({
      entity_type: 'purchase_request',
      entity_id: requestId,
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
