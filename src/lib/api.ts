/**
 * API 客户端
 * 每次请求自动附带 X-Actor 和 X-Role 请求头
 */

import { getIdentityHeaders } from './identity-store';

const API_BASE = '/api';

interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>;
}

/**
 * 构建 API URL
 * 
 * 注意：不能使用 new URL(endpoint, base) 的方式，因为：
 * - 当 endpoint 以 '/' 开头时，URL 构造函数会将其视为绝对路径，替换掉 base 的路径部分
 * - 例如：new URL('/purchase-requests', 'http://localhost:5000/api') 
 *   结果是 'http://localhost:5000/purchase-requests'（丢失了 /api）
 * 
 * 正确做法：直接拼接字符串
 */
function buildUrl(endpoint: string, params?: Record<string, string | number | boolean | undefined>): string {
  // 确保 endpoint 不以 / 开头（如果有则去掉）
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
  const baseUrl = `${window.location.origin}${API_BASE}/${normalizedEndpoint}`;
  
  const url = new URL(baseUrl);
  
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.append(key, String(value));
      }
    });
  }
  return url.toString();
}

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { params, ...fetchOptions } = options;
  const url = buildUrl(endpoint, params);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...getIdentityHeaders(),
    ...(fetchOptions.headers as Record<string, string> || {}),
  };

  const response = await fetch(url, {
    ...fetchOptions,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// 基础 API 方法
export const api = {
  get: <T>(endpoint: string, params?: Record<string, string | number | undefined>) =>
    request<T>(endpoint, { method: 'GET', params }),

  post: <T>(endpoint: string, data?: unknown) =>
    request<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    }),

  put: <T>(endpoint: string, data?: unknown) =>
    request<T>(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    }),

  patch: <T>(endpoint: string, data?: unknown) =>
    request<T>(endpoint, {
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    }),

  delete: <T>(endpoint: string) =>
    request<T>(endpoint, { method: 'DELETE' }),
};

// 采购申请 API
export const purchaseRequestsApi = {
  list: (params?: { status?: string; page?: number; pageSize?: number }) =>
    api.get<{ data: any[]; total: number }>('/purchase-requests', params),

  get: (id: number) =>
    api.get<{ data: any }>(`/purchase-requests/${id}`),

  create: (data: { reason: string; lines: any[] }) =>
    api.post<{ data: any }>('/purchase-requests', data),

  submit: (id: number) =>
    api.post<{ data: any }>(`/purchase-requests/${id}/submit`),

  approve: (id: number, approved: boolean) =>
    api.post<{ data: any }>(`/purchase-requests/${id}/approve`, { approved }),
};

// 采购订单 API
export const purchaseOrdersApi = {
  list: (params?: { page?: number; pageSize?: number; status?: string }) =>
    api.get<{ data: any[]; total: number }>('/purchase-orders', params),

  get: (id: number) =>
    api.get<{ data: any }>(`/purchase-orders/${id}`),

  create: (data: any) =>
    api.post<{ data: any }>('/purchase-orders', data),

  send: (id: number) =>
    api.post<{ data: any }>(`/purchase-orders/${id}/send`),

  updateStatus: (id: number, status: string) =>
    api.patch<{ data: any }>(`/purchase-orders/${id}/status`, { status }),
};

// 供应商 API
export const suppliersApi = {
  list: (params?: { page?: number; pageSize?: number; search?: string }) =>
    api.get<{ data: any[]; total: number }>('/suppliers', params),

  get: (id: number) =>
    api.get<{ data: any }>(`/suppliers/${id}`),

  create: (data: any) =>
    api.post<{ data: any }>('/suppliers', data),

  delete: (id: number) =>
    api.delete(`/suppliers/${id}`),
};

// 物料 API
export const materialsApi = {
  list: (params?: { page?: number; pageSize?: number; search?: string }) =>
    api.get<{ data: any[]; total: number }>('/materials', params),

  get: (id: number) =>
    api.get<{ data: any }>(`/materials/${id}`),

  create: (data: any) =>
    api.post<{ data: any }>('/materials', data),

  delete: (id: number) =>
    api.delete(`/materials/${id}`),
};

// 框架协议 API
export const frameworkAgreementsApi = {
  list: (params?: { page?: number; pageSize?: number; status?: string }) =>
    api.get<{ data: any[]; total: number }>('/framework-agreements', params),

  get: (id: number) =>
    api.get<{ data: any }>(`/framework-agreements/${id}`),
};

// 寻源任务 API
export const sourcingTasksApi = {
  list: (params?: { page?: number; pageSize?: number; status?: string }) =>
    api.get<{ data: any[]; total: number }>('/sourcing-tasks', params),
};

// 报价单 API
export const quotesApi = {
  list: (params?: { page?: number; pageSize?: number; status?: string; sourcingTaskId?: number }) =>
    api.get<{ data: any[]; total: number }>('/quotes', params),

  create: (data: any) =>
    api.post<{ data: any }>('/quotes', data),

  award: (id: number) =>
    api.post<{ success: boolean; quote: any; purchaseOrder: any }>(`/quotes/${id}/award`),
};

// 收货单 API
export const goodsReceiptsApi = {
  list: (params?: { page?: number; pageSize?: number; grType?: string }) =>
    api.get<{ data: any[]; total: number }>('/goods-receipts', params),

  create: (data: any) =>
    api.post<{ data: any }>('/goods-receipts', data),

  approveOverdelivery: (id: number, approved: boolean) =>
    api.post<{ data: any }>(`/goods-receipts/${id}/approve-overdelivery`, { approved }),
};

// 审计日志 API
export const auditLogsApi = {
  list: (params?: { page?: number; pageSize?: number }) =>
    api.get<{ data: any[]; total: number }>('/audit-logs', params),
};

// Agent 绑定 API
export const agentsApi = {
  list: (params?: { page?: number; pageSize?: number; role?: string }) =>
    api.get<{ data: any[]; total: number }>('/agent-bindings', params),

  get: (id: number) =>
    api.get<{ data: any }>(`/agent-bindings/${id}`),

  create: (data: { agentId: string; role: string; webhookUrl?: string }) =>
    api.post<{ data: any }>('/agent-bindings', data),

  update: (id: number, data: { role?: string; webhookUrl?: string }) =>
    api.put<{ data: any }>(`/agent-bindings/${id}`, data),

  delete: (id: number) =>
    api.delete(`/agent-bindings/${id}`),
};



export type { RequestOptions };
