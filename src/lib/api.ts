// 采购管理系统 API 客户端

const API_BASE = '/api';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: any;
  headers?: Record<string, string>;
}

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {} } = options;
  
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

// 物料 API
export const materialsApi = {
  list: (params?: { search?: string; isActive?: boolean; page?: number; pageSize?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.search) searchParams.set('search', params.search);
    if (params?.isActive !== undefined) searchParams.set('isActive', String(params.isActive));
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
    return request<any>(`/materials?${searchParams.toString()}`);
  },
  get: (id: number) => request<any>(`/materials/${id}`),
  create: (data: any) => request<any>('/materials', { method: 'POST', body: data }),
  update: (id: number, data: any) => request<any>(`/materials/${id}`, { method: 'PUT', body: data }),
  delete: (id: number) => request<any>(`/materials/${id}`, { method: 'DELETE' }),
};

// 供应商 API
export const suppliersApi = {
  list: (params?: { search?: string; isActive?: boolean; page?: number; pageSize?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.search) searchParams.set('search', params.search);
    if (params?.isActive !== undefined) searchParams.set('isActive', String(params.isActive));
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
    return request<any>(`/suppliers?${searchParams.toString()}`);
  },
  get: (id: number) => request<any>(`/suppliers/${id}`),
  create: (data: any) => request<any>('/suppliers', { method: 'POST', body: data }),
  update: (id: number, data: any) => request<any>(`/suppliers/${id}`, { method: 'PUT', body: data }),
  delete: (id: number) => request<any>(`/suppliers/${id}`, { method: 'DELETE' }),
};

// 采购申请 API
export const purchaseRequestsApi = {
  list: (params?: { status?: string; applicant?: string; page?: number; pageSize?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.applicant) searchParams.set('applicant', params.applicant);
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
    return request<any>(`/purchase-requests?${searchParams.toString()}`);
  },
  get: (id: number) => request<any>(`/purchase-requests/${id}`),
  create: (data: any, actor?: string) => request<any>('/purchase-requests', {
    method: 'POST',
    body: data,
    headers: actor ? { 'X-Actor': actor } : {},
  }),
  update: (id: number, data: any, actor?: string) => request<any>(`/purchase-requests/${id}`, {
    method: 'PUT',
    body: data,
    headers: actor ? { 'X-Actor': actor } : {},
  }),
  delete: (id: number, actor?: string) => request<any>(`/purchase-requests/${id}`, {
    method: 'DELETE',
    headers: actor ? { 'X-Actor': actor } : {},
  }),
  submit: (id: number, actor?: string) => request<any>(`/purchase-requests/${id}/submit`, {
    method: 'POST',
    headers: actor ? { 'X-Actor': actor } : {},
  }),
  approve: (id: number, approved: boolean, note?: string, actor?: string, role?: string) => request<any>(`/purchase-requests/${id}/approve`, {
    method: 'POST',
    body: { approved, note },
    headers: {
      ...(actor ? { 'X-Actor': actor } : {}),
      ...(role ? { 'X-Role': role } : {}),
    },
  }),
};

// 采购订单 API
export const purchaseOrdersApi = {
  list: (params?: { status?: string; supplierId?: number; page?: number; pageSize?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.supplierId) searchParams.set('supplierId', String(params.supplierId));
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
    return request<any>(`/purchase-orders?${searchParams.toString()}`);
  },
  get: (id: number) => request<any>(`/purchase-orders/${id}`),
  create: (data: any, actor?: string) => request<any>('/purchase-orders', {
    method: 'POST',
    body: data,
    headers: actor ? { 'X-Actor': actor, 'X-Role': 'buyer' } : { 'X-Role': 'buyer' },
  }),
  updateStatus: (id: number, status: string, actor?: string) => request<any>(`/purchase-orders/${id}/status`, {
    method: 'PUT',
    body: { status },
    headers: actor ? { 'X-Actor': actor, 'X-Role': 'buyer' } : { 'X-Role': 'buyer' },
  }),
};

// 收货单 API
export const goodsReceiptsApi = {
  list: (params?: { grType?: string; poId?: number; page?: number; pageSize?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.grType) searchParams.set('grType', params.grType);
    if (params?.poId) searchParams.set('poId', String(params.poId));
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
    return request<any>(`/goods-receipts?${searchParams.toString()}`);
  },
  create: (data: any, actor?: string) => request<any>('/goods-receipts', {
    method: 'POST',
    body: data,
    headers: actor ? { 'X-Actor': actor, 'X-Role': 'requester' } : { 'X-Role': 'requester' },
  }),
};

// 框架协议 API
export const frameworkAgreementsApi = {
  list: (params?: { status?: string; supplierId?: number; materialId?: number; page?: number; pageSize?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.supplierId) searchParams.set('supplierId', String(params.supplierId));
    if (params?.materialId) searchParams.set('materialId', String(params.materialId));
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
    return request<any>(`/framework-agreements?${searchParams.toString()}`);
  },
  create: (data: any, actor?: string) => request<any>('/framework-agreements', {
    method: 'POST',
    body: data,
    headers: actor ? { 'X-Actor': actor, 'X-Role': 'buyer' } : { 'X-Role': 'buyer' },
  }),
};

// 寻源任务 API
export const sourcingTasksApi = {
  list: (params?: { status?: string; prId?: number; page?: number; pageSize?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.prId) searchParams.set('prId', String(params.prId));
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
    return request<any>(`/sourcing-tasks?${searchParams.toString()}`);
  },
  create: (data: any, actor?: string) => request<any>('/sourcing-tasks', {
    method: 'POST',
    body: data,
    headers: actor ? { 'X-Actor': actor, 'X-Role': 'buyer' } : { 'X-Role': 'buyer' },
  }),
};

// 报价单 API
export const quotesApi = {
  list: (params?: { sourcingTaskId?: number; supplierId?: number; status?: string; page?: number; pageSize?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.sourcingTaskId) searchParams.set('sourcingTaskId', String(params.sourcingTaskId));
    if (params?.supplierId) searchParams.set('supplierId', String(params.supplierId));
    if (params?.status) searchParams.set('status', params.status);
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
    return request<any>(`/quotes?${searchParams.toString()}`);
  },
  create: (data: any, actor?: string) => request<any>('/quotes', {
    method: 'POST',
    body: data,
    headers: actor ? { 'X-Actor': actor, 'X-Role': 'buyer' } : { 'X-Role': 'buyer' },
  }),
};

// 审计日志 API
export const auditLogsApi = {
  list: (params?: { entityType?: string; entityId?: number; actor?: string; action?: string; page?: number; pageSize?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.entityType) searchParams.set('entityType', params.entityType);
    if (params?.entityId) searchParams.set('entityId', String(params.entityId));
    if (params?.actor) searchParams.set('actor', params.actor);
    if (params?.action) searchParams.set('action', params.action);
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
    return request<any>(`/audit-logs?${searchParams.toString()}`);
  },
};
