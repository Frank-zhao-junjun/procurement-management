/**
 * API Key 验证模块
 * 
 * 支持 X-API-Key 请求头验证
 * API Key 格式：sk_<base64url(random_32_bytes)>
 * 存储：SHA-256 哈希值（不存储明文）
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getServiceRoleClient } from '@/storage/database/supabase-client';
import type { Role } from '@/storage/database/agent-binding';

const API_KEY_PREFIX = 'sk_';

/**
 * 生成新的 API Key（明文）
 * 返回 { plain: 明文, hash: 存储用哈希 }
 */
export function generateApiKey(): { plain: string; hash: string } {
  const randomBytes_32 = randomBytes(32);
  const plain = API_KEY_PREFIX + randomBytes_32.toString('base64url');
  const hash = createHash('sha256').update(plain).digest('hex');
  return { plain, hash };
}

/**
 * 计算 API Key 的哈希值
 */
export function hashApiKey(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}

/**
 * 验证 API Key 是否有效（明文与哈希比对）
 */
export function verifyApiKey(plain: string, storedHash: string): boolean {
  const hash = createHash('sha256').update(plain).digest('hex');
  const a = Buffer.from(hash, 'utf8');
  const b = Buffer.from(storedHash, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * 验证请求头中的 API Key
 * 返回：{ agentId, role, bindingId } 或 null（验证失败）
 */
export async function verifyApiKeyHeader(
  apiKey: string | null
): Promise<{ agentId: string; role: Role; bindingId: number } | null> {
  if (!apiKey || !apiKey.startsWith(API_KEY_PREFIX)) {
    return null;
  }

  const client = getServiceRoleClient();
  const hash = hashApiKey(apiKey);

  const { data, error } = await client
    .from('agent_bindings')
    .select('id, agent_id, role')
    .eq('api_key_hash', hash)
    .eq('is_active', true)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return {
    agentId: data.agent_id as string,
    role: data.role as Role,
    bindingId: data.id as number,
  };
}

/**
 * 为 Agent 绑定设置 API Key
 */
export async function setAgentApiKey(
  agentId: string,
  plainApiKey: string
): Promise<{ success: boolean; error?: string }> {
  const client = getServiceRoleClient();

  // 验证 API Key 格式
  if (!plainApiKey.startsWith(API_KEY_PREFIX)) {
    return { success: false, error: 'Invalid API Key format' };
  }

  const hash = hashApiKey(plainApiKey);

  const { error } = await client
    .from('agent_bindings')
    .update({ api_key_hash: hash, updated_at: new Date().toISOString() })
    .eq('agent_id', agentId)
    .eq('is_active', true);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * 清除 Agent 的 API Key
 */
export async function clearAgentApiKey(
  agentId: string
): Promise<{ success: boolean; error?: string }> {
  const client = getServiceRoleClient();

  const { error } = await client
    .from('agent_bindings')
    .update({ api_key_hash: null, updated_at: new Date().toISOString() })
    .eq('agent_id', agentId)
    .eq('is_active', true);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}
