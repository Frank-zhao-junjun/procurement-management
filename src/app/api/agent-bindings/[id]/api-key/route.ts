import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { getUserIdentity } from '@/lib/role-filter';
import { generateApiKey, setAgentApiKey, clearAgentApiKey } from '@/lib/api-key';

// POST /api/agent-bindings/{id}/api-key - 为 Agent 生成/设置 API Key
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentity(request);

    // 权限检查：只有 manager 可以生成 API Key
    if (role !== 'manager') {
      return NextResponse.json({ error: '只有 Manager 可以为 Agent 生成 API Key' }, { status: 403 });
    }

    // 验证 Agent 是否存在
    const { data: agent } = await client
      .from('agent_bindings')
      .select('id, agent_id, is_active')
      .eq('id', parseInt(id, 10))
      .single();

    if (!agent) {
      return NextResponse.json({ error: 'Agent 不存在' }, { status: 404 });
    }

    if (!agent.is_active) {
      return NextResponse.json({ error: 'Agent 未激活' }, { status: 400 });
    }

    // 生成新的 API Key
    const { plain, hash } = generateApiKey();

    // 保存到数据库
    const { error } = await client
      .from('agent_bindings')
      .update({ api_key_hash: hash, updated_at: new Date().toISOString() })
      .eq('id', agent.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 记录审计日志
    await client.from('audit_logs').insert({
      entity_type: 'agent_binding',
      entity_id: agent.id,
      action: 'generate_api_key',
      actor,
      actor_role: role,
      detail: { agent_id: agent.agent_id },
    });

    return NextResponse.json({
      success: true,
      agentId: agent.agent_id,
      apiKey: plain, // 仅在创建时返回明文，之后无法找回
      message: '请妥善保管 API Key，创建后无法再次查看明文',
    }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/agent-bindings/{id}/api-key - 清除 Agent 的 API Key
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentity(request);

    // 权限检查：只有 manager 可以清除 API Key
    if (role !== 'manager') {
      return NextResponse.json({ error: '只有 Manager 可以清除 API Key' }, { status: 403 });
    }

    // 验证 Agent 是否存在
    const { data: agent } = await client
      .from('agent_bindings')
      .select('id, agent_id')
      .eq('id', parseInt(id, 10))
      .single();

    if (!agent) {
      return NextResponse.json({ error: 'Agent 不存在' }, { status: 404 });
    }

    // 清除 API Key
    const { error } = await client
      .from('agent_bindings')
      .update({ api_key_hash: null, updated_at: new Date().toISOString() })
      .eq('id', agent.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 记录审计日志
    await client.from('audit_logs').insert({
      entity_type: 'agent_binding',
      entity_id: agent.id,
      action: 'clear_api_key',
      actor,
      actor_role: role,
      detail: { agent_id: agent.agent_id },
    });

    return NextResponse.json({ success: true, message: 'API Key 已清除' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
