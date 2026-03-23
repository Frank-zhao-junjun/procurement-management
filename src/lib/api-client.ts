/**
 * API 请求封装，自动添加身份头
 * 根据 localStorage 中的身份选择，自动添加 X-Actor 或 X-Role 请求头
 */

import { getStoredIdentity } from '@/components/layout/identity-selector';

const API_BASE = '/api';

interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | undefined>;
}

function buildUrl(endpoint: string, params?: Record<string, string | number | undefined>): string {
  const url = new URL(endpoint, window.location.origin + API_BASE);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.append(key, String(value));
      }
    });
  }
  return url.toString();
}

function getIdentityHeaders(): Record<string, string> {
  const identity = getStoredIdentity();
  const headers: Record<string, string> = {};

  if (identity.mode === 'agent' && identity.agentId) {
    headers['X-Actor'] = identity.agentId;
  } else if (identity.mode === 'role' && identity.role) {
    headers['X-Role'] = identity.role;
  }

  return headers;
}

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { params, ...fetchOptions } = options;
  const url = buildUrl(endpoint, params);
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...getIdentityHeaders(),
    ...fetchOptions.headers as Record<string, string>,
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

// API 方法封装
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

  delete: <T>(endpoint: string) =>
    request<T>(endpoint, { method: 'DELETE' }),
};

// 直接导出请求头获取函数，供自定义 fetch 使用
export { getIdentityHeaders };
