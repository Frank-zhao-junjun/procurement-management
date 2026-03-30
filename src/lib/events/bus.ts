/**
 * EventBus - 事件驱动核心模块
 * 
 * 功能：
 * 1. 事件发布（emit）
 * 2. 基于角色的订阅者管理
 * 3. Webhook 分发
 * 4. 事件日志记录
 */

import { randomUUID } from 'crypto';
import { getSupabaseClient } from '@/storage/database';
import { sendWebhook, WebhookResult } from '@/lib/webhook';
import {
  EventType,
  SystemEvent,
  EventData,
  SUBSCRIPTION_RULES,
  AgentRole,
} from './types';

// ============ 配置 ============

const EVENT_LOG_ENABLED = true;
const ASYNC_DISPATCH = true; // 异步分发（不阻塞调用方）

// ============ 类型定义 ============

interface EventDispatchResult {
  eventId: string;
  event: EventType;
  success: boolean;
  subscribers: number;
  webhookResults: WebhookResult[];
  error?: string;
}

interface SubscriberInfo {
  agent_id: string;
  role: AgentRole;
  webhook_url: string;
}

// ============ EventBus 类 ============

class EventBus {
  /**
   * 发布事件
   * 
   * @param type - 事件类型
   * @param data - 事件数据
   * @param source - 事件来源（调用方标识）
   * @returns 事件分发结果
   */
  async emit<T extends EventData>(
    type: EventType,
    data: T,
    source: string = 'unknown'
  ): Promise<EventDispatchResult> {
    const eventId = this.generateEventId();
    const timestamp = new Date().toISOString();

    const event: SystemEvent<T> = {
      id: eventId,
      type,
      data,
      timestamp,
      source,
    };

    console.info(`[EventBus] Emitting event: ${type} (id: ${eventId}, source: ${source})`);

    // 获取订阅该事件的角色
    const subscribedRoles = this.getSubscribedRoles(type);
    
    // 获取订阅者列表
    const subscribers = await this.getSubscribers(subscribedRoles);

    const result: EventDispatchResult = {
      eventId,
      event: type,
      success: true,
      subscribers: subscribers.length,
      webhookResults: [],
    };

    if (subscribers.length === 0) {
      console.info(`[EventBus] No subscribers for event: ${type}`);
      
      // 记录事件日志（无订阅者）
      if (EVENT_LOG_ENABLED) {
        this.logEvent(event, []).catch(err => 
          console.error('[EventBus] Failed to log event:', err)
        );
      }
      
      return result;
    }

    // 分发事件到订阅者
    try {
      const webhookResults = await this.dispatchToSubscribers(event, subscribers);
      result.webhookResults = webhookResults;
      result.success = webhookResults.some(r => r.success);

      // 记录事件日志
      if (EVENT_LOG_ENABLED) {
        await this.logEvent(event, webhookResults);
      }
    } catch (error: any) {
      result.success = false;
      result.error = error.message;
      console.error(`[EventBus] Failed to dispatch event ${type}:`, error);
    }

    return result;
  }

  /**
   * 异步发布事件（不等待结果）
   */
  emitAsync<T extends EventData>(
    type: EventType,
    data: T,
    source: string = 'unknown'
  ): void {
    this.emit(type, data, source).catch(err => 
      console.error(`[EventBus] Async emit failed for ${type}:`, err)
    );
  }

  /**
   * 获取订阅该事件的角色列表
   */
  private getSubscribedRoles(eventType: EventType): AgentRole[] {
    const roles = SUBSCRIPTION_RULES
      .filter(rule => rule.event === eventType)
      .map(rule => rule.role);
    
    return [...new Set(roles)]; // 去重
  }

  /**
   * 获取指定角色的订阅者列表
   */
  private async getSubscribers(roles: AgentRole[]): Promise<SubscriberInfo[]> {
    if (roles.length === 0) return [];

    try {
      const client = getSupabaseClient();
      const { data, error } = await client
        .from('agent_bindings')
        .select('agent_id, role, webhook_url')
        .in('role', roles)
        .not('webhook_url', 'is', null);

      if (error) {
        console.error('[EventBus] Failed to get subscribers:', error);
        return [];
      }

      return (data || [])
        .filter(row => row.webhook_url && row.webhook_url.length > 0)
        .map(row => ({
          agent_id: row.agent_id,
          role: row.role as AgentRole,
          webhook_url: row.webhook_url,
        }));
    } catch (error) {
      console.error('[EventBus] Error getting subscribers:', error);
      return [];
    }
  }

