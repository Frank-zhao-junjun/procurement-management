/**
 * Purchase Request Withdraw API - 采购申请撤回
 * 
 * 将"待审批"状态的采购申请撤回为"草稿"状态
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { getUserIdentityWithLookup } from '@/lib/role-filter';
import { getBeijingISOString } from '@/lib/datetime';

// POST /api/purchase-requests/{id}/withdraw - 撤回采购申请
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const prId = parseInt(id, 10);

    if (isNaN(prId)) {
      return NextResponse.json({ error: '无效的采购申请 ID' }, { status: 400 });
    }

    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);

    // 查询 PR
    const { data: existing, error: findError } = await client
      .from('purchase_requests')
      .select('id, pr_number, status, applicant')
      .eq('id', prId)
      .single();

    if (findError) {
      return NextResponse.json({ error: findError.message }, { status: 500 });
    }

    if (!existing) {
      return NextResponse.json({ error: '采购申请不存在' }, { status: 404 });
    }

    // 权限检查：只有申请人可以撤回自己的 PR
    if (existing.applicant !== actor) {
      console.error(`[Auth Error] 撤回被拒绝: applicant="${existing.applicant}", actor="${actor}"`);
      return NextResponse.json(
        { 
          error: '只有申请人可以撤回采购申请',
          debug: {
            expectedApplicant: existing.applicant,
            actualActor: actor,
            match: existing.applicant === actor,
            headerXActor: request.headers.get('X-Actor'),
          }
        },
        { status: 403 }
      );
    }

    // 状态检查：只有"待审批"状态才能撤回
    if (existing.status !== 'pending') {
      return NextResponse.json(
        { 
          error: `当前状态 "${existing.status}" 不能撤回，只有"待审批"状态的采购申请可以撤回`,
          currentStatus: existing.status,
        },
        { status: 400 }
      );
    }

    // 执行撤回
    const { error: updateError } = await client
      .from('purchase_requests')
      .update({
        status: 'draft',
        updated_at: getBeijingISOString(),
      })
      .eq('id', prId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // 同时将所有行项目的状态重置
    await client
      .from('purchase_request_lines')
      .update({
        status: null,
        progress: 'pending',
        updated_at: getBeijingISOString(),
      })
      .eq('request_id', prId);

    // 记录审计日志
    await client.from('audit_logs').insert({
      entity_type: 'purchase_request',
      entity_id: prId,
      action: 'withdraw',
      actor,
      actor_role: role,
      detail: {
        pr_number: existing.pr_number,
        previousStatus: 'pending',
        newStatus: 'draft',
        reason: '申请人撤回',
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        id: prId,
        prNumber: existing.pr_number,
        previousStatus: 'pending',
        currentStatus: 'draft',
      },
      message: '采购申请已撤回，可以修改后重新提交',
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// GET /api/purchase-requests/{id}/withdraw - 检查是否可以撤回
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const prId = parseInt(id, 10);

    if (isNaN(prId)) {
      return NextResponse.json({ error: '无效的采购申请 ID' }, { status: 400 });
    }

    const client = getSupabaseClient();
    const { actor } = await getUserIdentityWithLookup(request);

    // 查询 PR
    const { data: existing, error: findError } = await client
      .from('purchase_requests')
      .select('id, pr_number, status, applicant')
      .eq('id', prId)
      .single();

    if (findError) {
      return NextResponse.json({ error: findError.message }, { status: 500 });
    }

    if (!existing) {
      return NextResponse.json({ error: '采购申请不存在' }, { status: 404 });
    }

    // 检查是否可以撤回
    const canWithdraw = existing.status === 'pending' && existing.applicant === actor;

    return NextResponse.json({
      data: {
        id: prId,
        prNumber: existing.pr_number,
        status: existing.status,
        canWithdraw,
        reason: !canWithdraw
          ? existing.status !== 'pending'
            ? `当前状态 "${existing.status}" 不能撤回`
            : '只有申请人可以撤回'
          : null,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
