/**
 * Audit Logs Statistics API - 审计统计
 * 
 * GET /api/audit-logs/statistics - 获取审计统计
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { getUserIdentityWithLookup } from '@/lib/role-filter';

// GET /api/audit-logs/statistics - 获取审计统计
export async function GET(request: NextRequest) {
  try {
    // 权限检查：只有 Manager 可以查看统计
    const { role } = await getUserIdentityWithLookup(request);
    if (role !== 'manager') {
      return NextResponse.json({ error: '只有 Manager 可以查看审计统计' }, { status: 403 });
    }

    const client = getSupabaseClient();
    const searchParams = request.nextUrl.searchParams;
    const from = searchParams.get('from') || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const to = searchParams.get('to') || new Date().toISOString();

    // 按实体类型统计
    const { data: byEntityType, error: error1 } = await client
      .from('audit_logs')
      .select('entity_type, action')
      .gte('created_at', from)
      .lte('created_at', to);

    if (error1) {
      return NextResponse.json({ error: error1.message }, { status: 500 });
    }

    // 按操作类型统计
    const actionCounts = new Map<string, number>();
    const entityTypeCounts = new Map<string, number>();

    for (const log of byEntityType || []) {
      actionCounts.set(log.action, (actionCounts.get(log.action) || 0) + 1);
      entityTypeCounts.set(log.entity_type, (entityTypeCounts.get(log.entity_type) || 0) + 1);
    }

    // 按操作人统计
    const { data: byActor, error: error2 } = await client
      .from('audit_logs')
      .select('actor, actor_role')
      .gte('created_at', from)
      .lte('created_at', to);

    if (error2) {
      return NextResponse.json({ error: error2.message }, { status: 500 });
    }

    const actorCounts = new Map<string, { count: number; role: string }>();
    for (const log of byActor || []) {
      const current = actorCounts.get(log.actor) || { count: 0, role: log.actor_role };
      actorCounts.set(log.actor, {
        count: current.count + 1,
        role: current.role || log.actor_role,
      });
    }

    return NextResponse.json({
      data: {
        period: { from, to },
        byEntityType: Object.fromEntries(entityTypeCounts),
        byAction: Object.fromEntries(actionCounts),
        byActor: Object.fromEntries(
          Array.from(actorCounts.entries()).map(([actor, info]) => [
            actor,
            { count: info.count, role: info.role },
          ])
        ),
        total: byEntityType?.length || 0,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
