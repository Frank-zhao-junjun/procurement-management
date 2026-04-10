/**
 * Event Publisher - 事件发布器
 * 
 * 负责创建和发布事件到事件总线
 */

import { randomUUID } from 'node:crypto';
import { getServiceRoleClient } from '@/storage/database/supabase-client';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type EventType,
  type EventRouting,
  type EventMetadata,
  EVENT_PAYLOAD_SCHEMAS,
  getEventDefaultPriority,
  getEventDefaultTargetRoles,
  isValidEventType,
} from './types';

// 事件数据接口
export interface PublishEventParams<T = unknown> {
  type: EventType;
  data: T;
  routing?: EventRouting;
  metadata?: EventMetadata;
  correlationId?: string;
  causedBy?: string;
  source?: string;
}

// 事件记录（存入数据库）
interface EventRecord {
  id: string;
  event_type: string;
  version: string;
  timestamp: string;
  source: string;
  correlation_id: string | null;
  caused_by: string | null;
  data: unknown;
  routing: EventRouting | null;
  metadata: EventMetadata | null;
}

/**
 * 事件发布器类
 */
export class EventPublisher {
  private client: SupabaseClient;
  private source: string;

  constructor(client?: SupabaseClient, source = 'procurement-system') {
    this.client = client || getServiceRoleClient();
    this.source = source;
  }

