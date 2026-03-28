import { NextRequest, NextResponse } from 'next/server';

const SCHEDULER_URL = process.env.A2A_SCHEDULER_URL || 'http://localhost:8000';

// POST /api/a2a/tasks/send - 发送任务到 Agent
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agent, skill, input } = body;

    if (!agent || !skill) {
      return NextResponse.json({ error: 'agent 和 skill 为必填参数' }, { status: 400 });
    }

    const response = await fetch(`${SCHEDULER_URL}/tasks/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent,
        skill,
        input: input || {},
      }),
      signal: AbortSignal.timeout(30000), // 任务可能需要更长时间
    });

    const result = await response.json();
    
    if (!response.ok) {
      return NextResponse.json({ error: result.error || '任务发送失败' }, { status: response.status });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    if (error.name === 'TimeoutError' || error.code === 'ECONNREFUSED') {
      return NextResponse.json({
        error: 'A2A Scheduler 未连接',
        hint: '请确保 A2A Scheduler 服务正在运行',
        available: false,
      }, { status: 503 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
