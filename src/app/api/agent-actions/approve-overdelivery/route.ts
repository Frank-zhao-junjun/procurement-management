import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import {
  approveOverdelivery,
  createActionContext,
  getIdempotencyKey,
  runIdempotentAgentAction,
} from '@/lib/agent-actions';

// POST /api/agent-actions/approve-overdelivery
export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const body = await request.json();
    const goodsReceiptId = Number(body.goodsReceiptId ?? body.goods_receipt_id ?? body.grId ?? body.gr_id);

    if (!Number.isInteger(goodsReceiptId) || goodsReceiptId <= 0) {
      return NextResponse.json({ error: 'goodsReceiptId 必须为正整数' }, { status: 400 });
    }

    const ctx = await createActionContext(client, request);
    const idempotencyKey = await getIdempotencyKey(request, body);
    const result = await runIdempotentAgentAction(
      client,
      { action: 'approve-overdelivery', actor: ctx.actor, idempotencyKey },
      () =>
        approveOverdelivery(ctx, {
          goodsReceiptId,
          approved: body.approved !== false,
          note: body.note,
        }),
    );

    return NextResponse.json(result, { status: result.statusCode ?? 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status =
      message.includes('不存在') || message.includes('not found')
        ? 404
        : message.includes('只有')
          ? 403
          : message.includes('状态') || message.includes('status')
            ? 400
            : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
