/**
 * 事件驱动模块入口
 * 
 * 导出所有事件相关的类型、常量和函数
 */

// 事件类型定义
export {
  EventType,
  SUBSCRIPTION_RULES,
  // 类型
  type AgentRole,
  type BaseEventData,
  type PRSubmittedEventData,
  type PRApprovedEventData,
  type PRFAMatchedEventData,
  type PRFAMatchFailedEventData,
  type SourcingTaskCreatedEventData,
  type QuoteAwardedEventData,
  type POCreatedEventData,
  type GRCompletedEventData,
  type GROverdeliveryEventData,
  type FAMatchResult,
  type SourcingTaskResult,
  type AutoPOResult,
  type POLineInfo,
  type EventData,
  type SystemEvent,
  type SubscriptionRule,
} from './types';

// EventBus 核心和便捷方法
export {
  eventBus,
  emitPRSubmitted,
  emitPRApproved,
  emitPRFAMatched,
  emitPRFAMatchFailed,
  emitSourcingTaskCreated,
  emitQuoteAwarded,
  emitPOCreated,
  emitGRCompleted,
  emitGROverdelivery,
  type EventDispatchResult,
  type SubscriberInfo,
} from './bus';
