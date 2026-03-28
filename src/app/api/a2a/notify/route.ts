import { NextRequest, NextResponse } from 'next/server';

const SCHEDULER_URL = process.env.A2A_SCHEDULER_URL || 'http://localhost:8000';

/**
 * POST /api/a2a/notify - Agent 间通知
 * 
 * 请求体:
 * {
 *   "from": "system",           // 发送者（可选，默认 system）
 *   "to": "manager-agent",      // 接收者 Agent 名称
 *   "message": "PR submitted",  // 通知内容
 *   "priority": "high"           // 优先级（可选）
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { from, to, message, priority } = body;

    if (!to || !message) {
      return NextResponse.json({ error: 'to and message are required' }, { status: 400 });
    }

    const response = await fetch(`${SCHEDULER_URL}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, message, priority }),
      signal: AbortSignal.timeout(10000),
    });

    const result = await response.json();
    
    if (!response.ok) {
      return NextResponse.json({ error: result.error || 'Notification failed' }, { status: response.status });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    if (error.name === 'TimeoutError' || error.code === 'ECONNREFUSED') {
      return NextResponse.json({ error: 'A2A Scheduler 未连接', available: false }, { status: 503 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/a2a/broadcast - 广播消息给所有 Agent
 * 
 * 请求体:
 * {
 *   "from": "system",
 *   "message": "System maintenance",
 *   "role": "manager"  // 可选，筛选特定角色的 Agent
 * }
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { from, message, role } = body;

    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    const response = await fetch(`${SCHEDULER_URL}/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, message, role }),
      signal: AbortSignal.timeout(10000),
    });

    const result = await response.json();
    
    if (!response.ok) {
      return NextResponse.json({ error: result.error || 'Broadcast failed' }, { status: response.status });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    if (error.name === 'TimeoutError' || error.code === 'ECONNREFUSED') {
      return NextResponse.json({ error: 'A2A Scheduler 未连接', available: false }, { status: 503 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
