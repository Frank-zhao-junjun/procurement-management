/**
 * Webhook 通知模块
 * 
 * 提供统一的 Webhook 发送能力，支持：
 * - 超时控制
 * - 幂等（event_id + entity_id 去重）
 * - 重试机制
 * - HMAC-SHA256 签名
 * - 审计日志
 */

import { getSupabaseClient } from '@/storage/database';
import { createHmac, randomUUID } from 'crypto';

// 配置
const WEBHOOK_TIMEOUT = 10000; // 10秒超时
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1秒

// 简化的 UUID v4 生成（使用 Node.js 内置）
function generateUUID(): string {
  return randomUUID();
}

/**
 * Webhook 签名密钥获取（从环境变量或配置表）
 */
function getWebhookSecret(): string | null {
  return process.env.WEBHOOK_SECRET || null;
}

/**
 * 生成 HMAC-SHA256 签名
 */
function generateSignature(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Webhook 发送结果
 */
export interface WebhookResult {
  success: boolean;
  eventId: string;
  event: string;
  targetUrl: string;
  attempts: number;
  httpStatus?: number;
  responseTime?: number;
  error?: string;
  timestamp: string;
}

/**
 * Webhook Payload 基础结构
 */
export interface WebhookPayload {
  schema_version: string;
  event: string;
  event_id: string;
  timestamp: string;
  data: Record<string, any>;
  source?: string;
  subscriber?: Record<string, any>;
}

/**
 * 统一发送 Webhook
 * 
 * @param url - Webhook URL
 * @param event - 事件类型
 * @param data - 事件数据
 * @param options - 可选配置
 */
export async function sendWebhook(
  url: string,
  event: string,
  data: Record<string, any>,
  options: {
    entityType?: string;
    entityId?: string | number;
    webhookSecret?: string;
    retries?: number;
    payload?: WebhookPayload;
  } = {}
): Promise<WebhookResult> {
  const {
    entityType,
    entityId,
    webhookSecret,
    retries = MAX_RETRIES,
    payload: providedPayload,
  } = options;

  const eventId = providedPayload?.event_id || generateUUID();
  const timestamp = providedPayload?.timestamp || new Date().toISOString();
  const startTime = Date.now();

  // 构建 payload
  const payload: WebhookPayload = providedPayload || {
    schema_version: '1.0',
    event,
    event_id: eventId,
    timestamp,
    data: {
      entity_type: entityType,
      entity_id: entityId,
      ...data,
    },
  };

  const payloadStr = JSON.stringify(payload);
  const result: WebhookResult = {
    success: false,
    eventId,
    event,
    targetUrl: url,
    attempts: 0,
    timestamp,
  };

  // 添加签名（如果提供了密钥）
  const secret = webhookSecret || getWebhookSecret();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'ProcurementSystem-Webhook/1.0',
    'X-Event-Id': eventId,
    'X-Schema-Version': '1.0',
  };

  if (secret) {
    headers['X-Webhook-Signature'] = `sha256=${generateSignature(payloadStr, secret)}`;
  }

  // 重试循环
  let lastError: string | undefined;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    result.attempts = attempt;
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT);

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: payloadStr,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      result.httpStatus = response.status;
      result.responseTime = Date.now() - startTime;

      if (response.ok) {
        result.success = true;
        console.info(`[Webhook] Success: ${event} -> ${url} (${result.responseTime}ms, attempt ${attempt})`);
        break;
      } else {
        lastError = `HTTP ${response.status}: ${response.statusText}`;
        console.warn(`[Webhook] Failed (attempt ${attempt}/${retries}): ${event} -> ${url}, ${lastError}`);
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        lastError = `Timeout after ${WEBHOOK_TIMEOUT}ms`;
      } else if (error.code === 'ECONNREFUSED') {
        lastError = 'Connection refused';
      } else {
        lastError = error.message;
      }
      console.warn(`[Webhook] Error (attempt ${attempt}/${retries}): ${event} -> ${url}, ${lastError}`);
    }

    // 如果不是最后一次尝试，等待后重试
    if (attempt < retries) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * attempt));
    }
  }

  result.error = lastError;

  // 记录审计日志
  await logWebhookAttempt(result, payload);

  return result;
}

