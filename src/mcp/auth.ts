/**
 * MCP Bearer 鉴权：与 agent_bindings 对齐，不新增表。
 * Token 格式：v1.<base64url(payload)>.<hex_hmac_sha256>
 * payload: { a: agent_id, exp: unix_seconds }
 * 签名消息：v1.<base64url 部分原文>
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { getServiceRoleClient } from '@/storage/database/supabase-client';

export type McpAuthContext = {
  agentId: string;
  role: string;
  bindingId: number;
};

function requireSecret(): string | null {
  const s = process.env.MCP_API_KEY_SECRET;
  return s && s.length > 0 ? s : null;
}

export function isMcpAuthConfigured(): boolean {
  return requireSecret() !== null;
}

/** 校验 Bearer，并确认 agent 在 agent_bindings 中且激活 */
export async function verifyMcpBearer(authorizationHeader: string | undefined): Promise<McpAuthContext> {
  const secret = requireSecret();
  if (!secret) {
    throw new Error('MCP_API_KEY_SECRET is not configured');
  }
  if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
    throw new Error('Missing or invalid Authorization header');
  }
  const token = authorizationHeader.slice('Bearer '.length).trim();
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') {
    throw new Error('Invalid MCP token format');
  }
  const [, payloadB64, sigHex] = parts;
  const expected = createHmac('sha256', secret).update(`v1.${payloadB64}`).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(sigHex, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('Invalid MCP token signature');
  }
  let payload: { a?: string; exp?: number };
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as { a?: string; exp?: number };
  } catch {
    throw new Error('Invalid MCP token payload');
  }
  if (!payload.a || typeof payload.exp !== 'number') {
    throw new Error('Invalid MCP token claims');
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) {
    throw new Error('MCP token expired');
  }

  const client = getServiceRoleClient();
  const { data, error } = await client
    .from('agent_bindings')
    .select('id, agent_id, role')
    .eq('agent_id', payload.a)
    .eq('is_active', true)
    .maybeSingle();

  if (error || !data) {
    throw new Error('Agent is not registered or inactive');
  }

  return {
    agentId: data.agent_id as string,
    role: data.role as string,
    bindingId: data.id as number,
  };
}

/** 开发环境未配置 secret 时的占位身份（仅本地联调；生产应配置 secret） */
export const MCP_DEV_FALLBACK: McpAuthContext = {
  agentId: 'mcp-dev',
  role: 'buyer',
  bindingId: 0,
};
