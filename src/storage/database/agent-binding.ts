/**
 * Agent-first 绑定服务
 * 
 * 模型：一个 Agent ↔ 一个角色
 * - 每个 Agent 有唯一 agent_id 和固定 role
 * - 可选配置 webhook_url 接收通知
 */

import { getSupabaseClient } from './supabase-client';

// Agent 角色类型
export type Role = 'requester' | 'manager' | 'buyer';

// Agent 绑定记录
interface AgentBinding {
  id: number;
  agent_id: string;
  role: Role;
  webhook_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
}

// 注册新 Agent
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

// 获取所有有 Webhook URL 的 Requester Agent
export async function getRequesterWebhooks(): Promise<string[]> {
  const bindings = await getByRole('requester');
  return bindings
    .filter(b => b.webhook_url)
    .map(b => b.webhook_url as string);
}

// 获取所有有 Webhook URL 的 Buyer Agent
export async function getBuyerWebhooks(): Promise<string[]> {
  const bindings = await getByRole('buyer');
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

/**
 * 确保前端默认 Agent 已注册
 * 前端使用 web:requester / web:buyer / web:manager 作为默认身份
 * 如果数据库中没有这些记录，所有前端操作都会变成 anonymous 导致权限失败
 */
export async function ensureWebAgentsRegistered(): Promise<void> {
  const webAgents: Array<{ agentId: string; role: Role }> = [
    { agentId: 'web:requester', role: 'requester' },
    { agentId: 'web:buyer', role: 'buyer' },
    { agentId: 'web:manager', role: 'manager' },
  ];

  for (const { agentId, role } of webAgents) {
    const existing = await getByAgentId(agentId);
    if (!existing) {
      const result = await registerAgent(agentId, role);
      if (result.success) {
        console.log(`[Init] Auto-registered web agent: ${agentId} (${role})`);
      } else {
        console.warn(`[Init] Failed to register web agent ${agentId}: ${result.error}`);
      }
    }
  }
}
