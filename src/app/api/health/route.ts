/**
 * 健康检查端点
 * 
 * 提供系统健康状态检查，用于：
 * - K8s 存活探针 (liveness)
 * - K8s 就绪探针 (readiness)
 * - 负载均衡器健康检查
 * - 监控告警
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient } from '@/storage/database/supabase-client';

/**
 * GET /api/health
 * 
 * 综合健康检查（readiness 探针）
 * 检查所有依赖服务是否可用
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  // 检查模式
  const mode = request.nextUrl.searchParams.get('mode') || 'full';
  
  const health: {
    status: string;
    timestamp: string;
    uptime: number;
    version: string;
    checks: Record<string, { status: string; latency?: number; error?: string }>;
    totalLatency?: number;
    memory?: Record<string, string>;
  } = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0',
    checks: {},
  };

  let isHealthy = true;

  // 1. 检查数据库连接
  try {
    const dbStart = Date.now();
    const client = getServiceRoleClient();
    const { error } = await client.from('materials').select('id').limit(1);
    health.checks.database = {
      status: error ? 'error' : 'ok',
      latency: Date.now() - dbStart,
      error: error?.message,
    };
    if (error) isHealthy = false;
  } catch (e) {
    health.checks.database = {
      status: 'error',
      error: (e as Error).message,
    };
    isHealthy = false;
  }

  // 2. 检查环境变量
  const envChecks = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  const envStatus: Record<string, boolean> = {};
  for (const key of envChecks) {
    envStatus[key] = !!process.env[key];
  }
  health.checks.environment = {
    status: envStatus.SUPABASE_URL && envStatus.SUPABASE_SERVICE_ROLE_KEY ? 'ok' : 'error',
  };
  if (!envStatus.SUPABASE_URL || !envStatus.SUPABASE_SERVICE_ROLE_KEY) {
    isHealthy = false;
  }

  // 3. 内存使用情况（仅 full 模式）
  if (mode === 'full') {
    const memUsage = process.memoryUsage();
    // 使用 rss 作为参考（总内存使用）
    const heapUsageRatio = memUsage.heapUsed / memUsage.heapTotal;
    health.checks.memory = {
      status: heapUsageRatio > 0.9 ? 'warning' : 'ok',
    };
    health.memory = {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
      rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB',
    };
  }

  health.totalLatency = Date.now() - startTime;
  health.status = isHealthy ? 'ok' : 'degraded';

  const statusCode = isHealthy ? 200 : 503;
  return NextResponse.json(health, { status: statusCode });
}

/**
 * GET /api/health/live
 * 
 * 存活探针 (liveness)
 * 仅检查进程是否存活，不检查依赖
 */
export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}
