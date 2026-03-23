import { NextRequest, NextResponse } from 'next/server';
import {
  registerAgent,
  createOrUpdateAgent,
  getByAgentId,
  getByFeishuUserId,
  getByRole,
  getAllActive,
  type Role,
} from '@/storage/database/agent-binding';

// GET /api/agent-bindings
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const agentId = searchParams.get('agentId');
    const feishuUserId = searchParams.get('feishuUserId');
    const role = searchParams.get('role') as Role | null;

    if (agentId) {
      const binding = await getByAgentId(agentId);
      return NextResponse.json({ data: binding });
    }

    if (feishuUserId) {
      const binding = await getByFeishuUserId(feishuUserId);
      return NextResponse.json({ data: binding });
    }

    if (role && ['requester', 'manager', 'buyer'].includes(role)) {
      const bindings = await getByRole(role);
      return NextResponse.json({ data: bindings });
    }

    const bindings = await getAllActive();
    return NextResponse.json({ data: bindings });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/agent-bindings - 注册 Agent 或创建绑定
// Body: { agentId, role, feishuUserId?, feishuOpenId?, feishuUnionId?, feishuAppId? }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentId, role, feishuUserId, feishuOpenId, feishuUnionId, feishuAppId } = body;

    if (!agentId || !role) {
      return NextResponse.json(
        { error: 'agentId 和 role 为必填' },
        { status: 400 }
      );
    }

    if (!['requester', 'manager', 'buyer'].includes(role)) {
      return NextResponse.json(
        { error: 'role 必须为 requester、manager 或 buyer' },
        { status: 400 }
      );
    }

    const result = feishuUserId
      ? await createOrUpdateAgent(agentId, role, {
          feishuUserId,
          feishuOpenId,
          feishuUnionId,
          feishuAppId,
        })
      : await registerAgent(agentId, role);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(
      { success: true, bindingId: result.bindingId },
      { status: 201 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
