/**
 * Agent-first 绑定服务
 * 
 * 模型：一个 Agent ↔ 一个角色
 * - 每个 Agent 有唯一 agent_id 和固定 role
 * - 飞书用户可绑定到已有 Agent
 * - 一对一：一个飞书账号只能绑定一个 Agent
 */

import { getSupabaseClient } from './supabase-client';

// Agent 角色类型
export type Role = 'requester' | 'manager' | 'buyer';

// Agent 绑定记录
interface AgentBinding {
  id: number;
  agent_id: string;
  role: Role;
  feishu_user_id: string | null;
  feishu_open_id: string | null;
  feishu_app_id: string | null;
  feishu_union_id: string | null;
  webhook_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
}

// 注册新 Agent（仅角色，无飞书绑定）
export async function registerAgent(
  agentId: string,
  role: Role,
  webhookUrl?: string
): Promise<{ success: boolean; bindingId?: number; error?: string }> {
  const client = getSupabaseClient();

  // 检查是否已存在
  const { data: existing } = await client
    .from('agent_bindings')
    .select('id, is_active')
    .eq('agent_id', agentId)
    .single();

  if (existing) {
    if (existing.is_active) {
      // 已激活时更新 webhook_url
      if (webhookUrl !== undefined) {
        await client
          .from('agent_bindings')
          .update({ webhook_url: webhookUrl, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
      }
      return { success: true, bindingId: existing.id, error: 'Agent already registered' };
    }
    // 重新激活已有记录
    const { data, error } = await client
      .from('agent_bindings')
      .update({ role, is_active: true, webhook_url: webhookUrl || null, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select('id')
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, bindingId: data.id };
  }

  // 创建新记录
  const { data, error } = await client
    .from('agent_bindings')
    .insert({ agent_id: agentId, role, is_active: true, webhook_url: webhookUrl || null })
    .select('id')
    .single();

  if (error) return { success: false, error: error.message };

  // 记录审计日志
  await client.from('audit_logs').insert({
    entity_type: 'agent_binding',
    entity_id: data.id,
    action: 'register',
    actor: agentId,
    actor_role: role,
    detail: { agent_id: agentId, role },
  });

  return { success: true, bindingId: data.id };
}

// 创建/更新 Agent 并绑定飞书
export async function createOrUpdateAgent(
  agentId: string,
  role: Role,
  feishu: {
    feishuUserId?: string;
    feishuOpenId?: string;
    feishuUnionId?: string;
    feishuAppId?: string;
  }
): Promise<{ success: boolean; bindingId?: number; error?: string }> {
  const client = getSupabaseClient();

  // 检查飞书用户是否已绑定其他 Agent
  if (feishu.feishuUserId) {
    const { data: existingFeishu } = await client
      .from('agent_bindings')
      .select('id, agent_id')
      .eq('feishu_user_id', feishu.feishuUserId)
      .eq('is_active', true)
      .single();

    if (existingFeishu && existingFeishu.agent_id !== agentId) {
      return { success: false, error: '此飞书账号已绑定其他 Agent' };
    }
  }

  // 检查 Agent 是否已存在
  const { data: existingAgent } = await client
    .from('agent_bindings')
    .select('id, is_active')
    .eq('agent_id', agentId)
    .single();

  if (existingAgent) {
    // 更新现有记录
    const { data, error } = await client
      .from('agent_bindings')
      .update({
        role,
        feishu_user_id: feishu.feishuUserId || null,
        feishu_open_id: feishu.feishuOpenId || null,
        feishu_union_id: feishu.feishuUnionId || null,
        feishu_app_id: feishu.feishuAppId || null,
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingAgent.id)
      .select('id')
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, bindingId: data.id };
  }

  // 创建新记录
  const { data, error } = await client
    .from('agent_bindings')
    .insert({
      agent_id: agentId,
      role,
      feishu_user_id: feishu.feishuUserId || null,
      feishu_open_id: feishu.feishuOpenId || null,
      feishu_union_id: feishu.feishuUnionId || null,
      feishu_app_id: feishu.feishuAppId || null,
      is_active: true,
    })
    .select('id')
    .single();

  if (error) return { success: false, error: error.message };

  // 记录审计日志
  await client.from('audit_logs').insert({
    entity_type: 'agent_binding',
    entity_id: data.id,
    action: 'register_with_feishu',
    actor: agentId,
    actor_role: role,
    detail: { agent_id: agentId, role, feishu_user_id: feishu.feishuUserId },
  });

  return { success: true, bindingId: data.id };
}

// 根据 Agent ID 获取绑定
export async function getByAgentId(agentId: string): Promise<AgentBinding | null> {
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('agent_bindings')
    .select('*')
    .eq('agent_id', agentId)
    .eq('is_active', true)
    .single();

  if (error || !data) return null;
  return data as AgentBinding;
}

// 根据飞书用户 ID 获取绑定
export async function getByFeishuUserId(feishuUserId: string): Promise<AgentBinding | null> {
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('agent_bindings')
    .select('*')
    .eq('feishu_user_id', feishuUserId)
    .eq('is_active', true)
    .single();

  if (error || !data) return null;
  return data as AgentBinding;
}

// 根据角色获取所有绑定
export async function getByRole(role: Role): Promise<AgentBinding[]> {
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('agent_bindings')
    .select('*')
    .eq('role', role)
    .eq('is_active', true);

  if (error) return [];
  return (data || []) as AgentBinding[];
}

// 获取所有有 Webhook URL 的 Manager Agent
export async function getManagerWebhooks(): Promise<string[]> {
  const bindings = await getByRole('manager');
  return bindings
    .filter(b => b.webhook_url)
    .map(b => b.webhook_url as string);
}

// 获取所有活跃绑定
export async function getAllActive(): Promise<AgentBinding[]> {
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('agent_bindings')
    .select('*')
    .eq('is_active', true);

  if (error) return [];
  return (data || []) as AgentBinding[];
}

// 根据 agent_id 解析角色（用于 getUserIdentity 降级）
export async function resolveRoleByAgentId(agentId: string): Promise<Role | null> {
  const binding = await getByAgentId(agentId);
  return binding?.role || null;
}

// 根据飞书用户 ID 解析角色
export async function resolveRoleByFeishuUserId(feishuUserId: string): Promise<Role | null> {
  const binding = await getByFeishuUserId(feishuUserId);
  return binding?.role || null;
}
