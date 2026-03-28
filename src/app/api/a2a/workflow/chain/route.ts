import { NextRequest, NextResponse } from 'next/server';

const SCHEDULER_URL = process.env.A2A_SCHEDULER_URL || 'http://localhost:8000';

// POST /api/a2a/workflow/chain - 链式执行
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agents, input } = body;

    if (!agents || !Array.isArray(agents) || agents.length < 2) {
      return NextResponse.json({ error: 'agents 至少需要 2 个' }, { status: 400 });
    }

    const response = await fetch(`${SCHEDULER_URL}/workflow/chain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agents,
        input: input || {},
      }),
      signal: AbortSignal.timeout(60000), // 工作流可能需要更长时间
    });

    const result = await response.json();
    
    if (!response.ok) {
      return NextResponse.json({ error: result.error || '工作流执行失败' }, { status: response.status });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    if (error.name === 'TimeoutError' || error.code === 'ECONNREFUSED') {
      return NextResponse.json({
        error: 'A2A Scheduler 未连接',
        available: false,
      }, { status: 503 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
