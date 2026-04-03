import { getServiceRoleClient } from '@/storage/database/supabase-client';
import type { McpAuthContext } from './auth';

export type McpAuditPayload = {
  ctx: McpAuthContext;
  toolName: string;
  ok: boolean;
  detail?: Record<string, unknown>;
};

/** 写入 audit_logs，与 REST 侧一致 */
export async function logMcpToolCall(payload: McpAuditPayload): Promise<void> {
  try {
    const client = getServiceRoleClient();
    await client.from('audit_logs').insert({
      entity_type: 'mcp',
      entity_id: payload.ctx.bindingId || 0,
      action: payload.ok ? 'mcp_tool_ok' : 'mcp_tool_error',
      actor: payload.ctx.agentId,
      actor_role: payload.ctx.role as 'requester' | 'buyer' | 'manager',
      detail: {
        tool: payload.toolName,
        ...payload.detail,
      },
    });
  } catch (e) {
    console.error('[MCP] audit_logs insert failed:', e);
  }
}
