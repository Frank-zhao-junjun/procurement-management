import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import {
  createActionContext,
  getIdempotencyKey,
  receiveGoodsAndHandleOverdelivery,
  runIdempotentAgentAction,
} from '@/lib/agent-actions';

// POST /api/agent-actions/receive-goods-and-handle-overdelivery
export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const body = await request.json();
    const poLineId = Number(body.poLineId ?? body.po_line_id);
    const quantity = Number(body.quantity);

    if (!Number.isInteger(poLineId) || poLineId <= 0) {
      return NextResponse.json({ error: 'poLineId 必须为正整数' }, { status: 400 });
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      return NextResponse.json({ error: 'quantity 必须为正数' }, { status: 400 });
    }

    const ctx = await createActionContext(client, request);
    const idempotencyKey = await getIdempotencyKey(request, body);
    const result = await runIdempotentAgentAction(
      client,
      {
        action: 'receive-goods-and-handle-overdelivery',
        actor: ctx.actor,
        idempotencyKey,
      },
      () =>
        receiveGoodsAndHandleOverdelivery(ctx, {
          poLineId,
          quantity,
          poId: body.poId ?? body.po_id,
          grType: body.grType ?? body.gr_type,
          receiptDate: body.receiptDate ?? body.receipt_date,
          notes: body.notes,
          autoApproveOverdelivery: body.autoApproveOverdelivery === true,
          overdeliveryApproval:
            body.overdeliveryApproval == null ? undefined : body.overdeliveryApproval !== false,
          approvalNote: body.approvalNote ?? body.approval_note,
        }),
    );

    return NextResponse.json(result, { status: result.statusCode });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status =
      message.includes('不存在') || message.includes('not found')
        ? 404
        : message.includes('只有')
          ? 403
          : message.includes('必须') || message.includes('无效')
            ? 400
            : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
