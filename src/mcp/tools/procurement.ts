/**
 * MCP Server 工具实现
 * 将采购系统 API 能力暴露为 MCP 工具
 */

import { loadEnv } from '@/storage/database/supabase-client';
import { getMcpIdentity } from '../context';

// 加载环境变量
loadEnv();

/** 与当前 MCP 会话身份绑定，与 REST API X-Actor / X-Role 一致 */
function actorHeaders(overrides?: { actor?: string }): Record<string, string> {
  const id = getMcpIdentity();
  const actor = overrides?.actor ?? id?.agentId ?? 'mcp-system';
  const role = id?.role ?? 'buyer';
  return { 'X-Actor': actor, 'X-Role': role };
}

const SUPABASE_URL = process.env.COZE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.COZE_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_KEY = process.env.COZE_SUPABASE_SERVICE_ROLE_KEY || '';

/**
 * 获取带认证头的 fetch 选项
 */
function getFetchOptions(method: string, body?: any) {
  return {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  };
}

/**
 * 调用内部 API（复用现有逻辑）
 */
async function callAPI(path: string, options: any): Promise<any> {
  const baseURL = process.env.MCP_API_BASE || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
  const url = `${baseURL}${path}`;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      ...actorHeaders(),
      ...options.headers,
    },
  });
  
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || `API Error: ${response.status}`);
  }
  
  return data;
}

/**
 * 直接调用 Supabase
 */
async function callSupabase(table: string, options: any): Promise<any> {
  const url = `${SUPABASE_URL}/rest/v1/${table}`;
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY}`,
    'Prefer': 'return=representation',
  };
  
  if (options.method === 'POST') {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(options.body),
    });
    return response.json();
  }
  
  if (options.method === 'GET') {
    const query = new URLSearchParams(options.params || {}).toString();
    const response = await fetch(`${url}?${query}`, {
      method: 'GET',
      headers,
    });
    return response.json();
  }
  
  return null;
}

/**
 * 生成编号
 */
async function generateNumber(prefix: string): Promise<string> {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  const table = {
    'PR': 'purchase_requests',
    'PO': 'purchase_orders',
    'SC': 'sourcing_tasks',
    'FA': 'framework_agreements',
    'GR': 'goods_receipts',
  }[prefix] || 'purchase_requests';
  
  const prefixStr = `${prefix}-${dateStr}`;
  
  const { data } = await callSupabase(table, {
    method: 'GET',
    params: { 
      select: 'id',
      [`${table.includes('task') ? 'task_number' : table.includes('pr') ? 'pr_number' : 'po_number'}`]: `like.${prefixStr}%`,
      order: 'created_at',
      limit: 1,
    },
  }) as any;
  
  let seq = 1;
  if (data && data.length > 0) {
    const numStr = data[0][`${prefix.toLowerCase()}_number`].split('-')[2];
    seq = parseInt(numStr) + 1;
  }
  
  return `${prefixStr}-${String(seq).padStart(2, '0')}`;
}

// ============ 工具实现 ============

/**
 * 物料匹配检查
 */
export async function matchMaterial(text: string) {
  const baseURL = process.env.MCP_API_BASE || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
  const response = await fetch(`${baseURL}/api/materials/match?text=${encodeURIComponent(text)}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...actorHeaders(),
    },
  });
  return response.json();
}

/**
 * 物料模糊搜索
 */
export async function searchMaterials(query: string) {
  const baseURL = process.env.MCP_API_BASE || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
  const response = await fetch(`${baseURL}/api/materials?search=${encodeURIComponent(query)}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...actorHeaders(),
    },
  });
  return response.json();
}

/**
 * 创建采购申请
 */
export async function createPurchaseRequest(params: {
  reason: string;
  lines: Array<{
    requirementText: string;
    quantity: number;
    estUnitPrice?: number;
  }>;
  actor?: string;
}) {
  const baseURL = process.env.MCP_API_BASE || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
  const response = await fetch(`${baseURL}/api/purchase-requests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...actorHeaders({ actor: params.actor }),
    },
    body: JSON.stringify({
      reason: params.reason,
      lines: params.lines,
    }),
  });
  return response.json();
}

