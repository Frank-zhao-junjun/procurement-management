/**
 * Webhook Dispatcher - Webhook 投递器
 * 
 * 负责将事件投递到 Agent 的 Webhook URL
 */

import { createHmac } from 'node:crypto';
import { getServiceRoleClient } from '@/storage/database/supabase-client';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DELIVERY_STATUS } from './types';

// Webhook 投递配置
const WEBHOOK_CONFIG = {
  timeout: 10000, // 10 秒超时
  maxRetries: 4,
  retryDelays: [60, 300, 900, 3600], // 1min, 5min, 15min, 1hour (秒)
  webhookSecret: process.env.WEBHOOK_SECRET || '',
};

// Webhook Payload 结构
interface WebhookPayload {
  event: {
    id: string;
    type: string;
    version: string;
    timestamp: string;
    source: string;
    correlationId?: string;
    data: unknown;
  };
  delivery: {
    attempt: number;
    maxAttempts: number;
    timestamp: string;
    signature?: string;
  };
}

/**
 * Webhook 投递器类
 */
export class WebhookDispatcher {
  private client: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.client = client || getServiceRoleClient();
  }

  /**
   * 生成 Webhook 签名
   */
  private generateSignature(payload: string): string {
    if (!WEBHOOK_CONFIG.webhookSecret) {
      return '';
    }
    const hmac = createHmac('sha256', WEBHOOK_CONFIG.webhookSecret);
    hmac.update(payload);
    return `sha256=${hmac.digest('hex')}`;
  }

  /**
   * 投递单个事件到 Webhook
   */
  async dispatch(
    deliveryId: string,
    webhookUrl: string,
    event: Record<string, unknown>,
    attempt: number
  ): Promise<{
    success: boolean;
    statusCode?: number;
    error?: string;
  }> {
    const payload: WebhookPayload = {
      event: {
        id: event.id as string,
        type: event.event_type as string,
        version: '1.0',
        timestamp: event.timestamp as string,
        source: event.source as string,
        correlationId: event.correlation_id as string | undefined,
        data: event.data,
      },
      delivery: {
        attempt,
        maxAttempts: WEBHOOK_CONFIG.maxRetries,
        timestamp: new Date().toISOString(),
      },
    };

    const payloadString = JSON.stringify(payload);
    const signature = this.generateSignature(payloadString);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_CONFIG.timeout);

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ProcurementSystem-Webhook/1.0',
          ...(signature && { 'X-Webhook-Signature': signature }),
        },
        body: payloadString,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // 更新投递状态
      await this.updateDelivery(
        deliveryId,
        response.ok ? DELIVERY_STATUS.DELIVERED : DELIVERY_STATUS.FAILED,
        response.status,
        response.ok ? undefined : await response.text()
      );

      return {
        success: response.ok,
        statusCode: response.status,
        error: response.ok ? undefined : `HTTP ${response.status}`,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      
      // 更新投递状态
      await this.updateDelivery(
        deliveryId,
        DELIVERY_STATUS.FAILED,
        undefined,
        error
      );

      return { success: false, error };
    }
  }

  /**
   * 更新投递记录
   */
  private async updateDelivery(
    deliveryId: string,
    status: string,
    statusCode?: number,
    errorMessage?: string
  ): Promise<void> {
    await this.client
      .from('event_deliveries')
      .update({
        status,
        attempts: this.client.rpc('increment_attempts', { row_id: deliveryId }),
        last_attempt_at: new Date().toISOString(),
        response_status: statusCode,
        response_body: statusCode ? String(statusCode) : null,
        error_message: errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq('id', deliveryId);
  }

  /**
   * 批量处理待投递事件
   */
  async processPendingDeliveries(batchSize = 50): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
  }> {
    const stats = { processed: 0, succeeded: 0, failed: 0 };

    // 查询待投递的记录
    const { data: pending, error } = await this.client
      .from('event_deliveries')
      .select(`
        id,
        attempts,
        agent_id,
        event_id,
        events (
          id,
          event_type,
          event_type as type,
          version,
          timestamp,
          source,
          correlation_id,
          data
        )
      `)
      .eq('status', DELIVERY_STATUS.PENDING)
      .lt('attempts', WEBHOOK_CONFIG.maxRetries)
      .order('created_at', { ascending: true })
      .limit(batchSize);

    if (error || !pending) {
      console.error('[WebhookDispatcher] Failed to query pending deliveries:', error);
      return stats;
    }

    for (const delivery of pending) {
      stats.processed++;

      // 查询 Agent 的 Webhook URL
      const { data: binding } = await this.client
        .from('agent_bindings')
        .select('webhook_url')
        .eq('agent_id', delivery.agent_id)
        .eq('is_active', true)
        .maybeSingle();

      if (!binding?.webhook_url) {
        // 没有 Webhook URL，标记为完成（无需投递）
        await this.updateDelivery(delivery.id, DELIVERY_STATUS.DELIVERED);
        stats.succeeded++;
        continue;
      }

      // 获取事件数据
      const event = delivery.events as Record<string, unknown>;
      if (!event) {
        await this.updateDelivery(delivery.id, DELIVERY_STATUS.DEAD_LETTER, undefined, 'Event not found');
        stats.failed++;
        continue;
      }

      // 计算重试延迟
      const retryDelay = WEBHOOK_CONFIG.retryDelays[delivery.attempts] || 3600;
      const nextAttemptTime = new Date(delivery.last_attempt_at || delivery.created_at);
      nextAttemptTime.setSeconds(nextAttemptTime.getSeconds() + retryDelay);

      if (new Date() < nextAttemptTime) {
        // 还在冷却期，跳过
        continue;
      }

      // 执行投递
      const result = await this.dispatch(
        delivery.id,
        binding.webhook_url,
        event,
        delivery.attempts + 1
      );

      if (result.success) {
        stats.succeeded++;
      } else {
        stats.failed++;

        // 检查是否需要进入死信队列
        if (delivery.attempts + 1 >= WEBHOOK_CONFIG.maxRetries) {
          await this.updateDelivery(
            delivery.id,
            DELIVERY_STATUS.DEAD_LETTER,
            result.statusCode,
            `Max retries exceeded: ${result.error}`
          );
        }
      }
    }

    return stats;
  }

  /**
   * 重试失败的死信
   */
  async retryDeadLetters(limit = 100): Promise<number> {
    const { data: deadLetters } = await this.client
      .from('event_deliveries')
      .select('id')
      .eq('status', DELIVERY_STATUS.DEAD_LETTER)
      .order('updated_at', { ascending: true })
      .limit(limit);

    if (!deadLetters) return 0;

    for (const dl of deadLetters) {
      await this.client
        .from('event_deliveries')
        .update({
          status: DELIVERY_STATUS.PENDING,
          attempts: 0,
        })
        .eq('id', dl.id);
    }

    return deadLetters.length;
  }
}

