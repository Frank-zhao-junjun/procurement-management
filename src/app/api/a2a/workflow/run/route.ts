import { NextRequest, NextResponse } from 'next/server';

const SCHEDULER_URL = process.env.A2A_SCHEDULER_URL || 'http://localhost:8000';

// POST /api/a2a/workflow/run - 自定义工作流执行
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { steps, context } = body;

    if (!steps || !Array.isArray(steps) || steps.length === 0) {
      return NextResponse.json({ error: 'steps 至少需要 1 个步骤' }, { status: 400 });
    }

    const response = await fetch(`${SCHEDULER_URL}/workflow/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        steps,
        context: context || {},
      }),
      signal: AbortSignal.timeout(120000), // 自定义工作流可能需要更长时间
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
