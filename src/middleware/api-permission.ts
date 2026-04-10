/**
 * REST API 权限控制中间件
 * 
 * 基于细粒度权限配置，对 REST API 进行权限检查
 */

import { NextRequest, NextResponse } from 'next/server';
import type { Role } from '@/storage/database/agent-binding';
import { checkApiPermission } from '@/lib/permissions';
import { getByAgentId } from '@/storage/database/agent-binding';
import { getApiKeyRole } from '@/lib/api-key';

/**
 * 大小写不敏感的 header 读取
 */
function getHeader(request: NextRequest, name: string): string | null {
  const value = request.headers.get(name);
  if (value) return value;
  const lowerValue = request.headers.get(name.toLowerCase());
  if (lowerValue) return lowerValue;
  return request.headers.get(name.toUpperCase());
}

// ============ 权限检查入口 ============

/**
 * 检查请求是否有权限
 */
export async function checkRequestPermission(
  request: NextRequest
): Promise<{
  allowed: boolean;
  error?: string;
  role?: Role;
  agentId?: string;
}> {
  // 1. 尝试 API Key 认证
  const apiKey = getHeader(request, 'X-API-Key') || request.headers.get('Authorization')?.replace('Bearer ', '');
  if (apiKey) {
    const apiKeyInfo = await getApiKeyRole(apiKey);
    if (apiKeyInfo) {
      const method = request.method;
      const path = request.nextUrl.pathname;
      const check = checkApiPermission(apiKeyInfo.role, method, path);
      return {
        allowed: check.allowed,
        error: check.error,
        role: apiKeyInfo.role,
        agentId: apiKeyInfo.agentId,
      };
    }
    return { allowed: false, error: '无效的 API Key' };
  }

  // 2. 尝试 X-Actor 认证
  const actor = getHeader(request, 'X-Actor');
  if (actor) {
    const binding = await getByAgentId(actor);
    if (!binding) {
      return { allowed: false, error: `Agent ${actor} 未注册` };
    }

    const method = request.method;
    const path = request.nextUrl.pathname;
    const check = checkApiPermission(binding.role, method, path);
    return {
      allowed: check.allowed,
      error: check.error,
      role: binding.role,
      agentId: binding.agent_id,
    };
  }

  // 3. 未认证
  return { allowed: false, error: '缺少认证信息（X-API-Key 或 X-Actor）' };
}

// ============ 权限检查辅助函数 ============

/**
 * 生成权限不足的响应
 */
export function forbiddenResponse(error: string) {
  return NextResponse.json(
    { error: '权限不足', detail: error },
    { status: 403 }
  );
}

/**
 * 生成未认证的响应
 */
export function unauthorizedResponse(error: string) {
  return NextResponse.json(
    { error: '未认证', detail: error },
    { status: 401 }
  );
}

/**
 * 为 API Route 包装权限检查
 */
export function withPermission(
  handler: (
    req: NextRequest,
    context: { role: Role; agentId: string }
  ) => Promise<NextResponse>,
  options?: {
    // 指定需要的资源权限
    resource?: string;
    action?: string;
  }
) {
  return async (request: NextRequest) => {
    const check = await checkRequestPermission(request);

    if (!check.allowed) {
      if (check.error?.includes('未注册')) {
        return unauthorizedResponse(check.error);
      }
      return forbiddenResponse(check.error || '权限不足');
    }

    return handler(request, {
      role: check.role!,
      agentId: check.agentId!,
    });
  };
}

// ============ 特定资源的权限检查 ============

/**
 * 检查是否有物料写入权限（只有 requester 和 manager 可以创建物料）
 */
export function canCreateMaterial(role: Role): boolean {
  return role === 'requester' || role === 'manager';
}

/**
 * 检查是否有供应商写入权限（只有 buyer 可以创建供应商）
 */
export function canCreateSupplier(role: Role): boolean {
  return role === 'buyer';
}

/**
 * 检查是否有采购申请写入权限
 * - requester: 可以创建、提交
 * - buyer: 只读
 * - manager: 只读
 */
export function canCreatePurchaseRequest(role: Role): boolean {
  return role === 'requester';
}

/**
 * 检查是否可以审批采购申请
 * - manager: 可以审批
 */
export function canApprovePurchaseRequest(role: Role): boolean {
  return role === 'manager';
}

/**
 * 检查是否可以创建采购订单
 * - buyer: 可以创建
 */
export function canCreatePurchaseOrder(role: Role): boolean {
  return role === 'buyer';
}

/**
 * 检查是否可以创建报价单
 * - buyer: 可以创建
 */
export function canCreateQuote(role: Role): boolean {
  return role === 'buyer';
}

/**
 * 检查是否可以创建收货单
 * - buyer: 可以创建
 * - requester: 可以创建
 */
export function canCreateGoodsReceipt(role: Role): boolean {
  return role === 'buyer' || role === 'requester';
}

/**
 * 检查是否可以审批超收
 * - manager: 可以审批
 */
export function canApproveOverdelivery(role: Role): boolean {
  return role === 'manager';
}

/**
 * 检查是否可以访问待审批收货列表
 * - manager: 可以访问
 */
export function canViewPendingApproval(role: Role): boolean {
  return role === 'manager';
}
