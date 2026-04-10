/**
 * Event-Driven 事件类型定义
 * 
 * 定义所有事件类型、Payload 结构和相关类型
 */

import { z } from 'zod';
import type { Role } from '@/storage/database/agent-binding';

// ============ 事件类型枚举 ============

export const EVENT_TYPES = {
  // 采购申请事件
  PR_CREATED: 'pr.created',
  PR_SUBMITTED: 'pr.submitted',
  PR_APPROVED: 'pr.approved',
  PR_REJECTED: 'pr.rejected',
  PR_PARTIALLY_APPROVED: 'pr.partially_approved',

  // 寻源事件
  SOURCING_CREATED: 'sourcing.created',
  SOURCING_COMPLETED: 'sourcing.completed',
  SOURCING_FAILED: 'sourcing.failed',
  SOURCING_CANCELLED: 'sourcing.cancelled',

  // 报价事件
  QUOTE_CREATED: 'quote.created',
  QUOTE_AWARDED: 'quote.awarded',
  QUOTE_REJECTED: 'quote.rejected',

  // 采购订单事件
  PO_CREATED: 'po.created',
  PO_SENT: 'po.sent',
  PO_RECEIVED: 'po.received',
  PO_CANCELLED: 'po.cancelled',

  // 收货事件
  GR_CREATED: 'gr.created',
  GR_COMPLETED: 'gr.completed',
  GR_OVERDELIVERED: 'gr.overdelivered',
  GR_RETURN_REQUESTED: 'gr.return_requested',
  GR_RETURN_APPROVED: 'gr.return_approved',
  GR_RETURN_COMPLETED: 'gr.return_completed',

  // 价格预警事件
  PRICE_HIGH: 'price.high',
  PRICE_ABNORMAL: 'price.abnormal',
  PRICE_UPDATED: 'price.updated',

  // 系统事件
  SYSTEM_READY: 'system.ready',
  SYSTEM_ERROR: 'system.error',
} as const;

export type EventType = typeof EVENT_TYPES[keyof typeof EVENT_TYPES];

// ============ 事件优先级 ============

export const EVENT_PRIORITY = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent',
} as const;

export type EventPriority = typeof EVENT_PRIORITY[keyof typeof EVENT_PRIORITY];

// ============ 事件投递状态 ============

export const DELIVERY_STATUS = {
  PENDING: 'pending',
  DELIVERED: 'delivered',
  FAILED: 'failed',
  DEAD_LETTER: 'dead_letter',
} as const;

export type DeliveryStatus = typeof DELIVERY_STATUS[keyof typeof DELIVERY_STATUS];

// ============ 事件基础结构 ============

export interface EventBase {
  id: string;
  type: string;
  version: string;
  timestamp: string;
  source: string;
  correlationId?: string;
  causedBy?: string;
  routing: EventRouting;
  metadata?: EventMetadata;
}

export interface EventRouting {
  targetRoles?: Role[];
  targetAgentIds?: string[];
  broadcast?: boolean;
}

export interface EventMetadata {
  priority?: EventPriority;
  retryable?: boolean;
  ttl?: number;
}

// ============ 事件 Payload Schema ============

