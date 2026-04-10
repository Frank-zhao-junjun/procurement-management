/**
 * Audit Logs API - 审计日志与变更历史查询
 * 
 * 支持：
 * - 审计日志查询
 * - 变更历史追踪
 * - 实体变更历史
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { getUserIdentityWithLookup, type Role } from '@/lib/role-filter';
import { z } from 'zod';

// ============ GET /api/audit-logs - 获取审计日志列表 ============

export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);
    const searchParams = request.nextUrl.searchParams;

    // 查询参数
    const entityType = searchParams.get('entityType');
    const entityId = searchParams.get('entityId');
    const filterActor = searchParams.get('actor');
    const action = searchParams.get('action');
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '50', 10);
    const offset = (page - 1) * pageSize;

    let query = client
      .from('audit_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (entityType) {
      query = query.eq('entity_type', entityType);
    }

    if (entityId) {
      query = query.eq('entity_id', parseInt(entityId, 10));
    }

    if (action) {
      query = query.eq('action', action);
    }

    if (from) {
      query = query.gte('created_at', from);
    }

    if (to) {
      query = query.lte('created_at', to);
    }

    // 按角色过滤：Manager 可看所有；其他角色只能看自己操作的
    if (role !== 'manager') {
      query = query.eq('actor', actor);
    } else if (filterActor) {
      query = query.eq('actor', filterActor);
    }

    const { data, error, count } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 转换字段名
    const logs = (data || []).map((log) => ({
      id: log.id,
      entityType: log.entity_type,
      entityId: log.entity_id,
      action: log.action,
      actor: log.actor,
      actorRole: log.actor_role,
      detail: log.detail,
      ipAddress: log.ip_address,
      userAgent: log.user_agent,
      createdAt: log.created_at,
    }));

    return NextResponse.json({
      data: logs,
      total: count || 0,
      page,
      pageSize,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ============ GET /api/audit-logs/entity/:type/:id - 获取实体变更历史 ============

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> }
) {
  try {
    const { type, id } = await params;
    const entityId = parseInt(id, 10);

    if (isNaN(entityId)) {
      return NextResponse.json({ error: '无效的实体 ID' }, { status: 400 });
    }

    // 权限检查
    const { role } = await getUserIdentityWithLookup(request);
    if (!role) {
      return NextResponse.json({ error: '未认证' }, { status: 401 });
    }

    const client = getSupabaseClient();

    // 查询该实体的所有变更记录
    const { data, error } = await client
      .from('audit_logs')
      .select('*')
      .eq('entity_type', type)
      .eq('entity_id', entityId)
      .order('created_at', { ascending: true }); // 按时间正序，便于看变更历史

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 分析变更详情
    const history = (data || []).map((log) => ({
      id: log.id,
      action: log.action,
      actor: log.actor,
      actorRole: log.actor_role,
      detail: log.detail,
      timestamp: log.created_at,
    }));

    // 生成变更摘要
    const summary = {
      entityType: type,
      entityId,
      totalChanges: history.length,
      firstChange: history.length > 0 ? history[0].timestamp : null,
      lastChange: history.length > 0 ? history[history.length - 1].timestamp : null,
      actors: [...new Set(history.map((h) => h.actor))],
      actions: [...new Set(history.map((h) => h.action))],
    };

    return NextResponse.json({
      data: {
        summary,
        history,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ============ GET /api/audit-logs/statistics - 获取审计统计 ============

export async function PUT(request: NextRequest) {
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
    const groupBy = searchParams.get('groupBy') || 'entity_type';

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

// ============ POST /api/audit-logs - 手动记录审计日志 ============

const CreateAuditLogSchema = z.object({
  entityType: z.string().min(1, '实体类型不能为空'),
  entityId: z.number().int().positive(),
  action: z.string().min(1, '操作类型不能为空'),
  detail: z.record(z.unknown()).optional(),
});

export async function POST(request: NextRequest) {
  try {
    // 权限检查
    const { actor, role } = await getUserIdentityWithLookup(request);
    if (!actor) {
      return NextResponse.json({ error: '未认证' }, { status: 401 });
    }

    const body = await request.json();

    // 验证请求体
    const validation = CreateAuditLogSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          error: '请求参数验证失败',
          details: validation.error.issues.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        },
        { status: 400 }
      );
    }

    const client = getSupabaseClient();

    const { error } = await client.from('audit_logs').insert({
      entity_type: validation.data.entityType,
      entity_id: validation.data.entityId,
      action: validation.data.action,
      actor,
      actor_role: role,
      detail: validation.data.detail,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