  /**
   * 分发事件到订阅者
   */
  private async dispatchToSubscribers(
    event: SystemEvent,
    subscribers: SubscriberInfo[]
  ): Promise<WebhookResult[]> {
    const results = await Promise.all(
      subscribers.map(subscriber => 
        this.sendToSubscriber(event, subscriber)
      )
    );

    return results;
  }

  /**
   * 发送事件到单个订阅者
   */
  private async sendToSubscriber(
    event: SystemEvent,
    subscriber: SubscriberInfo
  ): Promise<WebhookResult> {
    // 构建事件 payload
    const payload = {
      schema_version: '1.0',
      event: event.type,
      event_id: event.id,
      timestamp: event.timestamp,
      source: event.source,
      data: event.data,
      subscriber: {
        agent_id: subscriber.agent_id,
        role: subscriber.role,
      },
    };

    return sendWebhook(
      subscriber.webhook_url,
      event.type,
      payload,
      {
        entityType: event.data.entity_type,
        entityId: event.data.entity_id,
      }
    );
  }

  /**
   * 记录事件日志
   */
  private async logEvent(
    event: SystemEvent,
    webhookResults: WebhookResult[]
  ): Promise<void> {
    try {
      const client = getSupabaseClient();
      
      // 记录到 event_logs 表
      await client.from('event_logs').insert({
        event_id: event.id,
        event_type: event.type,
        source: event.source,
        entity_type: event.data.entity_type,
        entity_id: event.data.entity_id,
        payload: event.data,
        subscribers_notified: webhookResults.length,
        success: webhookResults.length > 0 ? webhookResults.some(r => r.success) : true,
        created_at: event.timestamp,
      });

      // 如果有失败的分发，记录详细信息
      const failedDispatches = webhookResults.filter(r => !r.success);
      if (failedDispatches.length > 0) {
        console.warn(`[EventBus] ${failedDispatches.length} subscriber(s) failed to receive event ${event.type}`);
      }
    } catch (error) {
      console.error('[EventBus] Failed to log event:', error);
    }
  }

  /**
   * 生成事件 ID
   */
  private generateEventId(): string {
    return randomUUID();
  }
}

// ============ 导出单例 ============

export const eventBus = new EventBus();

// ============ 便捷方法 ============

/**
 * 发布 PR 提交事件
 */
export function emitPRSubmitted(data: {
  prId: number;
  prNumber: string;
  applicantId: string;
  applicantName?: string;
  totalAmount?: number;
  linesCount?: number;
  actor?: string;
  actorRole?: string;
}, source?: string): Promise<EventDispatchResult> {
  return eventBus.emit(EventType.PR_SUBMITTED, {
    entity_type: 'purchase_request',
    entity_id: data.prId,
    timestamp: new Date().toISOString(),
    actor: data.actor,
    actor_role: data.actorRole,
    pr_id: data.prId,
    pr_number: data.prNumber,
    applicant_id: data.applicantId,
    applicant_name: data.applicantName,
    total_amount: data.totalAmount,
    lines_count: data.linesCount,
  }, source);
}

/**
 * 发布 PR 审批事件
 */
export function emitPRApproved(data: {
  prId: number;
  prNumber: string;
  approved: boolean;
  approverId: string;
  approverName?: string;
  note?: string;
  faMatches?: any[];
  sourcingTasks?: any[];
  autoPOs?: any[];
  actor?: string;
  actorRole?: string;
}, source?: string): Promise<EventDispatchResult> {
  const eventType = data.approved ? EventType.PR_APPROVED : EventType.PR_REJECTED;
  
  return eventBus.emit(eventType, {
    entity_type: 'purchase_request',
    entity_id: data.prId,
    timestamp: new Date().toISOString(),
    actor: data.actor,
    actor_role: data.actorRole,
    pr_id: data.prId,
    pr_number: data.prNumber,
    approved: data.approved,
    approver_id: data.approverId,
    approver_name: data.approverName,
    note: data.note,
    fa_matches: data.faMatches,
    sourcing_tasks: data.sourcingTasks,
    auto_pos: data.autoPOs,
  }, source);
}