  /**
   * 发布事件
   */
  async publish<T>(params: PublishEventParams<T>): Promise<{
    success: boolean;
    eventId?: string;
    error?: string;
  }> {
    try {
      // 验证事件类型
      if (!isValidEventType(params.type)) {
        return { success: false, error: `无效的事件类型: ${params.type}` };
      }

      // 验证 payload
      const schema = EVENT_PAYLOAD_SCHEMAS[params.type];
      const validation = schema.safeParse(params.data);
      if (!validation.success) {
        return {
          success: false,
          error: `事件数据验证失败: ${validation.error.message}`,
        };
      }

      // 构建事件
      const event: EventRecord = {
        id: randomUUID(),
        event_type: params.type,
        version: '1.0',
        timestamp: new Date().toISOString(),
        source: params.source || this.source,
        correlation_id: params.correlationId || null,
        caused_by: params.causedBy || null,
        data: validation.data,
        routing: this.buildRouting(params.type, params.routing),
        metadata: this.buildMetadata(params.type, params.metadata),
      };

      // 存入数据库
      const { error } = await this.client.from('events').insert(event);
      if (error) {
        console.error('[EventPublisher] Failed to save event:', error);
        return { success: false, error: error.message };
      }

      // 触发异步投递
      this.scheduleDeliveries(event.id, event.event_type, event.routing);

      return { success: true, eventId: event.id };
    } catch (err) {
      console.error('[EventPublisher] Unexpected error:', err);
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * 构建路由配置
   */
  private buildRouting(
    eventType: EventType,
    provided?: EventRouting
  ): EventRouting | null {
    const routing: EventRouting = {
      targetRoles: provided?.targetRoles || getEventDefaultTargetRoles(eventType),
      targetAgentIds: provided?.targetAgentIds,
      broadcast: provided?.broadcast || false,
    };

    // 如果没有任何路由信息，返回 null
    if (!routing.targetRoles && !routing.targetAgentIds && !routing.broadcast) {
      return null;
    }

    return routing;
  }

  /**
   * 构建元数据
   */
  private buildMetadata(
    eventType: EventType,
    provided?: EventMetadata
  ): EventMetadata | null {
    const metadata: EventMetadata = {
      priority: provided?.priority || getEventDefaultPriority(eventType),
      retryable: provided?.retryable ?? true,
      ttl: provided?.ttl || 3600, // 默认 1 小时
    };

    return metadata;
  }

  /**
   * 调度事件投递
   */
  private async scheduleDeliveries(
    eventId: string,
    eventType: string,
    routing: EventRouting | null
  ): Promise<void> {
    try {
      // 查找匹配的订阅者
      let query = this.client
        .from('agent_subscriptions')
        .select(`
          id,
          agent_binding_id,
          webhook_url,
          agent_bindings (
            agent_id,
            role
          )
        `)
        .eq('is_active', true)
        .eq('event_type', eventType);

      const { data: subscriptions, error } = await query;

      if (error || !subscriptions) {
        console.error('[EventPublisher] Failed to query subscriptions:', error);
        return;
      }

      // 为每个订阅者创建投递记录
      for (const sub of subscriptions) {
        const agentBinding = sub.agent_bindings as {
          agent_id: string;
          role: string;
        } | null;

        if (!agentBinding) continue;

        // 检查是否应该投递（基于角色或 Agent ID）
        if (routing) {
          if (
            routing.targetRoles &&
            !routing.targetRoles.includes(agentBinding.role as never)
          ) {
            continue;
          }
          if (
            routing.targetAgentIds &&
            !routing.targetAgentIds.includes(agentBinding.agent_id)
          ) {
            continue;
          }
        }

        // 创建投递记录
        await this.client.from('event_deliveries').insert({
          event_id: eventId,
          agent_id: agentBinding.agent_id,
          status: 'pending',
          attempts: 0,
          max_attempts: 4,
        });
      }
    } catch (err) {
      console.error('[EventPublisher] Failed to schedule deliveries:', err);
    }
  }

  /**
   * 发布 PR 相关事件
   */
  async publishPrEvent(
    eventType: EventType,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any,
    options?: { correlationId?: string; causedBy?: string }
  ): Promise<{ success: boolean; eventId?: string; error?: string }> {
    return this.publish({
      type: eventType,
      data,
      correlationId: options?.correlationId,
      causedBy: options?.causedBy,
    });
  }

  /**
   * 发布价格预警事件
   */
  async publishPriceWarning(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any,
    warningType: 'high' | 'abnormal'
  ): Promise<{ success: boolean; eventId?: string; error?: string }> {
    const eventType = warningType === 'high' ? 'price.high' : 'price.abnormal';
    return this.publish({
      type: eventType as EventType,
      data,
      metadata: { priority: 'normal', retryable: true },
    });
  }

  /**
   * 发布收货事件
   */
  async publishGrEvent(
    eventType: EventType,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any,
    options?: { correlationId?: string; causedBy?: string }
  ): Promise<{ success: boolean; eventId?: string; error?: string }> {
    return this.publish({
      type: eventType,
      data,
      correlationId: options?.correlationId,
      causedBy: options?.causedBy,
    });
  }
}

// 单例实例
let publisherInstance: EventPublisher | null = null;

export function getEventPublisher(): EventPublisher {
  if (!publisherInstance) {
    publisherInstance = new EventPublisher();
  }
  return publisherInstance;
}

// ============ 便捷发布函数 ============

/**
 * 发布事件（便捷函数）
 */
export async function publishEvent<T>(
  params: PublishEventParams<T>
): Promise<{ success: boolean; eventId?: string; error?: string }> {
  return getEventPublisher().publish(params);
}

/**
 * 发布 PR 提交事件
 */
export async function publishPrSubmitted(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
  causedBy?: string
): Promise<{ success: boolean; eventId?: string; error?: string }> {
  return getEventPublisher().publishPrEvent('pr.submitted', data, { causedBy });
}

/**
 * 发布 PR 审批事件
 */
export async function publishPrApproved(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
  causedBy?: string
): Promise<{ success: boolean; eventId?: string; error?: string }> {
  return getEventPublisher().publishPrEvent('pr.approved', data, { causedBy });
}

/**
 * 发布 PR 拒绝事件
 */
export async function publishPrRejected(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
  causedBy?: string
): Promise<{ success: boolean; eventId?: string; error?: string }> {
  return getEventPublisher().publishPrEvent('pr.rejected', data, { causedBy });
}

/**
 * 发布价格预警事件
 */
export async function publishPriceHigh(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
): Promise<{ success: boolean; eventId?: string; error?: string }> {
  return getEventPublisher().publishPriceWarning(data, 'high');
}

/**
 * 发布超收通知事件
 */
export async function publishGrOverdelivered(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
): Promise<{ success: boolean; eventId?: string; error?: string }> {
  return getEventPublisher().publishGrEvent('gr.overdelivered', data);
}

/**
 * 发布退货申请事件
 */
export async function publishGrReturnRequested(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
  causedBy?: string
): Promise<{ success: boolean; eventId?: string; error?: string }> {
  return getEventPublisher().publishGrEvent('gr.return_requested', data, { causedBy });
}

/**
 * 发布退货审批事件
 */
export async function publishGrReturnApproved(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
  causedBy?: string
): Promise<{ success: boolean; eventId?: string; error?: string }> {
  return getEventPublisher().publishGrEvent('gr.return_approved', data, { causedBy });
}
