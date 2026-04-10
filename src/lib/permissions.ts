/**
 * 权限配置 - Agent-first 细粒度权限控制
 * 
 * 角色权限矩阵：
 * ┌─────────────┬──────────────────────────────────────────────────────────┐
 * │ 角色        │ 权限说明                                                  │
 * ├─────────────┼──────────────────────────────────────────────────────────┤
 * │ buyer       │ 创建供应商、输入报价单、查看所有数据                         │
 * │ requester   │ 创建采购申请、创建物料、输入收货数量、查看自己相关数据         │
 * │ manager     │ 审批采购申请、审批超收、查看所有数据                         │
 * └─────────────┴──────────────────────────────────────────────────────────┘
 * 
 * 权限类型：
 * - read: 只读操作
 * - write: 写入操作（创建、更新）
 * - approve: 审批操作
 */

import type { Role } from '@/storage/database/agent-binding';

// ============ 权限类型 ============

export type Permission = 'read' | 'write' | 'approve';

// 资源类型
export type Resource =
  // 物料
  | 'materials'
  // 供应商
  | 'suppliers'
  // 采购申请
  | 'purchase_requests'
  | 'purchase_request_lines'
  // 寻源任务
  | 'sourcing_tasks'
  // 报价单
  | 'quotes'
  // 框架协议
  | 'framework_agreements'
  // 采购订单
  | 'purchase_orders'
  | 'purchase_order_lines'
  // 收货单
  | 'goods_receipts';

// 操作类型
export type Action =
  | 'list'      // 列表查询
  | 'get'       // 详情查询
  | 'create'    // 创建
  | 'update'    // 更新
  | 'delete'    // 删除
  | 'submit'    // 提交
  | 'approve'   // 审批
  | 'reject'    // 拒绝
  | 'send'      // 发送
  | 'award'     // 授标
  | 'receive';   // 收货

// ============ 权限矩阵 ============

type PermissionMatrix = {
  [R in Role]: {
    [resource: string]: {
      actions: Action[];
      description: string;
    };
  };
};

export const ROLE_PERMISSIONS: PermissionMatrix = {
  // ========== Buyer (采购员) ==========
  // 可以：创建供应商、输入报价单、查看所有数据
  buyer: {
    // 物料 - 只读
    materials: {
      actions: ['list', 'get'],
      description: '查看物料列表和详情',
    },
    // 供应商 - 可创建、可查看
    suppliers: {
      actions: ['list', 'get', 'create'],
      description: '创建供应商、查看供应商列表',
    },
    // 采购申请 - 只读（不能创建、不能审批）
    purchase_requests: {
      actions: ['list', 'get'],
      description: '查看采购申请列表和详情',
    },
    purchase_request_lines: {
      actions: ['list', 'get'],
      description: '查看采购申请行详情',
    },
    // 寻源任务 - 可创建、可查看、可更新
    sourcing_tasks: {
      actions: ['list', 'get', 'create', 'update'],
      description: '创建寻源任务、更新寻源结果',
    },
    // 报价单 - 可创建、可授标、可查看
    quotes: {
      actions: ['list', 'get', 'create', 'award'],
      description: '创建报价单、授标',
    },
    // 框架协议 - 只读
    framework_agreements: {
      actions: ['list', 'get'],
      description: '查看框架协议列表',
    },
    // 采购订单 - 可创建、可发送、可查看
    purchase_orders: {
      actions: ['list', 'get', 'create', 'send', 'update'],
      description: '创建采购订单、发送订单',
    },
    purchase_order_lines: {
      actions: ['list', 'get', 'create'],
      description: '添加订单行',
    },
    // 收货单 - 可创建、可查看
    goods_receipts: {
      actions: ['list', 'get', 'create'],
      description: '创建收货单',
    },
  },

  // ========== Requester (需求人) ==========
  // 可以：创建采购申请、创建物料、输入收货数量、查看自己相关数据
  requester: {
    // 物料 - 可创建、可查看
    materials: {
      actions: ['list', 'get', 'create'],
      description: '创建物料、查看物料列表',
    },
    // 供应商 - 只读
    suppliers: {
      actions: ['list', 'get'],
      description: '查看供应商列表',
    },
    // 采购申请 - 可创建、可提交、可查看自己创建的
    purchase_requests: {
      actions: ['list', 'get', 'create', 'submit'],
      description: '创建采购申请、提交、查看自己创建的申请',
    },
    purchase_request_lines: {
      actions: ['list', 'get'],
      description: '查看采购申请行详情',
    },
    // 寻源任务 - 只读（只能看自己 PR 关联的）
    sourcing_tasks: {
      actions: ['list', 'get'],
      description: '查看自己采购申请关联的寻源任务',
    },
    // 报价单 - 只读
    quotes: {
      actions: ['list', 'get'],
      description: '查看报价单列表',
    },
    // 框架协议 - 只读
    framework_agreements: {
      actions: ['list', 'get'],
      description: '查看框架协议',
    },
    // 采购订单 - 只读（只能看自己 PR 关联的）
    purchase_orders: {
      actions: ['list', 'get'],
      description: '查看自己采购申请关联的订单',
    },
    purchase_order_lines: {
      actions: ['list', 'get'],
      description: '查看订单行',
    },
    // 收货单 - 可创建、可查看
    goods_receipts: {
      actions: ['list', 'get', 'create'],
      description: '创建收货单、查看收货记录',
    },
  },

  // ========== Manager (经理) ==========
  // 可以：审批采购申请、审批超收、查看所有数据
  manager: {
    // 物料 - 只读
    materials: {
      actions: ['list', 'get'],
      description: '查看物料列表和详情',
    },
    // 供应商 - 只读
    suppliers: {
      actions: ['list', 'get'],
      description: '查看供应商列表',
    },
    // 采购申请 - 可审批、可查看所有
    purchase_requests: {
      actions: ['list', 'get', 'approve', 'reject'],
      description: '审批采购申请、查看所有申请',
    },
    purchase_request_lines: {
      actions: ['list', 'get', 'approve', 'reject'],
      description: '审批采购申请行',
    },
    // 寻源任务 - 只读
    sourcing_tasks: {
      actions: ['list', 'get'],
      description: '查看寻源任务',
    },
    // 报价单 - 只读
    quotes: {
      actions: ['list', 'get'],
      description: '查看报价单',
    },
    // 框架协议 - 可审批、可查看
    framework_agreements: {
      actions: ['list', 'get', 'approve', 'reject'],
      description: '审批框架协议',
    },
    // 采购订单 - 只读
    purchase_orders: {
      actions: ['list', 'get'],
      description: '查看采购订单',
    },
    purchase_order_lines: {
      actions: ['list', 'get'],
      description: '查看订单行',
    },
    // 收货单 - 可审批超收、可查看所有
    goods_receipts: {
      actions: ['list', 'get', 'approve'],
      description: '审批超收、查看收货记录',
    },
  },
};