/**
 * 查询采购申请列表
 */
export async function listPurchaseRequests(params?: {
  status?: string;
  page?: number;
  pageSize?: number;
}) {
  const baseURL = process.env.MCP_API_BASE || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
  
  const response = await fetch(`${baseURL}/api/purchase-requests?${searchParams}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...actorHeaders(),
    },
  });
  return response.json();
}

/**
 * 提交采购申请
 */
export async function submitPurchaseRequest(prId: number) {
  const baseURL = process.env.MCP_API_BASE || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
  const response = await fetch(`${baseURL}/api/purchase-requests/${prId}/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...actorHeaders(),
    },
  });
  return response.json();
}

/**
 * 审批采购申请行
 */
export async function approvePRLine(lineId: number, approved: boolean, reason?: string) {
  const baseURL = process.env.MCP_API_BASE || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
  const response = await fetch(`${baseURL}/api/purchase-request-lines/${lineId}/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...actorHeaders(),
    },
    body: JSON.stringify({ approved, reason }),
  });
  return response.json();
}

/**
 * 创建寻源任务
 */
export async function createSourcingTask(params: {
  prId: number;
  prLineId?: number;
  requirementText: string;
  dueDate?: string;
  actor?: string;
}) {
  const baseURL = process.env.MCP_API_BASE || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
  const response = await fetch(`${baseURL}/api/sourcing-tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...actorHeaders({ actor: params.actor }),
    },
    body: JSON.stringify({
      prId: params.prId,
      prLineId: params.prLineId,
      requirementText: params.requirementText,
      dueDate: params.dueDate,
    }),
  });
  return response.json();
}

/**
 * 查询寻源任务
 */
export async function listSourcingTasks(params?: {
  status?: string;
  prId?: number;
}) {
  const baseURL = process.env.MCP_API_BASE || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.prId) searchParams.set('prId', String(params.prId));
  
  const response = await fetch(`${baseURL}/api/sourcing-tasks?${searchParams}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...actorHeaders(),
    },
  });
  return response.json();
}

/**
 * 创建报价单
 */
export async function createQuote(params: {
  sourcingTaskId?: number;
  supplierId: number;
  unitPrice: number;
  quantity: number;
  materialSnapshot?: string;
  actor?: string;
}) {
  const baseURL = process.env.MCP_API_BASE || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
  const response = await fetch(`${baseURL}/api/quotes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...actorHeaders({ actor: params.actor }),
    },
    body: JSON.stringify({
      sourcingTaskId: params.sourcingTaskId,
      supplierId: params.supplierId,
      unitPrice: String(params.unitPrice),
      quantity: params.quantity,
      materialSnapshot: params.materialSnapshot,
    }),
  });
  return response.json();
}

/**
 * 授标报价单
 */
export async function awardQuote(quoteId: number) {
  const baseURL = process.env.MCP_API_BASE || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
  const response = await fetch(`${baseURL}/api/quotes/${quoteId}/award`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...actorHeaders(),
    },
    body: JSON.stringify({ awarded: 'winner' }),
  });
  return response.json();
}

/**
 * 创建采购订单
 */
export async function createPurchaseOrder(params: {
  supplierId: number;
  supplierSnapshot: string;
  lines: Array<{
    prLineId?: number;
    materialSnapshot: string;
    quantity: number;
    unitPrice: number;
  }>;
  actor?: string;
}) {
  const baseURL = process.env.MCP_API_BASE || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
  const response = await fetch(`${baseURL}/api/purchase-orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...actorHeaders({ actor: params.actor }),
    },
    body: JSON.stringify({
      supplierId: params.supplierId,
      supplierSnapshot: params.supplierSnapshot,
      lines: params.lines,
    }),
  });
  return response.json();
}

/**
 * 发送采购订单
 */
export async function sendPurchaseOrder(poId: number) {
  const baseURL = process.env.MCP_API_BASE || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
  const response = await fetch(`${baseURL}/api/purchase-orders/${poId}/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...actorHeaders(),
    },
  });
  return response.json();
}

/**
 * 创建收货单
 */
