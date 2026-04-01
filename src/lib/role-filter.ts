/**
 * 角色权限过滤工具 (§2.4)
 * 
 * Agent-first 模型：
 * - 每个 Agent 有唯一 agent_id 和固定 role
 * - 调用 API 时只需传 X-Actor: agent_id，无需每次传 X-Role
 * - 系统从 agent_bindings 表查询该 agent_id 对应的 role
 * - 未绑定的 Agent 一律降级为 requester，避免伪造高权限
 */

import { NextRequest } from 'next/server';
import { resolveRoleByAgentId, type Role } from '@/storage/database/agent-binding';

// 角色类型
export type UserRole = 'requester' | 'buyer' | 'manager';

const VALID_ROLES: UserRole[] = ['requester', 'buyer', 'manager'];

function emptyResult(query: any) {
  // 所有主表的 id 都是正整数，自增主键 < 0 可稳定返回空结果。
  return query.lt('id', 0);
}

/**
 * 获取用户身份与角色（Agent-first）
 * 
 * 1. 先从 agent_bindings 表查询 X-Actor 对应的 role（权威来源）
 * 2. 如果表中有记录，使用表中的角色（忽略 X-Role）
 * 3. 如果表中无记录，不信任显式传递的 X-Role，统一降级为 requester
 * 4. 默认 actor 为 web:requester
 */
export async function getUserIdentity(request: NextRequest): Promise<{ actor: string; role: UserRole }> {
  const actor = request.headers.get('X-Actor')?.trim() || 'web:requester';
  const explicitRole = request.headers.get('X-Role') as UserRole | null;

  // 优先从 agent_bindings 表查询（权威来源）
  const bindingRole = await resolveRoleByAgentId(actor);
  
  // 如果 agent_bindings 中有记录，使用表中的角色（不可被前端覆盖）
  if (bindingRole) {
    return { actor, role: bindingRole };
  }

  // 未注册 Agent 不信任 X-Role，统一降级为 requester。
  if (explicitRole && VALID_ROLES.includes(explicitRole)) {
    console.warn(`[Auth] Ignore unbound role header for actor=${actor}, requestedRole=${explicitRole}`);
  }

  return { actor, role: 'requester' };
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
 * 获取需求人可访问的 PR ID 列表
 */
export async function getRequesterAccessiblePRIds(client: any, actor: string): Promise<number[]> {
  const { data: prs } = await client
    .from('purchase_requests')
    .select('id')
    .eq('applicant', actor);

  if (!prs || prs.length === 0) return [];
  return prs.map((pr: any) => pr.id as number);
}

/**
 * 判断当前用户是否可访问指定 PR
 */
export async function canAccessPurchaseRequest(
  client: any,
  role: Role,
  actor: string,
  requestId: number
): Promise<boolean> {
  if (role !== 'requester') return true;

  const { data } = await client
    .from('purchase_requests')
    .select('id')
    .eq('id', requestId)
    .eq('applicant', actor)
    .limit(1);

  return !!data && data.length > 0;
}

/**
 * 判断当前用户是否可访问指定 PO
 */
export async function canAccessPurchaseOrder(
  client: any,
  role: Role,
  actor: string,
  poId: number
): Promise<boolean> {
  if (role !== 'requester') return true;

  const accessiblePOIds = await getRequesterAccessiblePOIds(client, actor);
  return accessiblePOIds.includes(poId);
}

/**
 * 判断当前用户是否可访问指定收货单
 */
export async function canAccessGoodsReceipt(
  client: any,
  role: Role,
  actor: string,
  goodsReceiptId: number
): Promise<boolean> {
  if (role !== 'requester') return true;

  const { data } = await client
    .from('goods_receipts')
    .select('id')
    .eq('id', goodsReceiptId)
    .eq('receiver', actor)
    .limit(1);

  return !!data && data.length > 0;
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
      // 需要异步查询可访问的 PO ID，路由层应使用 getRequesterAccessiblePOIds。
      return emptyResult(query);
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
      // 需求人可以看到自己 PR 关联的寻源任务
      return emptyResult(query); // 占位，下面动态设置
    case 'buyer':
      // 采购人可以看到所有
      return query;
    case 'manager':
      // 审批人可以看所有
      return query;
    default:
      return emptyResult(query);
  }
}

/**
 * 根据角色过滤报价单查询
 */
export function filterQuotes(query: any, role: Role, actor: string) {
  switch (role) {
    case 'requester':
      // 需求人不能看报价单
      return emptyResult(query);
    case 'buyer':
      // 采购人可以看到所有
      return query;
    case 'manager':
      // 审批人不能直接看报价单
      return emptyResult(query);
    default:
      return emptyResult(query);
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
      return emptyResult(query);
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
  return role === 'buyer';
}