// ============ 辅助函数 ============

/**
 * 检查角色是否有权限执行特定操作
 */
export function hasPermission(
  role: Role,
  resource: Resource,
  action: Action
): boolean {
  const resourcePerm = ROLE_PERMISSIONS[role]?.[resource];
  if (!resourcePerm) {
    return false;
  }
  return resourcePerm.actions.includes(action);
}

/**
 * 获取角色可执行的操作列表
 */
export function getAllowedActions(role: Role, resource: Resource): Action[] {
  return ROLE_PERMISSIONS[role]?.[resource]?.actions || [];
}

/**
 * 获取角色的权限描述
 */
export function getRoleDescription(role: Role): string {
  const descriptions: Record<Role, string> = {
    buyer: '采购员 - 可创建供应商、输入报价单、查看所有数据',
    requester: '需求人 - 可创建采购申请、创建物料、输入收货数量、查看自己相关数据',
    manager: '经理 - 可审批采购申请、审批超收、查看所有数据',
  };
  return descriptions[role];
}

/**
 * 获取所有资源的权限矩阵
 */
export function getFullPermissionMatrix(): PermissionMatrix {
  return ROLE_PERMISSIONS;
}

// ============ REST API 路径映射 ============

/**
 * REST API 路径到资源的映射
 */
