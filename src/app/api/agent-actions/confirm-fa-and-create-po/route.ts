import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import {
  confirmFAAndCreatePO,
  createActionContext,
  getIdempotencyKey,
  runIdempotentAgentAction,
} from '@/lib/agent-actions';

// POST /api/agent-actions/confirm-fa-and-create-po
export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const body = await request.json();
    const prLineId = Number(body.prLineId ?? body.pr_line_id);
    const faId =
      body.faId == null && body.fa_id == null
        ? undefined
        : Number(body.faId ?? body.fa_id);

    if (!Number.isInteger(prLineId) || prLineId <= 0) {
      return NextResponse.json({ error: 'prLineId 必须为正整数' }, { status: 400 });
    }

    if (faId !== undefined && (!Number.isInteger(faId) || faId <= 0)) {
      return NextResponse.json({ error: 'faId 必须为正整数' }, { status: 400 });
    }

    const ctx = await createActionContext(client, request);
    const idempotencyKey = await getIdempotencyKey(request, body);
    const result = await runIdempotentAgentAction(
      client,
      {
        action: 'confirm-fa-and-create-po',
        actor: ctx.actor,
        idempotencyKey,
      },
      () =>
        confirmFAAndCreatePO(ctx, {
          prLineId,
          faId,
          confirmed: body.confirmed !== false,
          autoCreatePO: body.autoCreatePO !== false,
        }),
    );

    return NextResponse.json(result, { status: result.statusCode || 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status =
      message.includes('不存在') || message.includes('not found')
        ? 404
        : message.includes('只有')
          ? 403
          : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
