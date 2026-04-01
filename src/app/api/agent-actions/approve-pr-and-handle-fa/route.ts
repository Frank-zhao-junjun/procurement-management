import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import {
  createActionContext,
  approvePRAndHandleFA,
  getIdempotencyKey,
  runIdempotentAgentAction,
} from '@/lib/agent-actions';

// POST /api/agent-actions/approve-pr-and-handle-fa
export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const body = await request.json();
    const prId = Number(body.prId ?? body.pr_id);

    if (!Number.isInteger(prId) || prId <= 0) {
      return NextResponse.json({ error: 'prId 必须为正整数' }, { status: 400 });
    }

    const ctx = await createActionContext(client, request);
    const idempotencyKey = await getIdempotencyKey(request, body);
    const result = await runIdempotentAgentAction(
      client,
      {
        action: 'approve-pr-and-handle-fa',
        actor: ctx.actor,
        idempotencyKey,
      },
      () =>
        approvePRAndHandleFA(ctx, {
          prId,
          approved: body.approved,
          note: body.note,
        }),
    );

    return NextResponse.json(result, { status: result.statusCode || 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message.includes('只有 Manager') ? 403 : message.includes('not found') ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
