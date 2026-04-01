import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { numberGenerators } from '@/storage/database/number-generator';
import { getUserIdentityWithLookup, type Role } from '@/lib/role-filter';
import { emitPRApproved, emitSourcingTaskCreated, emitPOCreated } from '@/lib/events';

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
      .select('id, status, pr_number, applicant')
      .eq('id', parseInt(id, 10))
      .single();

    if (!existing) {
      return NextResponse.json({ error: 'Purchase request not found' }, { status: 404 });
    }

    if (existing.status !== 'submitted' && existing.status !== 'pending') {
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

    // 审批结果数据（用于通知）
    let approvalResult: {
      approved: boolean;
      autoPOs: any[];
      sourcingTasks: any[];
      faMatches: any[];
    } = {
      approved: false,
      autoPOs: [],
      sourcingTasks: [],
      faMatches: [],
    };

    // 如果批准，更新所有行的进度为 approved，并处理 FA 匹配/PO 创建
    if (approved) {
      await client
        .from('purchase_request_lines')
        .update({ progress: 'approved', updated_at: new Date().toISOString() })
        .eq('request_id', parseInt(id, 10));

      // 尝试自动匹配框架协议
      const matchResult = await matchFrameworkAgreements(client, parseInt(id, 10), actor);
      approvalResult = {
        approved: true,
        autoPOs: matchResult.autoPOs,
        sourcingTasks: matchResult.sourcingTasks,
        faMatches: matchResult.faMatches,
      };
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
        ...approvalResult,
      },
    });

    // 获取完整数据
    const { data: fullPR } = await client
      .from('purchase_requests')
      .select('*')
      .eq('id', parseInt(id, 10))
      .single();

    const { data: lines } = await client
      .from('purchase_request_lines')
      .select('*')
      .eq('request_id', parseInt(id, 10));

    const result = { ...fullPR, purchase_request_lines: lines };

    // ========== 事件发布 ==========
    
    // 1. 发布 PR_APPROVED 事件（通知 Buyer 执行 FA 匹配，通知 Manager 审批完成）
    emitPRApproved({
      prId: existing.id,
      prNumber: existing.pr_number,
      approved,
      approverId: actor,
      approverName: undefined,
      note: body.note,
      faMatches: approvalResult.faMatches,
      sourcingTasks: approvalResult.sourcingTasks,
      autoPOs: approvalResult.autoPOs,
      actor,
      actorRole: role,
    }, 'pr_approve_api').catch(err => console.error('[Event] Failed to emit PR_APPROVED:', err));

    // 2. 发布寻源任务创建事件
    for (const task of approvalResult.sourcingTasks) {
      emitSourcingTaskCreated({
        taskId: task.id,
        taskNumber: task.task_number,
        prId: existing.id,
        prNumber: existing.pr_number,
        prLineId: task.pr_line_id,
        materialSnapshot: task.material_snapshot,
        requirementText: task.requirement_text || task.material_snapshot,
        status: 'pending',
        actor: 'system',
        actorRole: 'system',
      }, 'pr_approve_auto_create').catch(err => 
        console.error('[Event] Failed to emit SOURCING_TASK_CREATED:', err)
      );
    }

    // 3. 发布 PO 创建事件
    for (const po of approvalResult.autoPOs) {
      emitPOCreated({
        poId: po.id,
        poNumber: po.po_number,
        supplierId: po.supplier_id,
        supplierName: po.supplier_snapshot,
        prId: existing.id,
        prNumber: existing.pr_number,
        status: 'draft',
        linesCount: 1,
        actor: 'system',
        actorRole: 'system',
      }, 'pr_approve_auto_create').catch(err => 
        console.error('[Event] Failed to emit PO_CREATED:', err)
      );
    }

    return NextResponse.json({ 
      data: result,
      approval: approvalResult,
      events_published: {
        pr_approved: true,
        sourcing_tasks: approvalResult.sourcingTasks.length,
        auto_pos: approvalResult.autoPOs.length,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// 尝试自动匹配框架协议，未匹配则创建寻源任务
async function matchFrameworkAgreements(
  client: any, 
  requestId: number, 
  actor: string
): Promise<{ autoPOs: any[]; sourcingTasks: any[]; faMatches: any[] }> {
  const result = {
    autoPOs: [] as any[],
    sourcingTasks: [] as any[],
    faMatches: [] as any[],
  };

  try {
    // 获取采购申请信息
    const { data: pr } = await client
      .from('purchase_requests')
      .select('*')
      .eq('id', requestId)
      .single();

    if (!pr) return result;

    // 获取采购申请行
    const { data: lines } = await client
      .from('purchase_request_lines')
      .select('*')
      .eq('request_id', requestId)
      .eq('progress', 'approved');

    // 收集需要自动创建 PO 的行
    const autoPOLines: any[] = [];

    for (const line of lines || []) {
      // 获取上海时区日期
      const todayShanghai = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      
      // 获取有效期内的框架协议
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
          allMatches.sort((a, b) => Number(a.unit_price) - Number(b.unit_price));
          const best = allMatches[0];
          
          const isExactMatch = idMatches.some((m: any) => m.id === best.id);
          
          if (isExactMatch && line.material_id !== null) {
            // 物料 ID 精确匹配 → 自动创建 PO
            autoPOLines.push({ line, fa: best, unitPrice: Number(best.unit_price) });
            result.faMatches.push({
              id: best.id,
              fa_number: best.fa_number,
              supplier_snapshot: best.supplier_snapshot,
              unit_price: Number(best.unit_price),
              match_type: 'material_id',
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

            result.faMatches.push({
              id: best.id,
              fa_number: best.fa_number,
              supplier_snapshot: best.supplier_snapshot,
              unit_price: Number(best.unit_price),
              match_type: 'text_similarity',
              requires_confirmation: true,
            });
          }
          continue;
        }
      }

      // 没有匹配到框架协议，创建寻源任务
      const taskNumber = await numberGenerators.sc();
      
      const { data: sourcingTask } = await client
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

      if (sourcingTask) {
        result.sourcingTasks.push(sourcingTask);
        
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

    // 自动创建采购订单
    if (autoPOLines.length > 0) {
      const pos = await createAutoPO(client, pr, autoPOLines, actor);
      result.autoPOs = pos;
    }
  } catch (error) {
    console.error('Error matching framework agreements:', error);
  }

  return result;
}

// 自动创建采购订单
async function createAutoPO(client: any, pr: any, lines: any[], actor: string): Promise<any[]> {
  const createdPOs: any[] = [];

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

    for (const [supplierId, supplierLines] of Object.entries(supplierGroups)) {
      const poNumber = await numberGenerators.po();
      const supplierName = supplierLines[0].fa.supplier_snapshot || '';

      const { data: po, error: poError } = await client
        .from('purchase_orders')
        .insert({
          po_number: poNumber,
          supplier_id: supplierId,
          supplier_snapshot: supplierName,
          pr_id: pr.id,
          status: 'sent', // 框架协议匹配直接设为已发送，无需再发送
          created_by: actor,
        })
        .select()
        .single();

      if (poError || !po) {
        console.error('Error creating auto PO:', poError);
        continue;
      }

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

      const { error: linesError } = await client.from('purchase_order_lines').insert(poLines);
      
      if (linesError) {
        console.error('Error inserting PO lines:', linesError);
        // 回滚：删除已创建的 PO 头
        await client.from('purchase_orders').delete().eq('id', po.id);
        continue;
      }

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

      createdPOs.push(po);
    }
  } catch (error) {
    console.error('Error in createAutoPO:', error);
  }

  return createdPOs;
}

// 文本归一化
function normalizeText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[Ａ-Ｚａ-ｚ]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFF10));
}
