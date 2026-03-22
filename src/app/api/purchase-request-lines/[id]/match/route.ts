import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { matchFrameworkAgreement, updateMatchConfirm } from '@/storage/database/fa-matcher';

// GET /api/purchase-request-lines/[id]/match - 查询 FA 匹配结果
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const searchParams = request.nextUrl.searchParams;
    const topN = parseInt(searchParams.get('topN') || '3', 10);

    // 获取 PR 行信息
    const { data: prLine, error } = await client
      .from('purchase_request_lines')
      .select('*')
      .eq('id', parseInt(id, 10))
      .single();

    if (error || !prLine) {
      return NextResponse.json({ error: 'PR line not found' }, { status: 404 });
    }

    // 执行 FA 匹配
    const matchResult = await matchFrameworkAgreement(
      prLine.material_id,
      prLine.requirement_text,
      topN
    );

    return NextResponse.json({
      data: {
        pr_line: prLine,
        match_result: matchResult,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT /api/purchase-request-lines/[id]/match - 确认/拒绝 FA 匹配
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const body = await request.json();

    const faId = body.faId;
    const confirmed = body.confirmed !== false; // 默认确认

    if (!faId) {
      return NextResponse.json({ error: 'faId is required' }, { status: 400 });
    }

    // 更新匹配确认状态
    await updateMatchConfirm(parseInt(id, 10), faId, confirmed);

    // 如果确认，更新 PR 行匹配到 FA 信息
    if (confirmed) {
      const { data: fa } = await client
        .from('framework_agreements')
        .select('*')
        .eq('id', faId)
        .single();

      if (fa) {
        await client
          .from('purchase_request_lines')
          .update({
            progress: 'matched_protocol',
            material_id: fa.material_id,
            material_snapshot: fa.material_snapshot,
            updated_at: new Date().toISOString(),
          })
          .eq('id', parseInt(id, 10));
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
