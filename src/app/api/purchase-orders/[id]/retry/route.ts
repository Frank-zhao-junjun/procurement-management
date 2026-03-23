import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { retryPOSend, explicitRetryPOSend } from '@/storage/database/po-sender';
import { getUserIdentityWithLookup, canCreatePO, type Role } from '@/lib/role-filter';

// GET /api/purchase-orders/[id]/retry - 获取 PO 重试状态
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();

    const { data, error } = await client
      .from('po_send_failures')
      .select('*')
      .eq('po_id', parseInt(id, 10))
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return NextResponse.json({ 
        hasFailure: false,
        message: '无失败记录'
      });
    }

    return NextResponse.json({
      hasFailure: true,
      failureId: data.id,
      status: data.status,
      retryCount: data.retry_count,
      maxRetries: data.max_retries,
      failureReason: data.failure_reason,
      nextRetryAt: data.next_retry_at,
      resolvedAt: data.resolved_at,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/purchase-orders/[id]/retry - 显式重试 PO 发送
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { actor, role } = await getUserIdentityWithLookup(request);

    // 只有 buyer 和 manager 可以重试
    if (!canCreatePO(role as Role)) {
      return NextResponse.json({ error: '只有采购人可以重试 PO' }, { status: 403 });
    }

    const poId = parseInt(id, 10);
    const result = await explicitRetryPOSend(poId);

    if (result.success) {
      return NextResponse.json({ success: true, message: 'PO 发送成功' });
    }

    return NextResponse.json({
      success: false,
      error: result.error,
      failureId: result.failureId,
      message: 'PO 发送失败',
    }, { status: 500 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
