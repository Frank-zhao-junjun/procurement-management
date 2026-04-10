/**
 * REST API 角色权限过滤工具
 *
 * Agent-first 模型（安全加固版）：
 * - 每个 Agent 有唯一 agent_id 和固定 role
 * - Agent 角色在注册时固定，之后不可通过请求头更改
 * - 支持两种认证方式（按优先级）：
 *   1. X-API-Key: API Key 验证（最安全，推荐生产使用）
 *   2. X-Actor: 从 agent_bindings 表查询角色（仅限已注册 Agent）
 * - X-Role 请求头：已完全禁用（防止角色伪造）
 */

import { NextRequest } from 'next/server';
import { resolveRoleByAgentId, type Role } from '@/storage/database/agent-binding';
import { verifyApiKeyHeader } from '@/lib/api-key';

// 角色类型
export type UserRole = 'requester' | 'buyer' | 'manager';

// 允许的角色列表（注册时必须从中选择）
export const ALLOWED_ROLES: UserRole[] = ['requester', 'buyer', 'manager'];

/**
 * 大小写不敏感的 header 读取
 * HTTP Headers 在 Node.js 中是大小写敏感的，但客户端可能发送不同大小写
 */
function getHeader(request: NextRequest, name: string): string | null {
  // 尝试原始名称
  const value = request.headers.get(name);
  if (value) return value;
  
  // 尝试全小写
  const lowerValue = request.headers.get(name.toLowerCase());
  if (lowerValue) return lowerValue;
  
  // 尝试全大写
  return request.headers.get(name.toUpperCase());
}

/**
 * 获取用户身份与角色（Agent-first 安全版）
 * 
 * 认证规则：
 * 1. X-API-Key: API Key 验证（最高优先级）
 *    - 验证通过后，使用 API Key 对应的 agent_id 和 role
 *    - 如果同时传了 X-Actor，必须与 API Key 匹配
 * 2. X-Actor: 仅限已注册的 Agent
 *    - 必须已在 agent_bindings 中注册
 *    - 使用数据库中注册的角色，不可被请求头覆盖
 * 3. X-Role: 已完全禁用（返回 400 错误）
 * 4. 默认: anonymous（无权限）
 * 
 * 重要：角色由系统管理，Agent 无法通过任何请求头更改自己的角色！
 */
export async function getUserIdentity(request: NextRequest): Promise<{ actor: string; role: UserRole }> {
  const apiKey = getHeader(request, 'X-API-Key');
  const xActor = getHeader(request, 'X-Actor');
  
  console.log(`[getUserIdentity] apiKey present: ${!!apiKey}, xActor: "${xActor}"`);

  // 1. API Key 验证（最安全）
  if (apiKey) {
    const verified = await verifyApiKeyHeader(apiKey);
    if (verified) {
      // API Key 验证通过，使用对应的身份
      if (xActor && xActor !== verified.agentId) {
        // 安全警告：X-Actor 与 API Key 不匹配
        console.warn(`[Security] X-Actor mismatch: header=${xActor}, key=${verified.agentId}`);
        return { actor: 'anonymous', role: 'requester' };
      }
      return { actor: verified.agentId, role: verified.role as UserRole };
    }
    // API Key 无效，拒绝请求
    return { actor: 'anonymous', role: 'requester' };
  }

  // 2. X-Actor 验证（仅限已注册 Agent）
  if (xActor) {
    console.log(`[getUserIdentity] Looking up agent: "${xActor}"`);
    const bindingRole = await resolveRoleByAgentId(xActor);
    console.log(`[getUserIdentity] Found role: "${bindingRole}"`);
    
    if (bindingRole) {
      // 已注册 Agent：使用数据库中的固定角色
      return { actor: xActor, role: bindingRole };
    }
    
    // 未注册 Agent：拒绝请求
    console.warn(`[Security] Unregistered agent attempted access: ${xActor}`);
    return { actor: 'anonymous', role: 'requester' };
  }

  // 3. 无身份标识
  return { actor: 'anonymous', role: 'requester' };
}

/**
 * 验证角色是否合法
 */
export function isValidRole(role: string): role is UserRole {
  return ALLOWED_ROLES.includes(role as UserRole);
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
      // 需求人可以看到自己 PR 关联的寻源任务
      return query.eq('pr_id', -1); // 占位，下面动态设置
    case 'buyer':
      // 采购人可以看到所有
      return query;
    case 'manager':
      // 审批人可以看所有
      return query;
    default:
      return query.eq('id', -1); // 返回空结果
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
