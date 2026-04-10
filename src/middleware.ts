/**
 * Next.js Middleware
 * 
 * 全局请求拦截，处理：
 * - Rate Limiting
 * - 安全头
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkRequestRateLimit, getRateLimitHeaders } from '@/lib/rate-limit';

// 需要排除的路径
const EXCLUDED_PATHS = ['/api/health', '/_next', '/favicon.ico', '/robots.txt'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 仅对 /api/* 路径限流
  if (pathname.startsWith('/api') && !EXCLUDED_PATHS.some(p => pathname.startsWith(p))) {
    const result = checkRequestRateLimit(request);

    if (!result.allowed) {
      console.warn(`[RateLimit] Rate limit exceeded: ${pathname}`);
      return NextResponse.json(
        {
          error: '请求过于频繁，请稍后再试',
          retryAfter: Math.ceil((result.resetTime.getTime() - Date.now()) / 1000),
        },
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            ...getRateLimitHeaders(result),
          },
        }
      );
    }

    // 添加 Rate Limit Headers 到响应
    // 注意：这里无法直接修改响应，需要在 handler 中处理
  }

  // 添加安全响应头
  const response = NextResponse.next();
  
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  return response;
}

export const config = {
  matcher: [
    /*
     * 匹配所有路径，排除：
     * - _next/static (静态文件)
     * - _next/image (图片优化)
     * - favicon.ico (图标)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
