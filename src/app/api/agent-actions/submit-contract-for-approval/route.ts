import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import {
  createActionContext,
  getIdempotencyKey,
  runIdempotentAgentAction,
  submitContractForApproval,
} from '@/lib/agent-actions';

// POST /api/agent-actions/submit-contract-for-approval
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const contractId = Number(body.contractId ?? body.contract_id ?? body.id);

    if (!Number.isInteger(contractId) || contractId <= 0) {
      return NextResponse.json({ error: 'contractId 必须为正整数' }, { status: 400 });
    }

    const client = getSupabaseClient();
    const ctx = await createActionContext(client, request);
    const idempotencyKey = await getIdempotencyKey(request, body);
    const result = await runIdempotentAgentAction(
      client,
      {
        action: 'submit-contract-for-approval',
        actor: ctx.actor,
        idempotencyKey,
      },
      () =>
        submitContractForApproval(ctx, {
          contractId,
        }),
    );

    return NextResponse.json(result, { status: result.statusCode });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status =
      message.includes('不存在') || message.includes('not found')
        ? 404
        : message.includes('status')
          ? 400
          : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
