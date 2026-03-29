import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { getUserIdentityWithLookup } from '@/lib/role-filter';
import { onContractPending } from '@/lib/agent-notify';

/**
 * POST /api/contracts/[id]/submit - 提交框架协议审批
 * 将框架协议从 draft 状态提交到 pending 状态
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
      .from('contracts')
      .select('*')
      .eq('id', parseInt(id, 10))
      .single();

    if (findError) {
      return NextResponse.json({ error: findError.message }, { status: 500 });
    }

    if (!existing) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
    }

    if (existing.status !== 'draft') {
      return NextResponse.json(
        { error: 'Only draft contracts can be submitted' },
        { status: 400 }
      );
    }

    // 更新状态为 pending
    const { data, error } = await client
      .from('contracts')
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
      entity_type: 'contract',
      entity_id: parseInt(id, 10),
      action: 'submit',
      actor,
      actor_role: role,
      detail: { previous_status: 'draft', new_status: 'pending' },
    });

    // 通知 Manager Agent
    let notifyResult = null;
    try {
      notifyResult = await onContractPending(parseInt(id, 10));
    } catch (notifyError) {
      console.error('Failed to notify Manager Agent:', notifyError);
    }

    return NextResponse.json({ 
      data,
      notification: notifyResult,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
