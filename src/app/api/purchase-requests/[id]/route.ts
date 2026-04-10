import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { getUserIdentityWithLookup } from '@/lib/role-filter';
import { getBeijingISOString } from '@/lib/datetime';
import { publishPrSubmitted } from '@/events/publisher';

// GET /api/purchase-requests/[id] - 获取单个采购申请
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();

    // 所有 Agent 都可以查询任何采购申请（移除角色过滤）
    const { data, error } = await client
      .from('purchase_requests')
      .select('*')
      .eq('id', parseInt(id, 10))
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
      .eq('request_id', parseInt(id, 10));

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

    // 查询当前 PR 状态
    const { data: existing, error: findError } = await client
      .from('purchase_requests')
      .select('id, status, applicant')
      .eq('id', parseInt(id, 10))
      .single();

    if (findError) {
      return NextResponse.json({ error: findError.message }, { status: 500 });
    }

    if (!existing) {
      return NextResponse.json({ error: '采购申请不存在' }, { status: 404 });
    }

    // 权限检查：只有申请人可以修改自己的 PR
    if (existing.applicant !== actor) {
      return NextResponse.json(
        { error: '只有申请人可以修改采购申请' },
        { status: 403 }
      );
    }

    // 状态判断：草稿状态可直接修改，待审批状态只能撤回后修改
    if (existing.status === 'draft') {
      // 草稿状态：直接修改
      return await updatePR(client, parseInt(id, 10), body, actor, role);
    } else if (existing.status === 'pending') {
      // 待审批状态：先撤回（改为草稿），再修改
      // 执行撤回操作
      const { error: cancelError } = await client
        .from('purchase_requests')
        .update({
          status: 'draft',
          updated_at: getBeijingISOString(),
        })
        .eq('id', parseInt(id, 10));

      if (cancelError) {
        return NextResponse.json({ error: cancelError.message }, { status: 500 });
      }

      // 记录撤回日志
      await client.from('audit_logs').insert({
        entity_type: 'purchase_request',
        entity_id: parseInt(id, 10),
        action: 'withdrawn',
        actor,
        actor_role: role,
        detail: { previousStatus: 'pending', reason: body.reason || '用户撤回修改' },
      });

      // 执行修改
      const updateResult = await updatePR(client, parseInt(id, 10), body, actor, role);

      // 返回撤回+修改的结果
      const response = await updateResult.json();
      return NextResponse.json({
        ...response,
        withdrawn: true,
        message: '采购申请已撤回（草稿状态），修改成功。需要重新提交。',
      }, { status: updateResult.status });
    } else {
      // 已审批/已拒绝等状态不允许修改
      return NextResponse.json(
        { error: `当前状态 "${existing.status}" 不允许修改采购申请` },
        { status: 400 }
      );
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * 执行 PR 修改
 */
async function updatePR(
  client: any,
  prId: number,
  body: any,
  actor: string,
  role: string
): Promise<NextResponse> {
  // 构建行项目快照
  const linesSnapshot = body.lines ? JSON.stringify(body.lines) : null;

  const updateData: any = {
    reason: body.reason,
    lines_snapshot: linesSnapshot,
    updated_at: getBeijingISOString(),
  };

  const { data, error } = await client
    .from('purchase_requests')
    .update(updateData)
    .eq('id', prId)
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
      .eq('request_id', prId);

    // 插入新行
    const lines = body.lines.map((line: any, index: number) => ({
      request_id: prId,
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
    .eq('request_id', prId);

  // 记录审计日志
  await client.from('audit_logs').insert({
    entity_type: 'purchase_request',
    entity_id: prId,
    action: 'update',
    actor,
    actor_role: role,
    detail: body,
  });

  return NextResponse.json({ data: { ...data, purchase_request_lines: lines } });
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

    // 检查状态
    const { data: existing } = await client
      .from('purchase_requests')
      .select('id, status, applicant')
      .eq('id', parseInt(id, 10))
      .single();

    if (!existing) {
      return NextResponse.json({ error: '采购申请不存在' }, { status: 404 });
    }

    // 权限检查：只有申请人可以删除自己的 PR
    if (existing.applicant !== actor) {
      return NextResponse.json(
        { error: '只有申请人可以删除采购申请' },
        { status: 403 }
      );
    }

    if (existing.status !== 'draft') {
      return NextResponse.json(
        { error: '只有草稿状态的采购申请可以删除' },
        { status: 400 }
      );
    }

    // 删除行项目
    await client
      .from('purchase_request_lines')
      .delete()
      .eq('request_id', parseInt(id, 10));

    // 删除 PR
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