// 单例实例
let dispatcherInstance: WebhookDispatcher | null = null;

export function getWebhookDispatcher(): WebhookDispatcher {
  if (!dispatcherInstance) {
    dispatcherInstance = new WebhookDispatcher();
  }
  return dispatcherInstance;
}

// ============ 便捷函数 ============

/**
 * 手动触发事件投递
 */
export async function dispatchEvent(deliveryId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  const dispatcher = getWebhookDispatcher();
  const client = getServiceRoleClient();

  // 查询投递记录
  const { data: delivery } = await client
    .from('event_deliveries')
    .select(`
      id,
      attempts,
      agent_id,
      events (
        id,
        event_type,
        version,
        timestamp,
        source,
        correlation_id,
        data
      )
    `)
    .eq('id', deliveryId)
    .single();

  if (!delivery) {
    return { success: false, error: 'Delivery not found' };
  }

  // 查询 Webhook URL
  const { data: binding } = await client
    .from('agent_bindings')
    .select('webhook_url')
    .eq('agent_id', delivery.agent_id)
    .eq('is_active', true)
    .maybeSingle();

  if (!binding?.webhook_url) {
    return { success: false, error: 'Webhook URL not configured' };
  }

  const event = delivery.events as Record<string, unknown>;
  const result = await dispatcher.dispatch(
    deliveryId,
    binding.webhook_url,
    event,
    delivery.attempts + 1
  );

  return result;
}
