/**
 * MCP 工具与 agent_bindings.role 对齐，避免与 REST API 权限双轨。
 * buyer / manager：全部工具；requester：只读/申请类（与 AGENTS 能力一致）。
 */

const REQUESTER_TOOLS = new Set<string>([
  'match_material',
  'list_materials',
  'create_material',
  'list_suppliers',
  'create_purchase_request',
  'list_purchase_requests',
  'submit_purchase_request',
  'list_purchase_orders',
  'list_goods_receipts',
  'list_sourcing_tasks',
]);

export function canInvokeTool(role: string, toolName: string): boolean {
  if (role === 'buyer' || role === 'manager') {
    return true;
  }
  if (role === 'requester') {
    return REQUESTER_TOOLS.has(toolName);
  }
  return false;
}
