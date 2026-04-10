/**
 * Event Subscriber - 事件订阅管理器
 * 
 * 负责管理 Agent 的事件订阅
 */

import { getServiceRoleClient } from '@/storage/database/supabase-client';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Role } from '@/storage/database/agent-binding';
import { type EventType, DEFAULT_ROLE_SUBSCRIPTIONS, isValidEventType } from './types';

// 订阅记录
interface SubscriptionRecord {
  id: string;
  agent_binding_id: number;
  event_type: string;
  webhook_url: string | null;
  is_active: boolean;
  created_at: string;
}

/**
 * 事件订阅管理器类
 */
export class EventSubscriber {
  private client: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.client = client || getServiceRoleClient();
  }

  /**
   * 为 Agent 创建订阅
   */
  async subscribe(
    agentBindingId: number,
    eventTypes: EventType[],
    webhookUrl?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // 验证事件类型
      for (const type of eventTypes) {
        if (!isValidEventType(type)) {
          return { success: false, error: `无效的事件类型: ${type}` };
        }
      }

      // 批量插入订阅
      const subscriptions = eventTypes.map((type) => ({
        agent_binding_id: agentBindingId,
        event_type: type,
        webhook_url: webhookUrl || null,
        is_active: true,
      }));

      const { error } = await this.client
        .from('agent_subscriptions')
        .upsert(subscriptions, {
          onConflict: 'agent_binding_id,event_type',
        });

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * 为 Agent 取消订阅
   */
  async unsubscribe(
    agentBindingId: number,
    eventTypes: EventType[]
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await this.client
        .from('agent_subscriptions')
        .delete()
        .eq('agent_binding_id', agentBindingId)
        .in('event_type', eventTypes);

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * 更新订阅的 Webhook URL
   */
  async updateWebhookUrl(
    agentBindingId: number,
    webhookUrl: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await this.client
        .from('agent_subscriptions')
        .update({ webhook_url: webhookUrl })
        .eq('agent_binding_id', agentBindingId)
        .eq('is_active', true);

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * 获取 Agent 的所有订阅
   */
  async getSubscriptions(agentBindingId: number): Promise<{
    subscriptions: Array<{ eventType: string; webhookUrl: string | null }>;
    error?: string;
  }> {
    try {
      const { data, error } = await this.client
        .from('agent_subscriptions')
        .select('event_type, webhook_url')
        .eq('agent_binding_id', agentBindingId)
        .eq('is_active', true);

      if (error) {
        return { subscriptions: [], error: error.message };
      }

      return {
        subscriptions: (data || []).map((s) => ({
          eventType: s.event_type,
          webhookUrl: s.webhook_url,
        })),
      };
    } catch (err) {
      return { subscriptions: [], error: (err as Error).message };
    }
  }

  /**
   * 根据角色设置默认订阅
   */
  async setDefaultSubscriptions(
    agentBindingId: number,
    role: Role
  ): Promise<{ success: boolean; error?: string }> {
    const defaultEvents = DEFAULT_ROLE_SUBSCRIPTIONS[role];
    if (!defaultEvents) {
      return { success: false, error: `未知角色: ${role}` };
    }
    return this.subscribe(agentBindingId, defaultEvents);
  }

  /**
   * 启用/禁用订阅
   */
  async setActive(
    agentBindingId: number,
    eventTypes: EventType[],
    isActive: boolean
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await this.client
        .from('agent_subscriptions')
        .update({ is_active: isActive })
        .eq('agent_binding_id', agentBindingId)
        .in('event_type', eventTypes);

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * 查询订阅某事件的所有 Agent
   */
  async getSubscribers(eventType: EventType): Promise<{
    agents: Array<{ agentId: string; role: Role; webhookUrl: string | null }>;
    error?: string;
  }> {
    try {
      const { data, error } = await this.client
        .from('agent_subscriptions')
        .select(`
          agent_bindings (
            agent_id,
            role,
            webhook_url
          )
        `)
        .eq('event_type', eventType)
        .eq('is_active', true);

      if (error) {
        return { agents: [], error: error.message };
      }

      const agents = (data || [])
        .map((s) => {
          const bindings = s.agent_bindings as unknown as Array<{ agent_id: string; role: Role; webhook_url: string | null }> | null;
          return bindings?.[0] || null;
        })
        .filter((b): b is { agent_id: string; role: Role; webhook_url: string | null } => b !== null)
        .map((b) => ({
          agentId: b.agent_id,
          role: b.role,
          webhookUrl: b.webhook_url,
        }));

      return { agents };
    } catch (err) {
      return { agents: [], error: (err as Error).message };
    }
  }
}

// 单例实例
let subscriberInstance: EventSubscriber | null = null;

export function getEventSubscriber(): EventSubscriber {
  if (!subscriberInstance) {
    subscriberInstance = new EventSubscriber();
  }
  return subscriberInstance;
}

// ============ 便捷函数 ============

/**
 * 订阅事件
 */
export async function subscribe(
  agentBindingId: number,
  eventTypes: EventType[],
  webhookUrl?: string
): Promise<{ success: boolean; error?: string }> {
  return getEventSubscriber().subscribe(agentBindingId, eventTypes, webhookUrl);
}

/**
 * 取消订阅
 */
export async function unsubscribe(
  agentBindingId: number,
  eventTypes: EventType[]
): Promise<{ success: boolean; error?: string }> {
  return getEventSubscriber().unsubscribe(agentBindingId, eventTypes);
}

/**
 * 获取订阅列表
 */
export async function getSubscriptions(
  agentBindingId: number
): Promise<{ subscriptions: Array<{ eventType: string; webhookUrl: string | null }>; error?: string }> {
  return getEventSubscriber().getSubscriptions(agentBindingId);
}
