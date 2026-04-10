/**
 * Rate Limiting 中间件
 * 
 * 基于内存的请求限流（生产环境建议使用 Redis）
 * 支持：
 * - 按 IP 限流
 * - 按 API Key 限流
 * - 可配置的限流策略
 */

import { NextRequest, NextResponse } from 'next/server';

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

// ============ 配置 ============

interface RateLimitConfig {
  windowMs: number;      // 时间窗口（毫秒）
  maxRequests: number;   // 最大请求数
}

const RATE_LIMIT_CONFIG: Record<string, RateLimitConfig> = {
  // 默认策略：100 请求/分钟
  default: { windowMs: 60 * 1000, maxRequests: 100 },
  
  // 认证接口：更严格的限制
  auth: { windowMs: 60 * 1000, maxRequests: 20 },
  
  // 写入操作：中等限制
  write: { windowMs: 60 * 1000, maxRequests: 50 },
  
  // 只读操作：较宽松
  read: { windowMs: 60 * 1000, maxRequests: 200 },
};

// ============ 内存存储 ============

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// 使用 Map 存储限流数据
// 生产环境应使用 Redis
const rateLimitStore = new Map<string, RateLimitEntry>();

// 定期清理过期数据（每分钟）
const CLEANUP_INTERVAL = 60 * 1000;
let lastCleanup = Date.now();

function cleanupExpiredEntries() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetTime < now) {
      rateLimitStore.delete(key);
    }
  }
  lastCleanup = now;
}

// ============ 限流逻辑 ============

/**
 * 生成限流标识符
 */
function getRateLimitKey(request: NextRequest): string {
  // 1. 优先使用 API Key（最准确）
  const apiKey = getHeader(request, 'X-API-Key');
  if (apiKey) {
    // 使用 API Key 的哈希作为标识
    const hash = hashString(apiKey);
    return `apikey:${hash}`;
  }

  // 2. 使用 X-Actor
  const actor = getHeader(request, 'X-Actor');
  if (actor) {
    return `actor:${actor}`;
  }

  // 3. 使用 IP 地址
  const forwarded = getHeader(request, 'x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim()
    || getHeader(request, 'x-real-ip')
    || 'unknown';
  return `ip:${ip}`;
}

/**
 * 简单哈希函数
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * 检查并更新限流
 */
function checkRateLimit(
  key: string,
  config: RateLimitConfig
): { allowed: boolean; remaining: number; resetTime: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  // 清理过期数据
  cleanupExpiredEntries();

  // 新请求或已过期
  if (!entry || entry.resetTime < now) {
    const resetTime = now + config.windowMs;
    rateLimitStore.set(key, { count: 1, resetTime });
    return { allowed: true, remaining: config.maxRequests - 1, resetTime };
  }

  // 已达到限制
  if (entry.count >= config.maxRequests) {
    return { allowed: false, remaining: 0, resetTime: entry.resetTime };
  }

  // 允许请求
  entry.count++;
  return { allowed: true, remaining: config.maxRequests - entry.count, resetTime: entry.resetTime };
}

/**
 * 获取限流策略
 */
function getRateLimitStrategy(request: NextRequest): RateLimitConfig {
  const path = request.nextUrl.pathname;
  
  // 认证接口
  if (path.includes('/api-key') || path.includes('/agent-bindings')) {
    return RATE_LIMIT_CONFIG.auth;
  }
  
  // 写入操作
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)) {
    return RATE_LIMIT_CONFIG.write;
  }
  
  // 读取操作
  if (request.method === 'GET') {
    return RATE_LIMIT_CONFIG.read;
  }
  
  return RATE_LIMIT_CONFIG.default;
}

// ============ 导出函数 ============

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetTime: Date;
}

/**
 * 执行限流检查
 */
export function checkRequestRateLimit(request: NextRequest): RateLimitResult {
  const key = getRateLimitKey(request);
  const config = getRateLimitStrategy(request);
  const result = checkRateLimit(key, config);

  return {
    allowed: result.allowed,
    remaining: result.remaining,
    limit: config.maxRequests,
    resetTime: new Date(result.resetTime),
  };
}

/**
 * 获取 Rate Limit Headers
 */
export function getRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': result.limit.toString(),
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': result.resetTime.toISOString(),
  };
}

/**
 * 创建 Rate Limit 响应（超限时调用）
 */
export function createRateLimitResponse(result: RateLimitResult): NextResponse {
  return NextResponse.json(
    {
      error: '请求过于频繁，请稍后再试',
      retryAfter: Math.ceil((result.resetTime.getTime() - Date.now()) / 1000),
    },
    {
      status: 429,
      headers: getRateLimitHeaders(result),
    }
  );
}
