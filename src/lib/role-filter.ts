/**
 * 角色权限过滤工具 (§2.4)
 * 规则：
 * - 需求人（requester）：只能看自己创建的 PR
 * - 采购人（buyer）：只能看自己创建的 PO/SC/Quotes
 * - 审批人（manager）：可以看所有需要审批的内容
 */

import { NextRequest } from 'next/server';

// 角色类型
export type Role = 'requester' | 'buyer' | 'manager';

// 获取用户身份
export function getUserIdentity(request: NextRequest): { actor: string; role: Role } {
  return {
    actor: request.headers.get('X-Actor') || 'anonymous',
    role: (request.headers.get('X-Role') as Role) || 'requester',
  };
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
