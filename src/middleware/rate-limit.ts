/**
 * Rate Limit 中间件
 * 
 * 为所有 API 路由添加限流保护
 */

import { NextRequest, NextResponse } from 'next/server';
import { 
  checkRequestRateLimit, 
  createRateLimitResponse,
  getRateLimitHeaders,
} from '@/lib/rate-limit';

// 需要排除的路径（健康检查等）
const EXCLUDED_PATHS = ['/api/health', '/_next', '/favicon.ico'];

/**
 * 检查请求是否应该被限流
 */
export function isRateLimited(request: NextRequest): boolean {
  const path = request.nextUrl.pathname;
  
  // 排除不需要限流的路径
  for (const excluded of EXCLUDED_PATHS) {
    if (path.startsWith(excluded)) {
      return false;
    }
  }
  
  // 仅对 /api/* 路径限流
  return path.startsWith('/api');
}

/**
 * Rate Limit 中间件处理器
 */
export function rateLimitMiddleware(
  request: NextRequest,
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  if (!isRateLimited(request)) {
    return handler();
  }

  const result = checkRequestRateLimit(request);
  
  if (!result.allowed) {
    console.warn(`[RateLimit] Rate limit exceeded: ${request.nextUrl.pathname}`);
    return Promise.resolve(createRateLimitResponse(result));
  }

  // 执行请求
  return handler().then(response => {
    // 添加 Rate Limit Headers
    const headers = getRateLimitHeaders(result);
    for (const [key, value] of Object.entries(headers)) {
      response.headers.set(key, value);
    }
    return response;
  });
}
