/**
 * 角色权限过滤工具 (§2.4)
 * 
 * Agent-first 模型：
 * - 每个 Agent 有唯一 agent_id 和固定 role
 * - 调用 API 时只需传 X-Actor: agent_id，无需每次传 X-Role
 * - 系统从 agent_bindings 表查询该 agent_id 对应的 role
 * - 显式传 X-Role 时优先使用
 */

import { NextRequest } from 'next/server';
import { resolveRoleByAgentId, type Role } from '@/storage/database/agent-binding';

// 角色类型
export type UserRole = 'requester' | 'buyer' | 'manager';

/**
 * 获取用户身份与角色（Agent-first）
 * 
 * 1. 先从 agent_bindings 表查询 X-Actor 对应的 role（权威来源）
 * 2. 如果表中有记录，使用表中的角色（忽略 X-Role）
 * 3. 如果表中无记录，使用显式传递的 X-Role
 * 4. 都未提供则默认 requester
 */
export async function getUserIdentity(request: NextRequest): Promise<{ actor: string; role: UserRole }> {
  const actor = request.headers.get('X-Actor') || 'anonymous';
  const explicitRole = request.headers.get('X-Role') as UserRole | null;

  // 优先从 agent_bindings 表查询（权威来源）
  const bindingRole = await resolveRoleByAgentId(actor);
  
  // 如果 agent_bindings 中有记录，使用表中的角色（不可被前端覆盖）
  if (bindingRole) {
    return { actor, role: bindingRole };
  }

  // 如果表中无记录，使用显式传递的角色
  let role = explicitRole;

  // 验证角色有效性
  if (!role || !['requester', 'buyer', 'manager'].includes(role)) {
    role = 'requester'; // 默认降级为 requester
  }

  return { actor, role };
}

// 向后兼容别名
export const getUserIdentityWithLookup = getUserIdentity;

// 保持向后兼容
export { type Role } from '@/storage/database/agent-binding';

/**
 * 获取需求人可访问的 PO ID 列表
 * 需求人只能看自己 PR 对应的 PO
 */
export async function getRequesterAccessiblePOIds(client: any, actor: string): Promise<number[]> {
  // 查询该需求人创建的 PR
  const { data: prs } = await client
    .from('purchase_requests')
    .select('id')
    .eq('applicant', actor);

  if (!prs || prs.length === 0) return [];

  const prIds = prs.map((pr: any) => pr.id);

  // 查询这些 PR 对应的 PO
  const { data: poLines } = await client
    .from('purchase_order_lines')
    .select('order_id')
    .in('pr_id', prIds);

  if (!poLines || poLines.length === 0) return [];

  // 去重
  const ids = poLines.map((line: any) => line.order_id as number);
  return Array.from(new Set(ids));
}

/**
 * 根据角色过滤采购申请查询
 */
export function filterPurchaseRequests(query: any, role: Role, actor: string) {
  switch (role) {
    case 'requester':
      // 需求人只能看自己创建的
      return query.eq('applicant', actor);
    case 'buyer':
      // 采购人可以看到所有（他们负责处理）
      return query;
    case 'manager':
      // 审批人可以看所有
      return query;
    default:
      return query.eq('applicant', actor);
  }
}

/**
 * 根据角色过滤采购订单查询
 */
export function filterPurchaseOrders(query: any, role: Role, actor: string) {
  switch (role) {
    case 'requester':
      // 需求人可以看到自己 PR 对应的 PO
      return query;
    case 'buyer':
      // 采购人可以看到所有自己创建的
      return query;
    case 'manager':
      // 审批人可以看所有
      return query;
    default:
      return query;
  }
}

/**
 * 根据角色过滤寻源任务查询
 */
export function filterSourcingTasks(query: any, role: Role, actor: string) {
  switch (role) {
    case 'requester':
      // 需求人不能直接看寻源任务
      return query.eq('id', -1); // 返回空结果
    case 'buyer':
      // 采购人可以看到所有
      return query;
    case 'manager':
      // 审批人不能直接看寻源任务
      return query.eq('id', -1);
    default:
      return query.eq('id', -1);
  }
}

/**
 * 根据角色过滤报价单查询
 */
export function filterQuotes(query: any, role: Role, actor: string) {
  switch (role) {
    case 'requester':
      // 需求人不能看报价单
      return query.eq('id', -1);
    case 'buyer':
      // 采购人可以看到所有
      return query;
    case 'manager':
      // 审批人不能直接看报价单
      return query.eq('id', -1);
    default:
      return query.eq('id', -1);
  }
}

/**
 * 根据角色过滤框架协议查询
 */
export function filterFrameworkAgreements(query: any, role: Role, actor: string) {
  switch (role) {
    case 'requester':
      // 需求人可以看到所有（用于参考价格）
      return query;
    case 'buyer':
      // 采购人可以看到所有
      return query;
    case 'manager':
      // 审批人可以看到所有
      return query;
    default:
      return query;
  }
}

/**
 * 根据角色过滤收货单查询
 */
export function filterGoodsReceipts(query: any, role: Role, actor: string) {
  switch (role) {
    case 'requester':
      // 需求人可以看到自己收货的
      return query.eq('receiver', actor);
    case 'buyer':
      // 采购人可以看到所有
      return query;
    case 'manager':
      // 审批人可以看到待审批的超收
      return query;
    default:
      return query.eq('receiver', actor);
  }
}

/**
 * 根据角色过滤超收审批列表
 */
export function filterPendingApproval(query: any, role: Role) {
  switch (role) {
    case 'manager':
      // 只有 Manager 可以看到待审批
      return query;
    default:
      // 其他角色返回空
      return query.eq('id', -1);
  }
}

/**
 * 判断角色是否有审批权限
 */
export function canApprove(role: Role): boolean {
  return role === 'manager';
}

/**
 * 判断角色是否可以创建 PO
 */
export function canCreatePO(role: Role): boolean {
  return role === 'buyer' || role === 'manager';
}

/**
 * 判断角色是否可以收货
 */
export function canReceiveGoods(role: Role): boolean {
  return role === 'requester' || role === 'manager';
}
