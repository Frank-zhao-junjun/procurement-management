/**
 * 事件类型定义
 * 
 * 基于业务需求文档定义的所有事件类型
 */

// ============ 事件类型枚举 ============

/**
 * 事件类型枚举
 * 命名规范：实体_动作
 */
export enum EventType {
  // 采购申请相关
  PR_SUBMITTED = 'pr_submitted',           // a. 采购申请被提交后
  PR_APPROVED = 'pr_approved',             // b. 采购申请被审批后
  PR_REJECTED = 'pr_rejected',             // b. 采购申请被审批后（拒绝）
  
  // 框架协议匹配相关
  PR_FA_MATCHED = 'pr_fa_matched',         // c. PR 与框架协议匹配成功
  PR_FA_MATCH_FAILED = 'pr_fa_match_failed', // d. PR 与框架协议匹配失败
  
  // 寻源任务相关
  SOURCING_TASK_CREATED = 'sourcing_task_created', // e. 寻源任务被创建后
  QUOTE_AWARDED = 'quote_awarded',         // f. 报价单中标后
  
  // 采购订单相关
  PO_CREATED = 'po_created',               // g. 采购订单被创建后
  
  // 收货相关
  GR_COMPLETED = 'gr_completed',           // h. 收货完成（未超收或超收<5%）
  GR_OVERDELIVERY = 'gr_overdelivery',     // i. 收货超收（>5%）
}

// ============ 事件数据结构 ============

/** 基础事件数据 */
export interface BaseEventData {
  entity_type: string;
  entity_id: number;
  timestamp: string;
  actor?: string;
  actor_role?: string;
}

/** PR 提交事件数据 */
export interface PRSubmittedEventData extends BaseEventData {
  pr_id: number;
  pr_number: string;
  applicant_id: string;
  applicant_name?: string;
  total_amount?: number;
  lines_count?: number;
}

/** PR 审批事件数据 */
export interface PRApprovedEventData extends BaseEventData {
  pr_id: number;
  pr_number: string;
  approved: boolean;
  approver_id: string;
  approver_name?: string;
  note?: string;
  // 审批结果
  fa_matches?: FAMatchResult[];
  sourcing_tasks?: SourcingTaskResult[];
  auto_pos?: AutoPOResult[];
}

/** FA 匹配结果 */
export interface FAMatchResult {
  fa_id: number;
  fa_number: string;
  supplier_id: number;
  supplier_name: string;
  unit_price: number;
  match_type: 'material_id' | 'text_similarity';
  requires_confirmation?: boolean;
}

/** 寻源任务结果 */
export interface SourcingTaskResult {
  task_id: number;
  task_number: string;
  pr_line_id: number;
  material_snapshot: string;
}

/** 自动创建 PO 结果 */
export interface AutoPOResult {
  po_id: number;
  po_number: string;
  supplier_id: number;
  supplier_name: string;
}

/** FA 匹配成功事件数据 */
export interface PRFAMatchedEventData extends BaseEventData {
  pr_id: number;
  pr_number: string;
  pr_line_id: number;
  fa_id: number;
  fa_number: string;
  supplier_id: number;
  supplier_name: string;
  material_id?: number;
  material_snapshot: string;
  unit_price: number;
  quantity: number;
  match_type: 'material_id' | 'text_similarity';
}

/** FA 匹配失败事件数据 */
export interface PRFAMatchFailedEventData extends BaseEventData {
  pr_id: number;
  pr_number: string;
  pr_line_id: number;
  material_id?: number;
  material_snapshot: string;
  reason: 'no_valid_fa' | 'expired' | 'price_mismatch' | 'other';
}

/** 寻源任务创建事件数据 */
export interface SourcingTaskCreatedEventData extends BaseEventData {
  task_id: number;
  task_number: string;
  pr_id: number;
  pr_number: string;
  pr_line_id: number;
  material_snapshot: string;
  requirement_text: string;
  status: string;
}

/** 报价单中标事件数据 */
export interface QuoteAwardedEventData extends BaseEventData {
  quote_id: number;
  quote_number: string;
  sourcing_task_id: number;
  sourcing_task_number: string;
  pr_id?: number;
  pr_number?: string;
  supplier_id: number;
  supplier_name: string;
  material_snapshot: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  // 自动创建的 PO
  auto_po?: {
    po_id: number;
    po_number: string;
    status: string;
  };
}

