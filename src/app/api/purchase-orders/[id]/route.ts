import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';

// 获取当前用户信息
function getActorInfo(request: NextRequest): { actor: string; role: string } {
  return {
    actor: request.headers.get('X-Actor') || 'system',
    role: request.headers.get('X-Role') || 'buyer',
  };
}

// GET /api/purchase-orders/[id] - 获取单个采购订单
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();

    const { data, error } = await client
      .from('purchase_orders')
      .select('*, purchase_order_lines(*)')
      .eq('id', parseInt(id, 10))
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
