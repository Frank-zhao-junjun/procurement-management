/**
 * MCP 工具与 agent_bindings.role 对齐
 * 
 * 基于细粒度权限配置，确保 MCP 工具与 REST API 权限一致
 * 
 * 权限矩阵：
 * ┌─────────────┬──────────────────────────────────────────────────────────┐
 * │ 角色        │ 权限说明                                                  │
 * ├─────────────┼──────────────────────────────────────────────────────────┤
 * │ buyer       │ 创建供应商、输入报价单、查看所有数据                         │
 * │ requester   │ 创建采购申请、创建物料、输入收货数量、查看自己相关数据         │
 * │ manager     │ 审批采购申请、审批超收、查看所有数据                         │
 * └─────────────┴──────────────────────────────────────────────────────────┘
 */

import type { Role } from '@/storage/database/agent-binding';

// 工具权限映射 - 与权限配置文件对齐
const TOOL_PERMISSION_MAP: Record<string, { resource: string; action: string }> = {
  // 物料工具
  match_material: { resource: 'materials', action: 'list' },
  list_materials: { resource: 'materials', action: 'list' },
  create_material: { resource: 'materials', action: 'create' },

  // 供应商工具
  list_suppliers: { resource: 'suppliers', action: 'list' },
  create_supplier: { resource: 'suppliers', action: 'create' },

  // 采购申请工具
  create_purchase_request: { resource: 'purchase_requests', action: 'create' },
  list_purchase_requests: { resource: 'purchase_requests', action: 'list' },
  submit_purchase_request: { resource: 'purchase_requests', action: 'submit' },

  // 寻源任务工具
  create_sourcing_task: { resource: 'sourcing_tasks', action: 'create' },
  list_sourcing_tasks: { resource: 'sourcing_tasks', action: 'list' },
  get_pending_sourcing: { resource: 'sourcing_tasks', action: 'list' },
  get_sourcing_task: { resource: 'sourcing_tasks', action: 'get' },
  update_sourcing_task: { resource: 'sourcing_tasks', action: 'update' },

  // 报价单工具
  create_quote: { resource: 'quotes', action: 'create' },
  award_quote: { resource: 'quotes', action: 'award' },

  // 框架协议工具
  match_framework_agreement: { resource: 'purchase_request_lines', action: 'list' },
  confirm_framework_agreement: { resource: 'purchase_request_lines', action: 'update' },

  // 采购订单工具
  create_purchase_order: { resource: 'purchase_orders', action: 'create' },
  list_purchase_orders: { resource: 'purchase_orders', action: 'list' },
  send_purchase_order: { resource: 'purchase_orders', action: 'send' },

  // 收货单工具
  create_goods_receipt: { resource: 'goods_receipts', action: 'create' },
  list_goods_receipts: { resource: 'goods_receipts', action: 'list' },
};

// 角色权限矩阵 - 简化版，用于快速检查
type RolePermission = {
  resources: Record<string, string[]>; // resource -> actions[]
};

const ROLE_PERMISSIONS: Record<Role, RolePermission> = {
  buyer: {
    resources: {
      materials: ['list', 'get'],
      suppliers: ['list', 'get', 'create'],
      purchase_requests: ['list', 'get'],
      purchase_request_lines: ['list', 'get'],
      sourcing_tasks: ['list', 'get', 'create', 'update'],
      quotes: ['list', 'get', 'create', 'award'],
      framework_agreements: ['list', 'get'],
      purchase_orders: ['list', 'get', 'create', 'send', 'update'],
      purchase_order_lines: ['list', 'get', 'create'],
      goods_receipts: ['list', 'get', 'create'],
    },
  },
  requester: {
    resources: {
      materials: ['list', 'get', 'create'],
      suppliers: ['list', 'get'],
      purchase_requests: ['list', 'get', 'create', 'submit'],
      purchase_request_lines: ['list', 'get'],
      sourcing_tasks: ['list', 'get'],
      quotes: ['list', 'get'],
      framework_agreements: ['list', 'get'],
      purchase_orders: ['list', 'get'],
      purchase_order_lines: ['list', 'get'],
      goods_receipts: ['list', 'get', 'create'],
    },
  },
  manager: {
    resources: {
      materials: ['list', 'get'],
      suppliers: ['list', 'get'],
      purchase_requests: ['list', 'get', 'approve', 'reject'],
      purchase_request_lines: ['list', 'get', 'approve', 'reject'],
      sourcing_tasks: ['list', 'get'],
      quotes: ['list', 'get'],
      framework_agreements: ['list', 'get', 'approve', 'reject'],
      purchase_orders: ['list', 'get'],
      purchase_order_lines: ['list', 'get'],
      goods_receipts: ['list', 'get', 'approve'],
    },
  },
};

/**
 * 检查角色是否有权限使用某个工具
 * @param role Agent 角色
 * @param toolName MCP 工具名称
 * @returns 是否有权限
 */
export function canInvokeTool(role: string, toolName: string): boolean {
  const perm = TOOL_PERMISSION_MAP[toolName];
  if (!perm) {
    // 未知工具默认拒绝
    return false;
  }

  const rolePerm = ROLE_PERMISSIONS[role as Role];
  if (!rolePerm) {
    return false;
  }

  const actions = rolePerm.resources[perm.resource];
  if (!actions) {
    return false;
  }

  return actions.includes(perm.action);
}

/**
 * 获取工具的权限信息
 */
export function getToolPermission(toolName: string): { resource: string; action: string } | null {
  return TOOL_PERMISSION_MAP[toolName] || null;
}

/**
 * 获取角色可用的工具列表
 */
export function getAvailableTools(role: Role): string[] {
  return Object.keys(TOOL_PERMISSION_MAP).filter(tool => canInvokeTool(role, tool));
}
