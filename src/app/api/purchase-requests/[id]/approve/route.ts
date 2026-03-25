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
      await matchFrameworkAgreements(client, parseInt(id, 10), actor);
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
async function matchFrameworkAgreements(client: any, requestId: number, actor: string) {
  try {
    // 获取采购申请信息
    const { data: pr } = await client
      .from('purchase_requests')
      .select('*')
      .eq('id', requestId)
      .single();

    if (!pr) return;

    // 获取采购申请行
    const { data: lines } = await client
      .from('purchase_request_lines')
      .select('*')
      .eq('request_id', requestId)
      .eq('progress', 'approved');

    // 收集需要自动创建 PO 的行
    const autoPOLines: any[] = [];

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

      if (agreements && agreements.length > 0) {
        // 1. 优先按 material_id 精确匹配
        const idMatches = agreements.filter((fa: any) => fa.material_id === line.material_id && fa.material_id !== null);
        
        // 2. 次级按原文归一相等匹配
        const textMatches = agreements.filter((fa: any) => 
          normalizeText(fa.material_original_text || '') === normalizeText(line.requirement_text || '')
        );

        // 合并结果（去重），优先 ID 匹配
        const allMatches = [...idMatches, ...textMatches.filter((fa: any) => 
          !idMatches.some((m: any) => m.id === fa.id)
        )];

        if (allMatches.length > 0) {
          // 按价格升序，取最低价
          allMatches.sort((a, b) => Number(a.unit_price) - Number(b.unit_price));
          const best = allMatches[0];
          
          // 判断匹配类型
          const isExactMatch = idMatches.some((m: any) => m.id === best.id);
          
          if (isExactMatch && line.material_id !== null) {
            // 物料 ID 精确匹配 → 自动创建 PO
            autoPOLines.push({
              line,
              fa: best,
              unitPrice: Number(best.unit_price),
            });
          } else {
            // 文本相似匹配 → 需要用户确认
            await client
              .from('purchase_request_lines')
              .update({
                progress: 'pending_confirm',
                material_id: best.material_id,
                material_snapshot: best.material_snapshot,
                match_confirm: 'pending',
                matched_fa_id: best.id,
                updated_at: new Date().toISOString(),
              })
              .eq('id', line.id);

            // 记录 Top-3 备选到审计日志
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
                  unit_price: Number(fa.unit_price),
                })),
                recommended_fa_id: best.id,
                match_type: 'text_similarity',
                requires_confirmation: true,
              },
            });
          }
          continue;
        }
      }

      // 如果没有匹配到框架协议，创建寻源任务
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
        await client
          .from('purchase_request_lines')
          .update({
            progress: 'sourced',
            sourcing_task_id: sourcingTask.id,
            updated_at: new Date().toISOString(),
          })
          .eq('id', line.id);

        await client.from('audit_logs').insert({
          entity_type: 'purchase_request_line',
          entity_id: line.id,
          action: 'create_sourcing_task',
          actor: 'system',
          actor_role: 'system',
          detail: { sourcing_task_id: sourcingTask.id, task_number: taskNumber },
        });
      }
    }

    // 自动创建采购订单（汇总所有精确匹配的 FA 行）
    if (autoPOLines.length > 0) {
      await createAutoPO(client, pr, autoPOLines, actor);
    }
  } catch (error) {
    console.error('Error matching framework agreements:', error);
  }
}

// 自动创建采购订单
async function createAutoPO(client: any, pr: any, lines: any[], actor: string) {
  try {
    // 按供应商分组
    const supplierGroups: Record<number, any[]> = {};
    for (const item of lines) {
      const supplierId = item.fa.supplier_id;
      if (!supplierGroups[supplierId]) {
        supplierGroups[supplierId] = [];
      }
      supplierGroups[supplierId].push(item);
    }

    // 为每个供应商创建一张 PO
    for (const [supplierId, supplierLines] of Object.entries(supplierGroups)) {
      const poNumber = await numberGenerators.po();
      const supplierName = supplierLines[0].fa.supplier_snapshot || '';

      // 创建 PO 头
      const { data: po, error: poError } = await client
        .from('purchase_orders')
        .insert({
          po_number: poNumber,
          supplier_id: supplierId,
          supplier_snapshot: supplierName,
          pr_id: pr.id,
          status: 'draft',
          created_by: actor,
        })
        .select()
        .single();

      if (poError || !po) {
        console.error('Error creating auto PO:', poError);
        continue;
      }

      // 创建 PO 行
      const poLines = supplierLines.map((item: any, index: number) => ({
        order_id: po.id,
        line_number: index + 1,
        pr_id: pr.id,
        pr_line_id: item.line.id,
        material_id: item.line.material_id,
        material_snapshot: item.line.material_snapshot || item.fa.material_snapshot,
        quantity: item.line.quantity,
        unit_price: item.unitPrice,
        total_price: item.line.quantity * item.unitPrice,
        received_qty: 0,
        pending_qty: item.line.quantity,
        status: 'ordered',
        fa_id: item.fa.id,
      }));

      const { error: linesError } = await client
        .from('purchase_order_lines')
        .insert(poLines);

      if (linesError) {
        console.error('Error creating auto PO lines:', linesError);
        // 回滚 PO
        await client.from('purchase_orders').delete().eq('id', po.id);
        continue;
      }

      // 更新 PR 行状态
      for (const item of supplierLines) {
        await client
          .from('purchase_request_lines')
          .update({
            progress: 'ordered',
            purchase_order_id: po.id,
            po_line_number: supplierLines.indexOf(item) + 1,
            matched_fa_id: item.fa.id,
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.line.id);
      }

      // 记录审计日志
      await client.from('audit_logs').insert({
        entity_type: 'purchase_order',
        entity_id: po.id,
        action: 'auto_create_from_pr',
        actor: 'system',
        actor_role: 'system',
        detail: {
          po_number: poNumber,
          pr_id: pr.id,
          pr_number: pr.pr_number,
          supplier_id: supplierId,
          supplier_snapshot: supplierName,
          lines_count: supplierLines.length,
        },
      });
    }
  } catch (error) {
    console.error('Error in createAutoPO:', error);
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
