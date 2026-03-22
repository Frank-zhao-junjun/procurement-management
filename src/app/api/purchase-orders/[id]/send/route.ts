import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { sendPurchaseOrder, explicitRetryPOSend, getPendingRetries } from '@/storage/database/po-sender';
import { getUserIdentity, canCreatePO, type Role } from '@/lib/role-filter';

// POST /api/purchase-orders/[id]/send - 发送 PO 给供应商
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { actor, role } = getUserIdentity(request);

    // 只有 buyer 和 manager 可以发送 PO
    if (!canCreatePO(role as Role)) {
      return NextResponse.json({ error: '只有采购人可以发送 PO' }, { status: 403 });
    }

    const poId = parseInt(id, 10);
    const result = await sendPurchaseOrder(poId);

    if (result.success) {
      return NextResponse.json({ success: true, message: 'PO 发送成功' });
    }

    return NextResponse.json({
      success: false,
      error: result.error,
      failureId: result.failureId,
      message: 'PO 发送失败，已加入重试队列',
    }, { status: 500 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