export const API_PATH_TO_RESOURCE: Record<string, { resource: Resource; action: Action }> = {
  // 物料
  'GET /api/materials': { resource: 'materials', action: 'list' },
  'GET /api/materials/:id': { resource: 'materials', action: 'get' },
  'POST /api/materials': { resource: 'materials', action: 'create' },
  'PUT /api/materials/:id': { resource: 'materials', action: 'update' },
  'DELETE /api/materials/:id': { resource: 'materials', action: 'delete' },

  // 供应商
  'GET /api/suppliers': { resource: 'suppliers', action: 'list' },
  'GET /api/suppliers/:id': { resource: 'suppliers', action: 'get' },
  'POST /api/suppliers': { resource: 'suppliers', action: 'create' },
  'PUT /api/suppliers/:id': { resource: 'suppliers', action: 'update' },
  'DELETE /api/suppliers/:id': { resource: 'suppliers', action: 'delete' },

  // 采购申请
  'GET /api/purchase-requests': { resource: 'purchase_requests', action: 'list' },
  'GET /api/purchase-requests/:id': { resource: 'purchase_requests', action: 'get' },
  'POST /api/purchase-requests': { resource: 'purchase_requests', action: 'create' },
  'PUT /api/purchase-requests/:id': { resource: 'purchase_requests', action: 'update' },
  'DELETE /api/purchase-requests/:id': { resource: 'purchase_requests', action: 'delete' },
  'POST /api/purchase-requests/:id/submit': { resource: 'purchase_requests', action: 'submit' },

  // 采购申请行审批
  'POST /api/purchase-request-lines/:id/approve': { resource: 'purchase_request_lines', action: 'approve' },
  'PUT /api/purchase-request-lines/:id/confirm-fa': { resource: 'purchase_request_lines', action: 'update' },

  // 寻源任务
  'GET /api/sourcing-tasks': { resource: 'sourcing_tasks', action: 'list' },
  'GET /api/sourcing-tasks/:id': { resource: 'sourcing_tasks', action: 'get' },
  'POST /api/sourcing-tasks': { resource: 'sourcing_tasks', action: 'create' },
  'PUT /api/sourcing-tasks/:id': { resource: 'sourcing_tasks', action: 'update' },

  // 报价单
  'GET /api/quotes': { resource: 'quotes', action: 'list' },
  'GET /api/quotes/:id': { resource: 'quotes', action: 'get' },
  'POST /api/quotes': { resource: 'quotes', action: 'create' },
  'PUT /api/quotes/:id/award': { resource: 'quotes', action: 'award' },

  // 框架协议
  'GET /api/contracts': { resource: 'framework_agreements', action: 'list' },
  'GET /api/contracts/:id': { resource: 'framework_agreements', action: 'get' },
  'POST /api/contracts': { resource: 'framework_agreements', action: 'create' },
  'PUT /api/contracts/:id': { resource: 'framework_agreements', action: 'update' },
  'POST /api/contracts/:id/submit': { resource: 'framework_agreements', action: 'submit' },

  // 采购订单
  'GET /api/purchase-orders': { resource: 'purchase_orders', action: 'list' },
  'GET /api/purchase-orders/:id': { resource: 'purchase_orders', action: 'get' },
  'POST /api/purchase-orders': { resource: 'purchase_orders', action: 'create' },
  'PUT /api/purchase-orders/:id': { resource: 'purchase_orders', action: 'update' },
  'POST /api/purchase-orders/:id/send': { resource: 'purchase_orders', action: 'send' },
  'POST /api/purchase-orders/:id/lines': { resource: 'purchase_order_lines', action: 'create' },

  // 收货单
  'GET /api/goods-receipts': { resource: 'goods_receipts', action: 'list' },
  'GET /api/goods-receipts/:id': { resource: 'goods_receipts', action: 'get' },
  'POST /api/goods-receipts': { resource: 'goods_receipts', action: 'create' },
  'POST /api/goods-receipts/:id/approve-overdelivery': { resource: 'goods_receipts', action: 'approve' },
};

/**
 * 检查 REST API 请求是否有权限
 */
export function checkApiPermission(
  role: Role,
  method: string,
  path: string
): { allowed: boolean; resource?: Resource; action?: Action; error?: string } {
  // 构建请求标识
  const pathParts = path.split('/');
  let resourcePath = `${method} /api`;
  
  for (const part of pathParts) {
    if (part === 'api') continue;
    if (part.match(/^[a-f0-9-]+$/i)) {
      resourcePath += '/:id';
    } else {
      resourcePath += `/${part}`;
    }
  }

  // 精确匹配
  const exactMatch = API_PATH_TO_RESOURCE[resourcePath];
  if (exactMatch) {
    const allowed = hasPermission(role, exactMatch.resource, exactMatch.action);
    return {
      allowed,
      resource: exactMatch.resource,
      action: exactMatch.action,
      error: allowed ? undefined : `权限不足：${role} 角色无法执行 ${exactMatch.action} 操作`,
    };
  }

  // 通配符匹配（泛匹配）
  const methodPath = `${method} ${resourcePath.split('/:id')[0]}`;
  for (const [key, value] of Object.entries(API_PATH_TO_RESOURCE)) {
    const pattern = key.split('/:id')[0];
    if (methodPath.startsWith(pattern)) {
      const allowed = hasPermission(role, value.resource, value.action);
      return {
        allowed,
        resource: value.resource,
        action: value.action,
        error: allowed ? undefined : `权限不足：${role} 角色无法执行 ${value.action} 操作`,
      };
    }
  }

  // 未匹配的路径默认允许（可能是特殊路径）
  return { allowed: true };
}
