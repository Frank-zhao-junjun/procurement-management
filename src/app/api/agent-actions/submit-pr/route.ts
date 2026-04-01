import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import {
  createActionContext,
  getIdempotencyKey,
  runIdempotentAgentAction,
  submitPRAction,
} from '@/lib/agent-actions';

// POST /api/agent-actions/submit-pr
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const prId = Number(body.prId ?? body.pr_id ?? body.id);

    if (!Number.isInteger(prId) || prId <= 0) {
      return NextResponse.json({ error: 'prId 必须为正整数' }, { status: 400 });
    }

    const client = getSupabaseClient();
    const ctx = await createActionContext(client, request);
    const idempotencyKey = await getIdempotencyKey(request, body);

    const result = await runIdempotentAgentAction(
      client,
      {
        action: 'submit-pr',
        actor: ctx.actor,
        idempotencyKey,
      },
      () => submitPRAction(ctx, { prId }),
    );

    return NextResponse.json(result, { status: result.statusCode || 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status =
      message.includes('不存在') || message.includes('not found')
        ? 404
        : message.includes('不能') || message.includes('必须')
          ? 400
          : message.includes('只有')
            ? 403
            : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
