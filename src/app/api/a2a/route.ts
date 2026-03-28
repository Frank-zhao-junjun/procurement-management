import { NextRequest, NextResponse } from 'next/server';

// A2A Scheduler 配置（从环境变量读取）
const SCHEDULER_URL = process.env.A2A_SCHEDULER_URL || 'http://localhost:8000';

// GET /api/a2a/agents - 从 Scheduler 获取 Agent 列表
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const path = searchParams.get('path') || '/registry/agents';

    const response = await fetch(`${SCHEDULER_URL}${path}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json({ error: `Scheduler error: ${error}` }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    // 如果无法连接 Scheduler，返回友好提示
    if (error.name === 'TimeoutError' || error.code === 'ECONNREFUSED') {
      return NextResponse.json({
        error: 'A2A Scheduler 未连接',
        available: false,
      }, { status: 503 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/a2a/agents - 向 Scheduler 注册 Agent
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { path, data } = body;

    if (!path || !data) {
      return NextResponse.json({ error: 'path 和 data 为必填参数' }, { status: 400 });
    }

    const response = await fetch(`${SCHEDULER_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(10000),
    });

    const result = await response.json();
    
    if (!response.ok) {
      return NextResponse.json({ error: result.error || '注册失败' }, { status: response.status });
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
