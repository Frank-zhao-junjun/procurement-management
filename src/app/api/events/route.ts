/**
 * Events API - 事件查询和发布接口
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient, getServiceRoleClient } from '@/storage/database';
import { getUserIdentityWithLookup } from '@/lib/role-filter';
import { publishEvent } from '@/events/publisher';
import { getEventSubscriber, subscribe, unsubscribe } from '@/events/subscriber';
import { isValidEventType, type EventType } from '@/events/types';
import { z } from 'zod';

// ============ GET /api/events - 查询事件 ============

export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const searchParams = request.nextUrl.searchParams;

    // 查询参数
    const eventType = searchParams.get('type');
    const correlationId = searchParams.get('correlationId');
    const source = searchParams.get('source');
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
    const offset = (page - 1) * pageSize;

    let query = client
      .from('events')
      .select('*', { count: 'exact' })
      .order('timestamp', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (eventType) {
      query = query.eq('event_type', eventType);
    }

    if (correlationId) {
      query = query.eq('correlation_id', correlationId);
    }

    if (source) {
      query = query.eq('source', source);
    }

    if (from) {
      query = query.gte('timestamp', from);
    }

    if (to) {
      query = query.lte('timestamp', to);
    }

    const { data, error, count } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 转换字段名（camelCase）
    const events = (data || []).map((e) => ({
      id: e.id,
      type: e.event_type,
      version: e.version,
      timestamp: e.timestamp,
      source: e.source,
      correlationId: e.correlation_id,
      causedBy: e.caused_by,
      data: e.data,
      routing: e.routing,
      metadata: e.metadata,
    }));

    return NextResponse.json({
      data: events,
      total: count || 0,
      page,
      pageSize,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ============ POST /api/events - 发布事件 ============

const PublishEventSchema = z.object({
  type: z.string().min(1, '事件类型不能为空'),
  data: z.record(z.unknown()),
  routing: z
    .object({
      targetRoles: z.array(z.enum(['buyer', 'manager', 'requester'])).optional(),
      targetAgentIds: z.array(z.string()).optional(),
      broadcast: z.boolean().optional(),
    })
    .optional(),
  metadata: z
    .object({
      priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
      retryable: z.boolean().optional(),
      ttl: z.number().optional(),
    })
    .optional(),
  correlationId: z.string().optional(),
  causedBy: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    // 权限检查：只有已注册的 Agent 可以发布事件
    const { actor } = await getUserIdentityWithLookup(request);
    if (!actor) {
      return NextResponse.json({ error: '未认证' }, { status: 401 });
    }

    const body = await request.json();

    // 验证请求体
    const validation = PublishEventSchema.safeParse(body);
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

    // 验证事件类型
    if (!isValidEventType(validation.data.type)) {
      return NextResponse.json(
        { error: `无效的事件类型: ${validation.data.type}` },
        { status: 400 }
      );
    }

    // 发布事件
    const result = await publishEvent({
      type: validation.data.type as EventType,
      data: validation.data.data,
      routing: validation.data.routing,
      metadata: validation.data.metadata,
      correlationId: validation.data.correlationId,
      causedBy: validation.data.causedBy || actor,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      eventId: result.eventId,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ============ GET /api/events/:id - 查询单个事件 ============

export async function PATCH(request: NextRequest) {
  try {
    // 解析路径获取事件 ID
    const url = request.nextUrl.pathname;
    const eventId = url.split('/').pop();

    if (!eventId) {
      return NextResponse.json({ error: '事件 ID 不能为空' }, { status: 400 });
    }

    const client = getSupabaseClient();
    const { data, error } = await client
      .from('events')
      .select('*')
      .eq('id', eventId)
      .single();

    if (error) {
      return NextResponse.json({ error: '事件不存在' }, { status: 404 });
    }

    // 转换字段名
    const event = {
      id: data.id,
      type: data.event_type,
      version: data.version,
      timestamp: data.timestamp,
      source: data.source,
      correlationId: data.correlation_id,
      causedBy: data.caused_by,
      data: data.data,
      routing: data.routing,
      metadata: data.metadata,
    };

    return NextResponse.json({ data: event });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
