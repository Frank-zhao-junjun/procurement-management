import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { createPRFromMaterialCheck } from '@/lib/agent-actions';
import { getUserIdentityWithLookup, type Role } from '@/lib/role-filter';

export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);
    const body = await request.json();

    if (!body?.reason || typeof body.reason !== 'string') {
      return NextResponse.json({ error: 'reason 为必填字符串' }, { status: 400 });
    }

    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      return NextResponse.json({ error: 'lines 为必填且不能为空数组' }, { status: 400 });
    }

    const result = await createPRFromMaterialCheck(
      {
        client,
        actor,
        role: role as Role,
      },
      {
        reason: body.reason,
        lines: body.lines,
        autoSubmit: body.autoSubmit === true,
        createMissingMaterials: body.createMissingMaterials === true,
        cancelledLines: Array.isArray(body.cancelledLines) ? body.cancelledLines : [],
      },
    );

    return NextResponse.json(result, { status: result.statusCode });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message.includes('只有') ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