/**
 * 发布 FA 匹配成功事件
 */
export function emitPRFAMatched(data: {
  prId: number;
  prNumber: string;
  prLineId: number;
  faId: number;
  faNumber: string;
  supplierId: number;
  supplierName: string;
  materialId?: number;
  materialSnapshot: string;
  unitPrice: number;
  quantity: number;
  matchType: 'material_id' | 'text_similarity';
  actor?: string;
  actorRole?: string;
}, source?: string): Promise<EventDispatchResult> {
  return eventBus.emit(EventType.PR_FA_MATCHED, {
    entity_type: 'purchase_request_line',
    entity_id: data.prLineId,
    timestamp: new Date().toISOString(),
    actor: data.actor,
    actor_role: data.actorRole,
    pr_id: data.prId,
    pr_number: data.prNumber,
    pr_line_id: data.prLineId,
    fa_id: data.faId,
    fa_number: data.faNumber,
    supplier_id: data.supplierId,
    supplier_name: data.supplierName,
    material_id: data.materialId,
    material_snapshot: data.materialSnapshot,
    unit_price: data.unitPrice,
    quantity: data.quantity,
    match_type: data.matchType,
  }, source);
}

/**
 * 发布 FA 匹配失败事件
 */
export function emitPRFAMatchFailed(data: {
  prId: number;
  prNumber: string;
  prLineId: number;
  materialId?: number;
  materialSnapshot: string;
  reason: 'no_valid_fa' | 'expired' | 'price_mismatch' | 'other';
  actor?: string;
  actorRole?: string;
}, source?: string): Promise<EventDispatchResult> {
  return eventBus.emit(EventType.PR_FA_MATCH_FAILED, {
    entity_type: 'purchase_request_line',
    entity_id: data.prLineId,
    timestamp: new Date().toISOString(),
    actor: data.actor,
    actor_role: data.actorRole,
    pr_id: data.prId,
    pr_number: data.prNumber,
    pr_line_id: data.prLineId,
    material_id: data.materialId,
    material_snapshot: data.materialSnapshot,
    reason: data.reason,
  }, source);
}

/**
 * 发布寻源任务创建事件
 */
export function emitSourcingTaskCreated(data: {
  taskId: number;
  taskNumber: string;
  prId: number;
  prNumber: string;
  prLineId: number;
  materialSnapshot: string;
  requirementText: string;
  status: string;
  actor?: string;
  actorRole?: string;
}, source?: string): Promise<EventDispatchResult> {
  return eventBus.emit(EventType.SOURCING_TASK_CREATED, {
    entity_type: 'sourcing_task',
    entity_id: data.taskId,
    timestamp: new Date().toISOString(),
    actor: data.actor,
    actor_role: data.actorRole,
    task_id: data.taskId,
    task_number: data.taskNumber,
    pr_id: data.prId,
    pr_number: data.prNumber,
    pr_line_id: data.prLineId,
    material_snapshot: data.materialSnapshot,
    requirement_text: data.requirementText,
    status: data.status,
  }, source);
}

/**
 * 发布报价单中标事件
 */
export function emitQuoteAwarded(data: {
  quoteId: number;
  quoteNumber: string;
  sourcingTaskId: number;
  sourcingTaskNumber: string;
  prId?: number;
  prNumber?: string;
  supplierId: number;
  supplierName: string;
  materialSnapshot: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  autoPO?: { poId: number; poNumber: string; status: string };
  actor?: string;
  actorRole?: string;
}, source?: string): Promise<EventDispatchResult> {
  return eventBus.emit(EventType.QUOTE_AWARDED, {
    entity_type: 'quote',
    entity_id: data.quoteId,
    timestamp: new Date().toISOString(),
    actor: data.actor,
    actor_role: data.actorRole,
    quote_id: data.quoteId,
    quote_number: data.quoteNumber,
    sourcing_task_id: data.sourcingTaskId,
    sourcing_task_number: data.sourcingTaskNumber,
    pr_id: data.prId,
    pr_number: data.prNumber,
    supplier_id: data.supplierId,
    supplier_name: data.supplierName,
    material_snapshot: data.materialSnapshot,
    quantity: data.quantity,
    unit_price: data.unitPrice,
    total_price: data.totalPrice,
    auto_po: data.autoPO ? {
      po_id: data.autoPO.poId,
      po_number: data.autoPO.poNumber,
      status: data.autoPO.status,
    } : undefined,
  }, source);
}

