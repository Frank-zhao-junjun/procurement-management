import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { matchFrameworkAgreement, updateMatchConfirm } from '@/storage/database/fa-matcher';
import { getUserIdentityWithLookup, type Role } from '@/lib/role-filter';

// GET /api/purchase-request-lines/[id]/match - 查询 FA 匹配结果
// Requester 可查看自己 PR 的匹配结果
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);
    const searchParams = request.nextUrl.searchParams;
    const topN = parseInt(searchParams.get('topN') || '3', 10);

    // 获取 PR 行信息
    const { data: prLine, error } = await client
      .from('purchase_request_lines')
      .select('*, purchase_requests(applicant)')
      .eq('id', parseInt(id, 10))
      .single();

    if (error || !prLine) {
      return NextResponse.json({ error: 'PR line not found' }, { status: 404 });
    }

    // Requester 只能查看自己 PR 行的匹配结果
    if (role === 'requester' && prLine.purchase_requests?.applicant !== actor) {
      return NextResponse.json({ error: '无权访问此采购申请行的匹配结果' }, { status: 403 });
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
// Requester 可操作自己 PR 行的匹配确认
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);
    const body = await request.json();

    const faId = body.faId;
    const confirmed = body.confirmed !== false; // 默认确认

    if (!faId) {
      return NextResponse.json({ error: 'faId is required' }, { status: 400 });
    }

    // 获取 PR 行信息验证权限
    const { data: prLine } = await client
      .from('purchase_request_lines')
      .select('*, purchase_requests(applicant)')
      .eq('id', parseInt(id, 10))
      .single();

    if (!prLine) {
      return NextResponse.json({ error: 'PR line not found' }, { status: 404 });
    }

    // Requester 只能操作自己 PR 的行
    if (role === 'requester' && prLine.purchase_requests?.applicant !== actor) {
      return NextResponse.json({ error: '无权操作此采购申请行' }, { status: 403 });
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
