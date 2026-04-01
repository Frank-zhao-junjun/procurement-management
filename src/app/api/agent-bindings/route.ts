import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { getUserIdentityWithLookup } from '@/lib/role-filter';

// GET /api/agent-bindings - 获取 Agent 列表
export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { actor, role: currentRole } = await getUserIdentityWithLookup(request);
    const searchParams = request.nextUrl.searchParams;
    const role = searchParams.get('role');
    const agentId = searchParams.get('agentId');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
    const offset = (page - 1) * pageSize;

    let query = client
      .from('agent_bindings')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    // 非 manager 只能查看自己的 Agent 绑定信息
    if (currentRole !== 'manager') {
      query = query.eq('agent_id', actor);
    } else {
      if (role) {
        query = query.eq('role', role);
      }
      if (agentId) {
        query = query.eq('agent_id', agentId);
      }
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

// POST /api/agent-bindings - 创建 Agent 注册
export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { actor, role: currentRole } = await getUserIdentityWithLookup(request);
    const body = await request.json();

    // 权限检查：只有 manager 可以创建 Agent
    if (currentRole !== 'manager') {
      return NextResponse.json({ error: '只有 Manager 可以注册 Agent' }, { status: 403 });
    }

    // 验证必填参数
    if (!body.agentId) {
      return NextResponse.json({ error: 'agentId 为必填参数' }, { status: 400 });
    }

    if (!body.role) {
      return NextResponse.json({ error: 'role 为必填参数' }, { status: 400 });
    }

    // 验证角色值
    const validRoles = ['requester', 'buyer', 'manager'];
    if (!validRoles.includes(body.role)) {
      return NextResponse.json({ 
        error: `无效的角色，只能是: ${validRoles.join(', ')}` 
      }, { status: 400 });
    }

    // 检查是否已存在
    const { data: existing } = await client
      .from('agent_bindings')
      .select('id')
      .eq('agent_id', body.agentId)
      .single();

    if (existing) {
      return NextResponse.json({ error: `Agent ${body.agentId} 已存在` }, { status: 409 });
    }

    // 创建 Agent 注册
    const { data: agent, error } = await client
      .from('agent_bindings')
      .insert({
        agent_id: body.agentId,
        role: body.role,
        webhook_url: body.webhookUrl || body.webhook_url || null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 记录审计日志
    await client.from('audit_logs').insert({
      entity_type: 'agent_binding',
      entity_id: agent.id,
      action: 'create',
      actor,
      actor_role: currentRole,
      detail: { agent_id: body.agentId, role: body.role },
    });

    return NextResponse.json({ data: agent }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
