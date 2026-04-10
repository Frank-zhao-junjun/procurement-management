/**
 * MCP 工具权限配置
 * 
 * 与 REST API 权限对齐，实现统一的 Agent 权限控制
 * 
 * Buyer: 创建供应商、输入报价单、查看所有数据
 * Requester: 创建采购申请、创建物料、输入收货数量、查看自己相关数据
 * Manager: 审批采购申请、审批超收、查看所有数据
 */

import type { Role } from '@/storage/database/agent-binding';

// 工具名称
export const TOOL_NAMES = {
  // 物料
  MATCH_MATERIAL: 'match_material',
  LIST_MATERIALS: 'list_materials',
  CREATE_MATERIAL: 'create_material',
  // 供应商
  LIST_SUPPLIERS: 'list_suppliers',
  CREATE_SUPPLIER: 'create_supplier',
  // 采购申请
  CREATE_PURCHASE_REQUEST: 'create_purchase_request',
  LIST_PURCHASE_REQUESTS: 'list_purchase_requests',
  SUBMIT_PURCHASE_REQUEST: 'submit_purchase_request',
  // 采购申请行
  MATCH_FRAMEWORK_AGREEMENT: 'match_framework_agreement',
  CONFIRM_FRAMEWORK_AGREEMENT: 'confirm_framework_agreement',
  // 寻源任务
  CREATE_SOURCING_TASK: 'create_sourcing_task',
  LIST_SOURCING_TASKS: 'list_sourcing_tasks',
  GET_PENDING_SOURCING: 'get_pending_sourcing',
  GET_SOURCING_TASK: 'get_sourcing_task',
  UPDATE_SOURCING_TASK: 'update_sourcing_task',
  // 报价单
  CREATE_QUOTE: 'create_quote',
  AWARD_QUOTE: 'award_quote',
  // 采购订单
  CREATE_PURCHASE_ORDER: 'create_purchase_order',
  LIST_PURCHASE_ORDERS: 'list_purchase_orders',
  SEND_PURCHASE_ORDER: 'send_purchase_order',
  // 收货单
  CREATE_GOODS_RECEIPT: 'create_goods_receipt',
  LIST_GOODS_RECEIPTS: 'list_goods_receipts',
} as const;

export type ToolName = typeof TOOL_NAMES[keyof typeof TOOL_NAMES];

// 工具到权限的映射
type ToolPermission = {
  requiredActions: { resource: string; action: string }[];
  description: string;
};

