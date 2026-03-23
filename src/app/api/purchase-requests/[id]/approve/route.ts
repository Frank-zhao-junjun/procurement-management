import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { numberGenerators } from '@/storage/database/number-generator';
import { getUserIdentityWithLookup, type Role } from '@/lib/role-filter';

// POST /api/purchase-requests/[id]/approve - 审批采购申请
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const body = await request.json();
    const { actor, role } = await getUserIdentityWithLookup(request);

    const approved = body.approved !== false; // 默认批准

    // 检查当前状态
    const { data: existing } = await client
      .from('purchase_requests')
      .select('id, status, pr_number')
      .eq('id', parseInt(id, 10))
      .single();

    if (!existing) {
      return NextResponse.json({ error: 'Purchase request not found' }, { status: 404 });
    }

    if (existing.status !== 'submitted') {
      return NextResponse.json(
        { error: `Cannot approve request in status: ${existing.status}` },
        { status: 400 }
      );
    }

    // 更新状态
    const newStatus = approved ? 'approved' : 'rejected';
    const { data, error } = await client
      .from('purchase_requests')
      .update({
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', parseInt(id, 10))
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 如果批准，更新所有行的进度为 approved
    if (approved) {
      await client
        .from('purchase_request_lines')
        .update({ progress: 'approved', updated_at: new Date().toISOString() })
        .eq('request_id', parseInt(id, 10));

      // 尝试自动匹配框架协议
      await matchFrameworkAgreements(client, parseInt(id, 10));
    }

    // 记录审计日志
    await client.from('audit_logs').insert({
      entity_type: 'purchase_request',
      entity_id: parseInt(id, 10),
      action: approved ? 'approve' : 'reject',
      actor,
      actor_role: role,
      detail: {
        from_status: 'submitted',
        to_status: newStatus,
        note: body.note,
      },
    });

    // 获取完整数据（分开查询避免嵌套）
    const { data: fullPR } = await client
      .from('purchase_requests')
      .select('*')
      .eq('id', parseInt(id, 10))
      .single();

    const { data: lines } = await client
      .from('purchase_request_lines')
      .select('*')
      .eq('request_id', parseInt(id, 10));

    return NextResponse.json({ data: { ...fullPR, purchase_request_lines: lines } });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// 尝试自动匹配框架协议，未匹配则创建寻源任务
async function matchFrameworkAgreements(client: any, requestId: number) {
  try {
    // 获取采购申请行
    const { data: lines } = await client
      .from('purchase_request_lines')
      .select('*')
      .eq('request_id', requestId)
      .eq('progress', 'approved');

    for (const line of lines || []) {
      // 获取上海时区日期（用于 FA 有效期判断）
      const todayShanghai = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      
      // 获取有效期内的框架协议（上海时区）
      const { data: agreements } = await client
        .from('framework_agreements')
        .select('*')
        .eq('status', 'active')
        .lte('valid_from', todayShanghai)
        .gte('valid_to', todayShanghai);

      let matched = false;

      if (agreements && agreements.length > 0) {
        // 1. 优先按 material_id 精确匹配
        let idMatches = agreements.filter((fa: any) => fa.material_id === line.material_id);
        
        // 2. 次级按原文归一相等匹配
        let textMatches = agreements.filter((fa: any) => 
          normalizeText(fa.material_original_text || '') === normalizeText(line.requirement_text || '')
        );

        // 合并结果（去重），优先 ID 匹配
        const allMatches = [...idMatches, ...textMatches.filter((fa: any) => 
          !idMatches.some((m: any) => m.id === fa.id)
        )];

        if (allMatches.length > 0) {
          // 按价格升序，取最低价
          allMatches.sort((a, b) => parseFloat(a.unit_price) - parseFloat(b.unit_price));
          const best = allMatches[0];
          
          // 标记为待确认（不是静默 confirmed）
          await client
            .from('purchase_request_lines')
            .update({
              progress: 'pending_confirm',  // 待确认状态
              material_id: best.material_id,
              material_snapshot: best.material_snapshot,
              match_confirm: 'pending',  // 等待用户确认
              matched_fa_id: best.id,   // 记录匹配的 FA
              updated_at: new Date().toISOString(),
            })
            .eq('id', line.id);

          matched = true;

          // 返回 Top-3 备选供用户选择（记录到审计日志）
          const top3 = allMatches.slice(0, 3);
          await client.from('audit_logs').insert({
            entity_type: 'purchase_request_line',
            entity_id: line.id,
            action: 'fa_candidates',
            actor: 'system',
            actor_role: 'system',
            detail: {
              candidates: top3.map((fa: any) => ({
                fa_id: fa.id,
                fa_number: fa.fa_number,
                supplier_snapshot: fa.supplier_snapshot,
                unit_price: parseFloat(fa.unit_price),
              })),
              recommended_fa_id: best.id,
              match_type: idMatches.length > 0 ? 'material_id' : 'text',
            },
          });
        }
      }

      // 如果没有匹配到框架协议，创建寻源任务
      if (!matched) {
        const taskNumber = await numberGenerators.sc();
        
        const { data: sourcingTask, error: scError } = await client
          .from('sourcing_tasks')
          .insert({
            task_number: taskNumber,
            pr_id: requestId,
            pr_line_id: line.id,
            material_id: null,
            material_snapshot: line.requirement_text,
            requirement_text: line.requirement_text,
            status: 'pending',
            created_by: 'system',
          })
          .select()
          .single();

        if (!scError && sourcingTask) {
          // 更新 PR 行状态
          await client
            .from('purchase_request_lines')
            .update({
              progress: 'sourced',
              sourcing_task_id: sourcingTask.id,
              updated_at: new Date().toISOString(),
            })
            .eq('id', line.id);

          // 记录审计日志
          await client.from('audit_logs').insert({
            entity_type: 'purchase_request_line',
            entity_id: line.id,
            action: 'create_sourcing_task',
            actor: 'system',
            actor_role: 'system',
            detail: {
              sourcing_task_id: sourcingTask.id,
              task_number: taskNumber,
            },
          });
        }
      }
    }
  } catch (error) {
    console.error('Error matching framework agreements:', error);
  }
}

// 文本归一化（去除首尾空格、多空格压缩、全角半角统一、英文大小写统一）
function normalizeText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[Ａ-Ｚａ-ｚ]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFF10));
}