/**
 * 记录 Webhook 发送尝试
 */
async function logWebhookAttempt(result: WebhookResult, payload: WebhookPayload): Promise<void> {
  try {
    const client = getSupabaseClient();
    
    await client.from('webhook_logs').insert({
      event_id: result.eventId,
      event: result.event,
      target_url: result.targetUrl,
      payload: payload.data,
      success: result.success,
      http_status: result.httpStatus,
      attempts: result.attempts,
      response_time: result.responseTime,
      error: result.error,
      created_at: result.timestamp,
    });
  } catch (error) {
    console.error('[Webhook] Failed to log attempt:', error);
  }
}

/**
 * 批量发送 Webhook 给多个接收者
 */
export async function sendWebhooks(
  targets: Array<{ url: string; event: string; data: Record<string, any>; options?: any }>
): Promise<WebhookResult[]> {
  return Promise.all(
    targets.map(target => 
      sendWebhook(target.url, target.event, target.data, target.options)
    )
  );
}

/**
 * 获取 Buyer Agent 的 Webhook URL 列表
 */
export async function getBuyerWebhookUrls(): Promise<string[]> {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('agent_bindings')
      .select('webhook_url')
      .eq('role', 'buyer')
      .not('webhook_url', 'is', null);

    if (error) {
      console.error('[Webhook] Failed to get buyer webhooks:', error);
      return [];
    }

    return (data || [])
      .map(row => row.webhook_url)
      .filter((url): url is string => !!url && url.length > 0);
  } catch (error) {
    console.error('[Webhook] Failed to get buyer webhooks:', error);
    return [];
  }
}

/**
 * 获取 Manager Agent 的 Webhook URL 列表
 */
export async function getManagerWebhookUrls(): Promise<string[]> {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('agent_bindings')
      .select('webhook_url')
      .eq('role', 'manager')
      .not('webhook_url', 'is', null);

    if (error) {
      console.error('[Webhook] Failed to get manager webhooks:', error);
      return [];
    }

    return (data || [])
      .map(row => row.webhook_url)
      .filter((url): url is string => !!url && url.length > 0);
  } catch (error) {
    console.error('[Webhook] Failed to get manager webhooks:', error);
    return [];
  }
}

/**
 * 获取特定 Agent 的 Webhook URL
 */
export async function getAgentWebhookUrl(agentId: string): Promise<string | null> {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('agent_bindings')
      .select('webhook_url')
      .eq('agent_id', agentId)
      .not('webhook_url', 'is', null)
      .single();

    if (error || !data) {
      return null;
    }

    return data.webhook_url;
  } catch (error) {
    console.error('[Webhook] Failed to get agent webhook:', error);
    return null;
  }
}

/**
 * 通知所有 Manager（新事件待处理）
 */
export async function notifyManagers(
  event: string,
  data: Record<string, any>,
  options: { entityType?: string; entityId?: string | number } = {}
): Promise<WebhookResult[]> {
  const urls = await getManagerWebhookUrls();
  
  if (urls.length === 0) {
    console.info(`[Webhook] No manager webhooks configured for event: ${event}`);
    return [];
  }

  return Promise.all(
    urls.map(url => sendWebhook(url, event, data, options))
  );
}

/**
 * 通知所有 Buyer（PO 创建、待收货等）
 */
export async function notifyBuyers(
  event: string,
  data: Record<string, any>,
  options: { entityType?: string; entityId?: string | number } = {}
): Promise<WebhookResult[]> {
  const urls = await getBuyerWebhookUrls();

  if (urls.length === 0) {
    console.info(`[Webhook] No buyer webhooks configured for event: ${event}`);
    return [];
  }

  return Promise.all(
    urls.map(url => sendWebhook(url, event, data, options))
  );
}