/** PO 创建事件数据 */
export interface POCreatedEventData extends BaseEventData {
  po_id: number;
  po_number: string;
  supplier_id?: number;
  supplier_name: string;
  pr_id?: number;
  pr_number?: string;
  status: string;
  delivery_date?: string;
  total_amount?: number;
  lines_count: number;
  lines?: POLineInfo[];
}

/** PO 行信息 */
export interface POLineInfo {
  line_id: number;
  line_number: number;
  material_snapshot: string;
  quantity: number;
  unit_price: number;
  total_price: number;
}

/** 收货完成事件数据 */
export interface GRCompletedEventData extends BaseEventData {
  gr_id: number;
  gr_number: string;
  po_id: number;
  po_number: string;
  po_line_id: number;
  material_snapshot: string;
  ordered_qty: number;
  received_qty: number;
  cumulative_received_qty: number;
  pending_qty: number;
  is_fully_received: boolean;
  overdelivery_ratio?: number; // 超收比例
}

/** 收货超收事件数据 */
export interface GROverdeliveryEventData extends BaseEventData {
  gr_id: number;
  gr_number: string;
  po_id: number;
  po_number: string;
  po_line_id: number;
  material_snapshot: string;
  ordered_qty: number;
  received_qty: number;
  overdelivery_qty: number;
  overdelivery_ratio: number; // 超收比例 > 0.05
  gr_status: 'pending_approval' | 'approved' | 'rejected';
}

// ============ 事件订阅定义 ============

/** 角色类型 */
export type AgentRole = 'buyer' | 'manager' | 'requester' | 'supplier';

/** 订阅规则 */
export interface SubscriptionRule {
  event: EventType;
  role: AgentRole;
  description: string;
  action: string; // 订阅者应执行的动作描述
}

/**
 * 事件订阅规则表（基于需求文档）
 * 
 * Buyer 订阅：
 * - b (PR_APPROVED): 执行 PR 与 FA 匹配
 * - c (PR_FA_MATCHED): 创建 PO（基于 PR + FA）
 * - d (PR_FA_MATCH_FAILED): 创建寻源任务
 * - f (QUOTE_AWARDED): 创建 PO（基于 PR + 报价单）
 * - h (GR_COMPLETED): 推送收货信息
 * 
 * Manager 订阅：
 * - a (PR_SUBMITTED): 提示审批 PR
 * - i (GR_OVERDELIVERY): 执行超收审批
 */
export const SUBSCRIPTION_RULES: SubscriptionRule[] = [
  // Buyer 订阅
  {
    event: EventType.PR_APPROVED,
    role: 'buyer',
    description: 'PR 审批后执行 FA 匹配',
    action: 'execute_fa_matching',
  },
  {
    event: EventType.PR_FA_MATCHED,
    role: 'buyer',
    description: 'FA 匹配成功后创建 PO',
    action: 'create_po_from_fa',
  },
  {
    event: EventType.PR_FA_MATCH_FAILED,
    role: 'buyer',
    description: 'FA 匹配失败后创建寻源任务',
    action: 'create_sourcing_task',
  },
  {
    event: EventType.QUOTE_AWARDED,
    role: 'buyer',
    description: '报价单中标后创建 PO',
    action: 'create_po_from_quote',
  },
  {
    event: EventType.GR_COMPLETED,
    role: 'buyer',
    description: '收货完成后推送收货信息',
    action: 'push_gr_notification',
  },
  
  // Manager 订阅
  {
    event: EventType.PR_SUBMITTED,
    role: 'manager',
    description: 'PR 提交后提示审批',
    action: 'prompt_pr_approval',
  },
  {
    event: EventType.GR_OVERDELIVERY,
    role: 'manager',
    description: '收货超收后执行审批',
    action: 'approve_overdelivery',
  },
];

// ============ 事件联合类型 ============

export type EventData =
  | PRSubmittedEventData
  | PRApprovedEventData
  | PRFAMatchedEventData
  | PRFAMatchFailedEventData
  | SourcingTaskCreatedEventData
  | QuoteAwardedEventData
  | POCreatedEventData
  | GRCompletedEventData
  | GROverdeliveryEventData;

// ============ 事件接口 ============

export interface SystemEvent<T = EventData> {
  id: string;
  type: EventType;
  data: T;
  timestamp: string;
  source: string; // 事件来源（API 路由名称）
}
