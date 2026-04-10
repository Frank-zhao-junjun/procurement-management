/**
 * Audit Logs API - 审计日志查询
 * 
 * 支持：审计日志列表查询、手动记录审计日志
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { getUserIdentityWithLookup } from '@/lib/role-filter';
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

// ============ POST /api/audit-logs - 手动记录审计日志 ============

const CreateAuditLogSchema = z.object({
  entityType: z.string().min(1, '实体类型不能为空'),
  entityId: z.number().int().positive(),
  action: z.string().min(1, '操作类型不能为空'),
  detail: z.record(z.string(), z.unknown()).optional(),
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