/**
 * 发布 PO 创建事件
 */
export function emitPOCreated(data: {
  poId: number;
  poNumber: string;
  supplierId?: number;
  supplierName: string;
  prId?: number;
  prNumber?: string;
  status: string;
  deliveryDate?: string;
  totalAmount?: number;
  linesCount: number;
  lines?: any[];
  actor?: string;
  actorRole?: string;
}, source?: string): Promise<EventDispatchResult> {
  return eventBus.emit(EventType.PO_CREATED, {
    entity_type: 'purchase_order',
    entity_id: data.poId,
    timestamp: new Date().toISOString(),
    actor: data.actor,
    actor_role: data.actorRole,
    po_id: data.poId,
    po_number: data.poNumber,
    supplier_id: data.supplierId,
    supplier_name: data.supplierName,
    pr_id: data.prId,
    pr_number: data.prNumber,
    status: data.status,
    delivery_date: data.deliveryDate,
    total_amount: data.totalAmount,
    lines_count: data.linesCount,
    lines: data.lines,
  }, source);
}

/**
 * 发布收货完成事件
 */
export function emitGRCompleted(data: {
  grId: number;
  grNumber: string;
  poId: number;
  poNumber: string;
  poLineId: number;
  materialSnapshot: string;
  orderedQty: number;
  receivedQty: number;
  cumulativeReceivedQty: number;
  pendingQty: number;
  isFullyReceived: boolean;
  overdeliveryRatio?: number;
  actor?: string;
  actorRole?: string;
}, source?: string): Promise<EventDispatchResult> {
  return eventBus.emit(EventType.GR_COMPLETED, {
    entity_type: 'goods_receipt',
    entity_id: data.grId,
    timestamp: new Date().toISOString(),
    actor: data.actor,
    actor_role: data.actorRole,
    gr_id: data.grId,
    gr_number: data.grNumber,
    po_id: data.poId,
    po_number: data.poNumber,
    po_line_id: data.poLineId,
    material_snapshot: data.materialSnapshot,
    ordered_qty: data.orderedQty,
    received_qty: data.receivedQty,
    cumulative_received_qty: data.cumulativeReceivedQty,
    pending_qty: data.pendingQty,
    is_fully_received: data.isFullyReceived,
    overdelivery_ratio: data.overdeliveryRatio,
  }, source);
}

/**
 * 发布收货超收事件
 */
export function emitGROverdelivery(data: {
  grId: number;
  grNumber: string;
  poId: number;
  poNumber: string;
  poLineId: number;
  materialSnapshot: string;
  orderedQty: number;
  receivedQty: number;
  overdeliveryQty: number;
  overdeliveryRatio: number;
  grStatus: 'pending_approval' | 'approved' | 'rejected';
  actor?: string;
  actorRole?: string;
}, source?: string): Promise<EventDispatchResult> {
  return eventBus.emit(EventType.GR_OVERDELIVERY, {
    entity_type: 'goods_receipt',
    entity_id: data.grId,
    timestamp: new Date().toISOString(),
    actor: data.actor,
    actor_role: data.actorRole,
    gr_id: data.grId,
    gr_number: data.grNumber,
    po_id: data.poId,
    po_number: data.poNumber,
    po_line_id: data.poLineId,
    material_snapshot: data.materialSnapshot,
    ordered_qty: data.orderedQty,
    received_qty: data.receivedQty,
    overdelivery_qty: data.overdeliveryQty,
    overdelivery_ratio: data.overdeliveryRatio,
    gr_status: data.grStatus,
  }, source);
}

// 导出类型
export type { EventDispatchResult, SubscriberInfo };
