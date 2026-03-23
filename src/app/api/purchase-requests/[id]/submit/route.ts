import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { getUserIdentityWithLookup, type Role } from '@/lib/role-filter';
import { getManagerWebhooks } from '@/storage/database/agent-binding';

// POST /api/purchase-requests/[id]/submit - 提交采购申请
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);

    // 检查当前状态
    const { data: existing } = await client
      .from('purchase_requests')
      .select('id, status, applicant, pr_number')
      .eq('id', parseInt(id, 10))
      .single();

    if (!existing) {
      return NextResponse.json({ error: 'Purchase request not found' }, { status: 404 });
    }

    // 只有申请人本人可提交自己的草稿
    if (existing.applicant !== actor) {
      return NextResponse.json({ error: '只有申请人本人可提交此采购申请' }, { status: 403 });
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

    // 通知所有 Manager Agent
    notifyManagers({
      event: 'pr_submitted',
      prId: parseInt(id, 10),
      prNumber: existing.pr_number,
      submittedBy: actor,
      submittedAt: new Date().toISOString(),
    }).catch(err => {
      console.error('Failed to notify managers:', err);
    });

    return NextResponse.json({ data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// 通知所有 Manager Agent
async function notifyManagers(payload: {
  event: string;
  prId: number;
  prNumber: string;
  submittedBy: string;
  submittedAt: string;
}): Promise<void> {
  const webhooks = await getManagerWebhooks();

  if (webhooks.length === 0) {
    console.log('No manager webhooks configured');
    return;
  }

  const results = await Promise.allSettled(
    webhooks.map(async (webhookUrl) => {
      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'ProcurementSystem-Webhook/1.0',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000), // 10s timeout
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return { url: webhookUrl, success: true };
      } catch (err) {
        return { url: webhookUrl, success: false, error: err instanceof Error ? err.message : 'Unknown error' };
      }
    })
  );

  const succeeded = results.filter(r => r.status === 'fulfilled' && (r as any).value.success).length;
  const failed = results.filter(r => r.status === 'rejected' || !(r as any).value.success).length;

  console.log(`Webhook notifications: ${succeeded} succeeded, ${failed} failed`);
}
