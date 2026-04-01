import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { createPOFromAwardedQuote } from '@/lib/agent-actions';
import { getUserIdentityWithLookup, type Role } from '@/lib/role-filter';

/**
 * POST /api/agent-actions/create-po-from-awarded-quote
 *
 * Agent-friendly high-level action:
 * - award quote
 * - auto create purchase order
 * - update sourcing task / PR line
 * - emit quote_awarded + po_created events
 */
export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);
    const body = await request.json();
    const quoteId = Number(body.quoteId ?? body.quote_id);

    if (!quoteId || Number.isNaN(quoteId)) {
      return NextResponse.json({ error: 'quoteId 为必填数字参数' }, { status: 400 });
    }

    const result = await createPOFromAwardedQuote(
      { client, actor, role: role as Role },
      { quoteId },
    );

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status =
      message.includes('不存在') || message.includes('not found')
        ? 404
        : message.includes('只有')
          ? 403
          : message.includes('status')
            ? 400
            : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
