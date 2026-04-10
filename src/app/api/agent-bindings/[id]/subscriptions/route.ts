/**
 * Agent Subscriptions API - 订阅管理接口
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { getUserIdentityWithLookup } from '@/lib/role-filter';
import { getEventSubscriber } from '@/events/subscriber';
import { isValidEventType, type EventType } from '@/events/types';
import { z } from 'zod';

// ============ GET /api/agent-bindings/:id/subscriptions - 获取订阅列表 ============

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const bindingId = parseInt(id, 10);

    if (isNaN(bindingId)) {
      return NextResponse.json({ error: '无效的绑定 ID' }, { status: 400 });
    }

    const subscriber = getEventSubscriber();
    const result = await subscriber.getSubscriptions(bindingId);

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({
      data: result.subscriptions,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ============ PUT /api/agent-bindings/:id/subscriptions - 更新订阅 ============

const UpdateSubscriptionsSchema = z.object({
  subscriptions: z.array(z.string()).min(1, '订阅列表不能为空'),
  webhookUrl: z.string().url().optional().or(z.literal('')),
});

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const bindingId = parseInt(id, 10);

    if (isNaN(bindingId)) {
      return NextResponse.json({ error: '无效的绑定 ID' }, { status: 400 });
    }

    // 权限检查：只能修改自己的订阅
    const { actor, role } = await getUserIdentityWithLookup(request);
    if (!actor) {
      return NextResponse.json({ error: '未认证' }, { status: 401 });
    }

    const body = await request.json();

    // 验证请求体
    const validation = UpdateSubscriptionsSchema.safeParse(body);
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
    for (const type of validation.data.subscriptions) {
      if (!isValidEventType(type)) {
        return NextResponse.json(
          { error: `无效的事件类型: ${type}` },
          { status: 400 }
        );
      }
    }

    const subscriber = getEventSubscriber();

    // 先获取当前订阅
    const current = await subscriber.getSubscriptions(bindingId);
    if (current.error) {
      return NextResponse.json({ error: current.error }, { status: 500 });
    }

    const currentTypes = new Set(current.subscriptions.map((s) => s.eventType));
    const newTypes = new Set(validation.data.subscriptions);

    // 计算需要添加和删除的订阅
    const toAdd: EventType[] = [];
    const toRemove: EventType[] = [];

    for (const type of validation.data.subscriptions) {
      if (!currentTypes.has(type)) {
        toAdd.push(type as EventType);
      }
    }

    for (const type of current.subscriptions) {
      if (!newTypes.has(type.eventType)) {
        toRemove.push(type.eventType as EventType);
      }
    }

    // 执行订阅变更
    if (toAdd.length > 0) {
      const result = await subscriber.subscribe(
        bindingId,
        toAdd,
        validation.data.webhookUrl || undefined
      );
      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }
    }

    if (toRemove.length > 0) {
      const result = await subscriber.unsubscribe(bindingId, toRemove);
      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }
    }

    // 更新 Webhook URL
    if (validation.data.webhookUrl) {
      await subscriber.updateWebhookUrl(bindingId, validation.data.webhookUrl);
    }

    // 获取更新后的订阅列表
    const updated = await subscriber.getSubscriptions(bindingId);

    return NextResponse.json({
      success: true,
      data: updated.subscriptions,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ============ POST /api/agent-bindings/:id/subscriptions/defaults - 设置默认订阅 ============

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const bindingId = parseInt(id, 10);

    if (isNaN(bindingId)) {
      return NextResponse.json({ error: '无效的绑定 ID' }, { status: 400 });
    }

    // 权限检查
    const { actor } = await getUserIdentityWithLookup(request);
    if (!actor) {
      return NextResponse.json({ error: '未认证' }, { status: 401 });
    }

    // 获取 Agent 绑定信息（获取角色）
    const client = getSupabaseClient();
    const { data: binding, error: bindingError } = await client
      .from('agent_bindings')
      .select('role')
      .eq('id', bindingId)
      .single();

    if (bindingError || !binding) {
      return NextResponse.json({ error: '绑定不存在' }, { status: 404 });
    }

    const subscriber = getEventSubscriber();
    const result = await subscriber.setDefaultSubscriptions(
      bindingId,
      binding.role as 'buyer' | 'manager' | 'requester'
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    // 获取更新后的订阅列表
    const subscriptions = await subscriber.getSubscriptions(bindingId);

    return NextResponse.json({
      success: true,
      data: subscriptions.subscriptions,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