export async function createGoodsReceipt(params: {
  poLineId: number;
  quantity: number;
  receiptDate?: string;
  notes?: string;
  actor?: string;
}) {
  const baseURL = process.env.MCP_API_BASE || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
  const response = await fetch(`${baseURL}/api/goods-receipts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...actorHeaders({ actor: params.actor }),
    },
    body: JSON.stringify({
      poLineId: params.poLineId,
      quantity: params.quantity,
      receiptDate: params.receiptDate,
      notes: params.notes,
    }),
  });
  return response.json();
}

/**
 * 创建物料
 */
export async function createMaterial(params: {
  code: string;
  name: string;
  unit: string;
  isActive?: boolean;
  actor?: string;
}) {
  const baseURL = process.env.MCP_API_BASE || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
  const response = await fetch(`${baseURL}/api/materials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...actorHeaders({ actor: params.actor }),
    },
    body: JSON.stringify({
      code: params.code,
      name: params.name,
      unit: params.unit,
      isActive: params.isActive ?? true,
    }),
  });
  return response.json();
}

/**
 * 查询物料列表
 */
export async function listMaterials(params?: {
  search?: string;
  isActive?: boolean;
}) {
  const baseURL = process.env.MCP_API_BASE || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
  const searchParams = new URLSearchParams();
  if (params?.search) searchParams.set('search', params.search);
  if (params?.isActive !== undefined) searchParams.set('isActive', String(params.isActive));
  
  const response = await fetch(`${baseURL}/api/materials?${searchParams}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...actorHeaders(),
    },
  });
  return response.json();
}

/**
 * 创建供应商
 */
export async function createSupplier(params: {
  code: string;
  name: string;
  contact?: string;
  email?: string;
  phone?: string;
  address?: string;
  note?: string;
  isActive?: boolean;
  actor?: string;
}) {
  const baseURL = process.env.MCP_API_BASE || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
  const response = await fetch(`${baseURL}/api/suppliers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...actorHeaders({ actor: params.actor }),
    },
    body: JSON.stringify({
      code: params.code,
      name: params.name,
      contact: params.contact,
      email: params.email,
      phone: params.phone,
      address: params.address,
      note: params.note,
      isActive: params.isActive ?? true,
    }),
  });
  return response.json();
}

/**
 * 查询供应商列表
 */
export async function listSuppliers(params?: {
  search?: string;
  isActive?: boolean;
}) {
  const baseURL = process.env.MCP_API_BASE || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
  const searchParams = new URLSearchParams();
  if (params?.search) searchParams.set('search', params.search);
  if (params?.isActive !== undefined) searchParams.set('isActive', String(params.isActive));
  
  const response = await fetch(`${baseURL}/api/suppliers?${searchParams}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...actorHeaders(),
    },
  });
  return response.json();
}

/**
 * 查询采购订单
 */
export async function listPurchaseOrders(params?: {
  status?: string;
  supplierId?: number;
}) {
  const baseURL = process.env.MCP_API_BASE || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.supplierId) searchParams.set('supplierId', String(params.supplierId));
  
  const response = await fetch(`${baseURL}/api/purchase-orders?${searchParams}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...actorHeaders(),
    },
  });
  return response.json();
}

/**
 * 查询收货单
 */
export async function listGoodsReceipts(params?: {
  poId?: number;
}) {
  const baseURL = process.env.MCP_API_BASE || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
  const searchParams = new URLSearchParams();
  if (params?.poId) searchParams.set('poId', String(params.poId));
  
  const response = await fetch(`${baseURL}/api/goods-receipts?${searchParams}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...actorHeaders(),
    },
  });
  return response.json();
}

/**
 * 框架协议匹配查询
 */
export async function matchFrameworkAgreement(params: {
  materialId?: number;
  requirementText?: string;
  topN?: number;
}) {
  const baseURL = process.env.MCP_API_BASE || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
  const searchParams = new URLSearchParams();
  if (params.materialId) searchParams.set('materialId', String(params.materialId));
  if (params.requirementText) searchParams.set('requirementText', params.requirementText);
  if (params.topN) searchParams.set('topN', String(params.topN));
  
  const response = await fetch(`${baseURL}/api/framework-agreements/match?${searchParams}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...actorHeaders(),
    },
  });
  return response.json();
}
