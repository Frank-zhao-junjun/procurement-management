import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { getUserIdentity, type Role } from '@/lib/role-filter';

// POST /api/purchase-requests/[id]/submit - 提交采购申请
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const { actor, role } = getUserIdentity(request) as { actor: string; role: Role };

    // 检查当前状态
    const { data: existing } = await client
      .from('purchase_requests')
      .select('id, status, applicant')
      .eq('id', parseInt(id, 10))
      .single();

    if (!existing) {
      return NextResponse.json({ error: 'Purchase request not found' }, { status: 404 });
    }

    if (existing.status !== 'draft') {
      return NextResponse.json(
        { error: `Cannot submit request in status: ${existing.status}` },
        { status: 400 }
      );
    }

    // 更新状态
    const { data, error } = await client
      .from('purchase_requests')
      .update({
        status: 'submitted',
        updated_at: new Date().toISOString(),
      })
      .eq('id', parseInt(id, 10))
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 记录审计日志
    await client.from('audit_logs').insert({
      entity_type: 'purchase_request',
      entity_id: parseInt(id, 10),
      action: 'submit',
      actor,
      actor_role: role,
      detail: { from_status: 'draft', to_status: 'submitted' },
    });

    return NextResponse.json({ data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