// PR 相关事件
export const PrCreatedEventSchema = z.object({
  prId: z.number(),
  prNumber: z.string(),
  submitter: z.string(),
  totalAmount: z.number().optional(),
  linesCount: z.number(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
});

export const PrSubmittedEventSchema = z.object({
  prId: z.number(),
  prNumber: z.string(),
  submitter: z.string(),
  totalAmount: z.number().optional(),
  linesCount: z.number(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
});

export const PrApprovedEventSchema = z.object({
  prId: z.number(),
  prNumber: z.string(),
  approver: z.string(),
  approvedAt: z.string(),
  linesApproved: z.number(),
  linesTotal: z.number(),
});

export const PrRejectedEventSchema = z.object({
  prId: z.number(),
  prNumber: z.string(),
  rejecter: z.string(),
  rejectedAt: z.string(),
  reason: z.string().optional(),
});

// 寻源相关事件
export const SourcingCreatedEventSchema = z.object({
  sourcingTaskId: z.number(),
  sourcingTaskNumber: z.string(),
  prId: z.number(),
  prLineId: z.number().optional(),
  requirementText: z.string(),
  dueDate: z.string().optional(),
});

export const SourcingCompletedEventSchema = z.object({
  sourcingTaskId: z.number(),
  sourcingTaskNumber: z.string(),
  supplierId: z.number(),
  supplierName: z.string(),
  result: z.string().optional(),
});

// 报价相关事件
export const QuoteCreatedEventSchema = z.object({
  quoteId: z.number(),
  quoteNumber: z.string(),
  supplierId: z.number(),
  supplierName: z.string(),
  materialSnapshot: z.string(),
  unitPrice: z.number(),
  quantity: z.number(),
  totalAmount: z.number(),
});

export const QuoteAwardedEventSchema = z.object({
  quoteId: z.number(),
  quoteNumber: z.string(),
  supplierId: z.number(),
  supplierName: z.string(),
  materialSnapshot: z.string(),
  unitPrice: z.number(),
  awardedBy: z.string(),
  awardedAt: z.string(),
});

// PO 相关事件
export const PoCreatedEventSchema = z.object({
  poId: z.number(),
  poNumber: z.string(),
  supplierId: z.number(),
  supplierName: z.string(),
  totalAmount: z.number(),
  linesCount: z.number(),
});

export const PoSentEventSchema = z.object({
  poId: z.number(),
  poNumber: z.string(),
  sentAt: z.string(),
  recipientEmail: z.string().optional(),
});

// 收货相关事件
export const GrCreatedEventSchema = z.object({
  grId: z.number(),
  grNumber: z.string(),
  poId: z.number(),
  poLineId: z.number(),
  grType: z.enum(['in', 'out']),
  quantity: z.number(),
  createdBy: z.string(),
});

export const GrCompletedEventSchema = z.object({
  grId: z.number(),
  grNumber: z.string(),
  poId: z.number(),
  poLineId: z.number(),
  grType: z.enum(['in', 'out']),
  quantity: z.number(),
  completedAt: z.string(),
});

export const GrOverdeliveredEventSchema = z.object({
  grId: z.number(),
  grNumber: z.string(),
  poId: z.number(),
  poLineId: z.number(),
  orderQty: z.number(),
  grQuantity: z.number(),
  overdeliveryRatio: z.number(),
  pendingApproval: z.boolean().default(true),
});

export const GrReturnRequestedEventSchema = z.object({
  grId: z.number(),
  grNumber: z.string(),
  poId: z.number(),
  poLineId: z.number(),
  returnQty: z.number(),
  reason: z.string(),
  requestedBy: z.string(),
  requestedAt: z.string(),
});

export const GrReturnApprovedEventSchema = z.object({
  grId: z.number(),
  grNumber: z.string(),
  approvedBy: z.string(),
  approvedAt: z.string(),
  notes: z.string().optional(),
});

// 价格预警事件
export const PriceHighEventSchema = z.object({
  materialId: z.number(),
  materialName: z.string(),
  quotedPrice: z.number(),
  historicalAvgPrice: z.number(),
  priceIncreaseRatio: z.number(),
  warningThreshold: z.number().default(0.1),
  source: z.enum(['quote', 'po']),
  sourceId: z.number(),
});

export const PriceAbnormalEventSchema = z.object({
  materialId: z.number(),
  materialName: z.string(),
  currentPrice: z.number(),
  previousPrice: z.number(),
  priceChangeRatio: z.number(),
  source: z.enum(['quote', 'po']),
  sourceId: z.number(),
});

// ============ 事件类型注册表 ============

export const EVENT_PAYLOAD_SCHEMAS: Record<EventType, z.ZodType> = {
  [EVENT_TYPES.PR_CREATED]: PrCreatedEventSchema,
  [EVENT_TYPES.PR_SUBMITTED]: PrSubmittedEventSchema,
  [EVENT_TYPES.PR_APPROVED]: PrApprovedEventSchema,
  [EVENT_TYPES.PR_REJECTED]: PrRejectedEventSchema,
  [EVENT_TYPES.PR_PARTIALLY_APPROVED]: PrApprovedEventSchema,

  [EVENT_TYPES.SOURCING_CREATED]: SourcingCreatedEventSchema,
  [EVENT_TYPES.SOURCING_COMPLETED]: SourcingCompletedEventSchema,
  [EVENT_TYPES.SOURCING_FAILED]: SourcingCreatedEventSchema,
  [EVENT_TYPES.SOURCING_CANCELLED]: SourcingCreatedEventSchema,

  [EVENT_TYPES.QUOTE_CREATED]: QuoteCreatedEventSchema,
  [EVENT_TYPES.QUOTE_AWARDED]: QuoteAwardedEventSchema,
  [EVENT_TYPES.QUOTE_REJECTED]: QuoteCreatedEventSchema,

  [EVENT_TYPES.PO_CREATED]: PoCreatedEventSchema,
  [EVENT_TYPES.PO_SENT]: PoSentEventSchema,
  [EVENT_TYPES.PO_RECEIVED]: PoSentEventSchema,
  [EVENT_TYPES.PO_CANCELLED]: PoCreatedEventSchema,

  [EVENT_TYPES.GR_CREATED]: GrCreatedEventSchema,
  [EVENT_TYPES.GR_COMPLETED]: GrCompletedEventSchema,
  [EVENT_TYPES.GR_OVERDELIVERED]: GrOverdeliveredEventSchema,
  [EVENT_TYPES.GR_RETURN_REQUESTED]: GrReturnRequestedEventSchema,
  [EVENT_TYPES.GR_RETURN_APPROVED]: GrReturnApprovedEventSchema,
  [EVENT_TYPES.GR_RETURN_COMPLETED]: GrCompletedEventSchema,

  [EVENT_TYPES.PRICE_HIGH]: PriceHighEventSchema,
  [EVENT_TYPES.PRICE_ABNORMAL]: PriceAbnormalEventSchema,
  [EVENT_TYPES.PRICE_UPDATED]: PriceHighEventSchema,

  [EVENT_TYPES.SYSTEM_READY]: z.object({}),
  [EVENT_TYPES.SYSTEM_ERROR]: z.object({
    error: z.string(),
    stack: z.string().optional(),
  }),
};

// ============ 角色订阅配置 ============

/**
 * 每个角色默认订阅的事件类型
 */
export const DEFAULT_ROLE_SUBSCRIPTIONS: Record<Role, EventType[]> = {
  requester: [
    EVENT_TYPES.PR_APPROVED,
    EVENT_TYPES.PR_REJECTED,
    EVENT_TYPES.GR_COMPLETED,
    EVENT_TYPES.GR_RETURN_APPROVED,
  ],
  buyer: [
    EVENT_TYPES.PR_APPROVED,
    EVENT_TYPES.SOURCING_CREATED,
    EVENT_TYPES.QUOTE_AWARDED,
    EVENT_TYPES.PO_CREATED,
    EVENT_TYPES.GR_COMPLETED,
    EVENT_TYPES.GR_OVERDELIVERED,
    EVENT_TYPES.PRICE_HIGH,
    EVENT_TYPES.PRICE_ABNORMAL,
  ],
  manager: [
    EVENT_TYPES.PR_SUBMITTED,
    EVENT_TYPES.GR_OVERDELIVERED,
    EVENT_TYPES.GR_RETURN_REQUESTED,
    EVENT_TYPES.PRICE_HIGH,
    EVENT_TYPES.PRICE_ABNORMAL,
  ],
};

// ============ 辅助函数 ============

/**
 * 获取事件的默认优先级
 */
export function getEventDefaultPriority(eventType: EventType): EventPriority {
  switch (eventType) {
    case EVENT_TYPES.PR_SUBMITTED:
    case EVENT_TYPES.GR_OVERDELIVERED:
    case EVENT_TYPES.GR_RETURN_REQUESTED:
    case EVENT_TYPES.SYSTEM_ERROR:
      return EVENT_PRIORITY.HIGH;
    case EVENT_TYPES.PRICE_HIGH:
    case EVENT_TYPES.PRICE_ABNORMAL:
      return EVENT_PRIORITY.NORMAL;
    default:
      return EVENT_PRIORITY.NORMAL;
  }
}

/**
 * 获取事件的默认目标角色
 */
export function getEventDefaultTargetRoles(eventType: EventType): Role[] | undefined {
  switch (eventType) {
    case EVENT_TYPES.PR_SUBMITTED:
      return ['manager'];
    case EVENT_TYPES.PR_APPROVED:
    case EVENT_TYPES.PR_REJECTED:
      return ['requester', 'buyer'];
    case EVENT_TYPES.GR_OVERDELIVERED:
      return ['manager'];
    case EVENT_TYPES.GR_RETURN_REQUESTED:
      return ['manager'];
    case EVENT_TYPES.PRICE_HIGH:
    case EVENT_TYPES.PRICE_ABNORMAL:
      return ['buyer', 'manager'];
    default:
      return undefined;
  }
}

/**
 * 检查事件类型是否有效
 */
export function isValidEventType(type: string): type is EventType {
  return Object.values(EVENT_TYPES).includes(type as EventType);
}
