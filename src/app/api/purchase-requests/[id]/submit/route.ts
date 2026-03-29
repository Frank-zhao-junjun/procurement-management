import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { getUserIdentityWithLookup } from '@/lib/role-filter';
import { onPRSubmitted } from '@/lib/agent-notify';

/**
 * POST /api/purchase-requests/[id]/submit - 提交采购申请
 * 将采购申请从 draft 状态提交到 pending 状态
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);

    // 检查当前状态
    const { data: existing, error: findError } = await client
      .from('purchase_requests')
      .select('*')
      .eq('id', parseInt(id, 10))
      .single();

    if (findError) {
      return NextResponse.json({ error: findError.message }, { status: 500 });
    }

    if (!existing) {
      return NextResponse.json({ error: 'Purchase request not found' }, { status: 404 });
    }

    if (existing.status !== 'draft') {
      return NextResponse.json(
        { error: 'Only draft requests can be submitted' },
        { status: 400 }
      );
    }

    // 检查是否有行项目
    const { data: lines } = await client
      .from('purchase_request_lines')
      .select('*')
      .eq('request_id', parseInt(id, 10));

    if (!lines || lines.length === 0) {
      return NextResponse.json(
        { error: 'Cannot submit request without items' },
        { status: 400 }
      );
    }

    // 更新状态为 pending
    const { data, error } = await client
      .from('purchase_requests')
      .update({ 
        status: 'pending',
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
      detail: { previous_status: 'draft', new_status: 'pending' },
    });

    // 通知 Manager Agent
    let notifyResult = null;
    try {
      notifyResult = await onPRSubmitted(parseInt(id, 10));
    } catch (notifyError) {
      console.error('Failed to notify Manager Agent:', notifyError);
    }

    return NextResponse.json({ 
      data: { ...data, purchase_request_lines: lines },
      notification: notifyResult,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
