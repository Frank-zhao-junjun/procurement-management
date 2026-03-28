import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { getUserIdentityWithLookup } from '@/lib/role-filter';

// GET /api/agent-bindings/[id] - 获取单个 Agent
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();

    const { data, error } = await client
      .from('agent_bindings')
      .select('*')
      .eq('id', parseInt(id, 10))
      .single();

    if (error) {
      return NextResponse.json({ error: 'Agent 不存在' }, { status: 404 });
    }

    return NextResponse.json({ data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT /api/agent-bindings/[id] - 更新 Agent
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const { actor, role: currentRole } = await getUserIdentityWithLookup(request);
    const body = await request.json();

    // 权限检查：只有 manager 可以更新 Agent
    if (currentRole !== 'manager') {
      return NextResponse.json({ error: '只有 Manager 可以更新 Agent' }, { status: 403 });
    }

    // 构建更新数据
    const updateData: Record<string, any> = {};
    
    if (body.role !== undefined) {
      const validRoles = ['requester', 'buyer', 'manager'];
      if (!validRoles.includes(body.role)) {
        return NextResponse.json({ 
          error: `无效的角色，只能是: ${validRoles.join(', ')}` 
        }, { status: 400 });
      }
      updateData.role = body.role;
    }
    
    if (body.webhookUrl !== undefined) {
      updateData.webhook_url = body.webhookUrl;
    }
    if (body.webhook_url !== undefined) {
      updateData.webhook_url = body.webhook_url;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: '没有提供更新字段' }, { status: 400 });
    }

    const { data, error } = await client
      .from('agent_bindings')
      .update(updateData)
      .eq('id', parseInt(id, 10))
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 记录审计日志
    await client.from('audit_logs').insert({
      entity_type: 'agent_binding',
      entity_id: parseInt(id, 10),
      action: 'update',
      actor,
      actor_role: currentRole,
      detail: updateData,
    });

    return NextResponse.json({ data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/agent-bindings/[id] - 删除 Agent
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const { actor, role: currentRole } = await getUserIdentityWithLookup(request);

    // 权限检查：只有 manager 可以删除 Agent
    if (currentRole !== 'manager') {
      return NextResponse.json({ error: '只有 Manager 可以删除 Agent' }, { status: 403 });
    }

    // 获取要删除的 Agent 信息
    const { data: existing } = await client
      .from('agent_bindings')
      .select('agent_id')
      .eq('id', parseInt(id, 10))
      .single();

    if (!existing) {
      return NextResponse.json({ error: 'Agent 不存在' }, { status: 404 });
    }

    // 删除
    const { error } = await client
      .from('agent_bindings')
      .delete()
      .eq('id', parseInt(id, 10));

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 记录审计日志
    await client.from('audit_logs').insert({
      entity_type: 'agent_binding',
      entity_id: parseInt(id, 10),
      action: 'delete',
      actor,
      actor_role: currentRole,
      detail: { agent_id: existing.agent_id },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
