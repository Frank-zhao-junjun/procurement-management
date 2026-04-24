import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { loadConfig, type CliConfig } from './config.js';

let clientInstance: AxiosInstance | null = null;
let currentConfig: CliConfig | null = null;

export async function getClient(): Promise<AxiosInstance> {
  if (clientInstance && currentConfig) {
    return clientInstance;
  }

  const config = await loadConfig();
  currentConfig = config;

  clientInstance = axios.create({
    baseURL: config.baseUrl,
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  clientInstance.interceptors.request.use((req) => {
    if (config.apiKey) {
      req.headers['X-API-Key'] = config.apiKey;
    } else if (config.agentId) {
      req.headers['X-Actor'] = config.agentId;
    }
    return req;
  });

  clientInstance.interceptors.response.use(
    (res) => res,
    (err) => {
      if (err.response) {
        const data = err.response.data;
        const message = data?.error || data?.message || `HTTP ${err.response.status}`;
        throw new Error(message);
      }
      if (err.request) {
        throw new Error(`网络请求失败: ${err.message}`);
      }
      throw err;
    }
  );

  return clientInstance;
}

export async function apiGet<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const client = await getClient();
  const res = await client.get(url, config);
  return res.data;
}

export async function apiPost<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
  const client = await getClient();
  const res = await client.post(url, data, config);
  return res.data;
}

export async function apiPut<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
  const client = await getClient();
  const res = await client.put(url, data, config);
  return res.data;
}

export async function apiDelete<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const client = await getClient();
  const res = await client.delete(url, config);
  return res.data;
}

export async function getCurrentConfig(): Promise<CliConfig> {
  if (!currentConfig) {
    currentConfig = await loadConfig();
  }
  return currentConfig;
}

export function resetClient(): void {
  clientInstance = null;
  currentConfig = null;
}