export const TOOL_PERMISSIONS: Record<ToolName, ToolPermission> = {
  // ========== 物料工具 ==========
  [TOOL_NAMES.MATCH_MATERIAL]: {
    requiredActions: [{ resource: 'materials', action: 'read' }],
    description: '匹配物料',
  },
  [TOOL_NAMES.LIST_MATERIALS]: {
    requiredActions: [{ resource: 'materials', action: 'list' }],
    description: '查询物料列表',
  },
  [TOOL_NAMES.CREATE_MATERIAL]: {
    requiredActions: [{ resource: 'materials', action: 'create' }],
    description: '创建物料',
  },

  // ========== 供应商工具 ==========
  [TOOL_NAMES.LIST_SUPPLIERS]: {
    requiredActions: [{ resource: 'suppliers', action: 'list' }],
    description: '查询供应商列表',
  },
  [TOOL_NAMES.CREATE_SUPPLIER]: {
    requiredActions: [{ resource: 'suppliers', action: 'create' }],
    description: '创建供应商',
  },

  // ========== 采购申请工具 ==========
  [TOOL_NAMES.CREATE_PURCHASE_REQUEST]: {
    requiredActions: [{ resource: 'purchase_requests', action: 'create' }],
    description: '创建采购申请',
  },
  [TOOL_NAMES.LIST_PURCHASE_REQUESTS]: {
    requiredActions: [{ resource: 'purchase_requests', action: 'list' }],
    description: '查询采购申请列表',
  },
  [TOOL_NAMES.SUBMIT_PURCHASE_REQUEST]: {
    requiredActions: [{ resource: 'purchase_requests', action: 'submit' }],
    description: '提交采购申请',
  },

  // ========== 框架协议工具 ==========
  [TOOL_NAMES.MATCH_FRAMEWORK_AGREEMENT]: {
    requiredActions: [{ resource: 'purchase_request_lines', action: 'read' }],
    description: '匹配框架协议',
  },
  [TOOL_NAMES.CONFIRM_FRAMEWORK_AGREEMENT]: {
    requiredActions: [{ resource: 'purchase_request_lines', action: 'update' }],
    description: '确认框架协议匹配',
  },

  // ========== 寻源任务工具 ==========
  [TOOL_NAMES.CREATE_SOURCING_TASK]: {
    requiredActions: [{ resource: 'sourcing_tasks', action: 'create' }],
    description: '创建寻源任务',
  },
  [TOOL_NAMES.LIST_SOURCING_TASKS]: {
    requiredActions: [{ resource: 'sourcing_tasks', action: 'list' }],
    description: '查询寻源任务列表',
  },
  [TOOL_NAMES.GET_PENDING_SOURCING]: {
    requiredActions: [{ resource: 'sourcing_tasks', action: 'list' }],
    description: '获取待寻源的采购申请行',
  },
  [TOOL_NAMES.GET_SOURCING_TASK]: {
    requiredActions: [{ resource: 'sourcing_tasks', action: 'get' }],
    description: '获取寻源任务详情',
  },
  [TOOL_NAMES.UPDATE_SOURCING_TASK]: {
    requiredActions: [{ resource: 'sourcing_tasks', action: 'update' }],
    description: '更新寻源任务',
  },

  // ========== 报价单工具 ==========
  [TOOL_NAMES.CREATE_QUOTE]: {
    requiredActions: [{ resource: 'quotes', action: 'create' }],
    description: '创建报价单',
  },
  [TOOL_NAMES.AWARD_QUOTE]: {
    requiredActions: [{ resource: 'quotes', action: 'award' }],
    description: '授标报价单',
  },

  // ========== 采购订单工具 ==========
  [TOOL_NAMES.CREATE_PURCHASE_ORDER]: {
    requiredActions: [{ resource: 'purchase_orders', action: 'create' }],
    description: '创建采购订单',
  },
  [TOOL_NAMES.LIST_PURCHASE_ORDERS]: {
    requiredActions: [{ resource: 'purchase_orders', action: 'list' }],
    description: '查询采购订单列表',
  },
  [TOOL_NAMES.SEND_PURCHASE_ORDER]: {
    requiredActions: [{ resource: 'purchase_orders', action: 'send' }],
    description: '发送采购订单',
  },

  // ========== 收货单工具 ==========
  [TOOL_NAMES.CREATE_GOODS_RECEIPT]: {
    requiredActions: [{ resource: 'goods_receipts', action: 'create' }],
    description: '创建收货单',
  },
  [TOOL_NAMES.LIST_GOODS_RECEIPTS]: {
    requiredActions: [{ resource: 'goods_receipts', action: 'list' }],
    description: '查询收货单列表',
  },
};

// ============ 权限检查函数 ============

import { ROLE_PERMISSIONS, type Resource, type Action } from '@/lib/permissions';

/**
 * 检查角色是否有权限使用某个工具
 */
export function canInvokeTool(role: Role, toolName: ToolName): boolean {
  const toolPerm = TOOL_PERMISSIONS[toolName];
  if (!toolPerm) {
    // 未知工具默认拒绝
    return false;
  }

  // 检查每个需要的权限
  for (const { resource, action } of toolPerm.requiredActions) {
    const rolePerm = ROLE_PERMISSIONS[role]?.[resource as Resource];
    if (!rolePerm) {
      return false;
    }
    // read/list/get 权限映射
    if (action === 'read' || action === 'list' || action === 'get') {
      if (!rolePerm.actions.includes(action as Action) && 
          !rolePerm.actions.includes('list' as Action) &&
          !rolePerm.actions.includes('get' as Action)) {
        return false;
      }
    } else {
      if (!rolePerm.actions.includes(action as Action)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * 获取工具的权限描述
 */
export function getToolPermissionDescription(toolName: ToolName): string {
  return TOOL_PERMISSIONS[toolName]?.description || '未知工具';
}

/**
 * 获取角色可用的工具列表
 */
export function getAvailableTools(role: Role): ToolName[] {
  return (Object.keys(TOOL_PERMISSIONS) as ToolName[]).filter(
    toolName => canInvokeTool(role, toolName)
  );
}
