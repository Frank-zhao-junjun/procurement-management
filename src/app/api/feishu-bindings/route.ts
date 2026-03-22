import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { 
  createBinding, 
  getAllActiveBindings, 
  getBindingByFeishuUserId,
  getBindingByEntry,
  type FeishuEntry 
} from '@/storage/database/feishu-binding';

// GET /api/feishu-bindings - 获取所有绑定列表
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const entry = searchParams.get('entry') as FeishuEntry | null;
    const feishuUserId = searchParams.get('feishuUserId');

    if (feishuUserId) {
      // 按飞书用户查询
      const binding = await getBindingByFeishuUserId(feishuUserId);
      return NextResponse.json({ data: binding });
    }

    if (entry) {
      // 按入口查询
      const binding = await getBindingByEntry(entry);
      return NextResponse.json({ data: binding });
    }

    // 返回所有活跃绑定
    const bindings = await getAllActiveBindings();
    return NextResponse.json({ data: bindings });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/feishu-bindings - 创建绑定
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const { 
      feishuUserId, 
      feishuOpenId, 
      feishuUnionId, 
      entry 
    } = body;

    if (!feishuUserId || !entry) {
      return NextResponse.json({ 
        error: 'feishuUserId and entry are required' 
      }, { status: 400 });
    }

    // 验证入口类型
    if (!['requester', 'manager', 'buyer'].includes(entry)) {
      return NextResponse.json({ 
        error: 'Invalid entry type. Must be: requester, manager, or buyer' 
      }, { status: 400 });
    }

    const result = await createBinding(
      feishuUserId,
      feishuOpenId || '',
      feishuUnionId || '',
      entry
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ 
      success: true, 
      bindingId: result.bindingId 
    }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
