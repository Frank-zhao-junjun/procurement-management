import { numberGenerators } from '@/storage/database/number-generator';
import { getBeijingISOString } from '@/lib/datetime';
import {
  emitPOCreated,
  emitPRApproved,
  emitPRFAMatched,
  emitPRSubmitted,
  emitQuoteAwarded,
  emitSourcingTaskCreated,
} from '@/lib/events';
import { canApprove, canCreatePO, type Role } from '@/lib/role-filter';

type DBClient = {
  from: (table: string) => any;
};

type ActionContext = {
  client: DBClient;
  actor: string;
  role: Role;
};

type MaterialCheckInputLine = {
  requirementText: string;
  quantity: number;
  estUnitPrice?: number | string | null;
  expectedDeliveryDate?: string | null;
  note?: string | null;
  confirmedMaterialId?: number | null;
  confirmedMaterialName?: string | null;
  confirmedMaterialUnit?: string | null;
};

type MaterialMatchResult = {
  requirementText: string;
  found: boolean;
  exactMatch: { id: number; code?: string; name: string; unit?: string } | null;
  suggestions: Array<{
    material: { id: number; code?: string; name: string; unit?: string };
    similarity: number;
    matchType: 'high' | 'medium' | 'low';
  }>;
  action: 'use_existing' | 'create_new' | 'confirm' | 'cancel';
  message: string;
};

type MaterialCandidate = {
  material: { id: number; code?: string; name: string; unit?: string };
  similarity: number;
};

type CreatePrFromMaterialCheckInput = {
  reason: string;
  lines: MaterialCheckInputLine[];
  autoSubmit?: boolean;
  createMissingMaterials?: boolean;
  cancelledLines?: number[];
};

type ApprovePrInput = {
  prId: number;
  approved?: boolean;
  note?: string;
};

type CreatePoFromAwardedQuoteInput = {
  quoteId: number;
};

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '')
    .replace(/[Ａ-Ｚａ-ｚ]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFF10))
    .replace(/[－—]/g, '-');
}

function calculateSimilarity(s1: string, s2: string): number {
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;

  const len1 = s1.length;
  const len2 = s2.length;

  if (s1.includes(s2) || s2.includes(s1)) {
    const shorter = Math.min(len1, len2);
    const longer = Math.max(len1, len2);
    return shorter / longer;
  }

  const dp: number[][] = Array(len1 + 1)
    .fill(null)
    .map(() => Array(len2 + 1).fill(0));

  for (let i = 0; i <= len1; i++) dp[i][0] = i;
  for (let j = 0; j <= len2; j++) dp[0][j] = j;

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }

  const distance = dp[len1][len2];
  const maxLen = Math.max(len1, len2);
  return 1 - distance / maxLen;
}

async function checkMaterials(client: any, lines: MaterialCheckInputLine[]): Promise<{
  canProceed: boolean;
  summary: { total: number; exactMatches: number; needConfirm: number; notFound: number };
  nextAction: 'create_pr' | 'confirm_materials' | 'all_cancelled';
  lines: MaterialMatchResult[];
}> {
  const { data: materials, error } = await client
    .from('materials')
    .select('*')
    .eq('is_active', true);

  if (error) {
    throw new Error(error.message);
  }

  const materialList = materials || [];
  const checkedLines = lines.map((line) => {
    const text = line.requirementText?.trim();
    if (!text) {
      return {
        requirementText: line.requirementText,
        found: false,
        exactMatch: null,
        suggestions: [],
        action: 'cancel',
        message: '需求描述为空',
      } satisfies MaterialMatchResult;
    }

    const normalizedText = normalizeText(text);
    const matches: MaterialCandidate[] = materialList
      .map((material: any) => {
        const nameSimilarity = calculateSimilarity(normalizedText, normalizeText(material.name || ''));
        const codeSimilarity = material.code
          ? calculateSimilarity(normalizedText, normalizeText(material.code))
          : 0;
        const similarity = Math.max(nameSimilarity, codeSimilarity);

        return {
          material: {
            id: material.id,
            code: material.code,
            name: material.name,
            unit: material.unit,
          },
          similarity,
        };
      })
      .sort((a: { similarity: number }, b: { similarity: number }) => b.similarity - a.similarity);

    const exactMatch = matches.find((match: MaterialCandidate) => match.similarity >= 0.95);
    if (exactMatch) {
      return {
        requirementText: text,
        found: true,
        exactMatch: exactMatch.material,
        suggestions: [],
        action: 'use_existing',
        message: `找到精确匹配: ${exactMatch.material.name}`,
      } satisfies MaterialMatchResult;
    }

    const suggestions = matches.filter((match: MaterialCandidate) => match.similarity >= 0.3).slice(0, 5);
    if (suggestions.length > 0) {
      return {
        requirementText: text,
        found: true,
        exactMatch: null,
        suggestions: suggestions.map((suggestion: MaterialCandidate) => ({
          ...suggestion,
          matchType: suggestion.similarity >= 0.7 ? 'high' : suggestion.similarity >= 0.5 ? 'medium' : 'low',
        })),
        action: 'confirm',
        message: `找到 ${suggestions.length} 个相似物料，请确认`,
      } satisfies MaterialMatchResult;
    }

    return {
      requirementText: text,
      found: false,
      exactMatch: null,
      suggestions: [],
      action: 'create_new',
      message: '未找到匹配物料，建议创建新物料',
    } satisfies MaterialMatchResult;
  });

  const summary = {
    total: lines.length,
    exactMatches: checkedLines.filter((line) => line.action === 'use_existing').length,
    needConfirm: checkedLines.filter((line) => line.action === 'confirm').length,
    notFound: checkedLines.filter((line) => line.action === 'create_new').length,
  };

  let nextAction: 'create_pr' | 'confirm_materials' | 'all_cancelled' = 'create_pr';
  if (summary.needConfirm > 0 || summary.notFound > 0) {
    nextAction = 'confirm_materials';
  }
  if (checkedLines.every((line) => line.action === 'cancel')) {
    nextAction = 'all_cancelled';
  }

  return {
    canProceed: summary.needConfirm === 0 && summary.notFound === 0,
    summary,
    nextAction,
    lines: checkedLines,
  };
}

async function createPurchaseRequestWithResolvedMaterials(
  ctx: ActionContext,
  reason: string,
  lines: MaterialCheckInputLine[],
  cancelledLines: number[] = [],
) {
  const activeLines = lines.filter((_, index) => !cancelledLines.includes(index));
  if (activeLines.length === 0) {
    return {
      created: false,
      message: '所有采购行已被取消，采购申请未创建',
    };
  }

  const unresolved = activeLines.filter((line) => !line.confirmedMaterialId && !line.confirmedMaterialName);
  if (unresolved.length > 0) {
    return {
      created: false,
      error: '部分行未确认物料',
      unresolvedLines: unresolved.map((line) => line.requirementText),
    };
  }

  const createdMaterials: any[] = [];
  for (const line of activeLines) {
    if (line.confirmedMaterialId || !line.confirmedMaterialName) continue;

    const { data: existing } = await ctx.client
      .from('materials')
      .select('id')
      .eq('name', line.confirmedMaterialName)
      .eq('is_active', true)
      .single();

    if (existing) {
      line.confirmedMaterialId = existing.id;
      continue;
    }

    const { data: newMaterial, error: materialError } = await ctx.client
      .from('materials')
      .insert({
        name: line.confirmedMaterialName,
        code: `NEW-${Date.now()}`,
        unit: line.confirmedMaterialUnit || '个',
        is_active: true,
      })
      .select()
      .single();

    if (materialError) {
      throw new Error(`创建物料失败: ${materialError.message}`);
    }

    line.confirmedMaterialId = newMaterial.id;
    createdMaterials.push(newMaterial);
  }

  const prNumber = await numberGenerators.pr();
  const linesSnapshot = JSON.stringify(activeLines);
  const { data: pr, error: prError } = await ctx.client
    .from('purchase_requests')
    .insert({
      pr_number: prNumber,
      applicant: ctx.actor,
      applicant_role: ctx.role,
      reason,
      status: 'draft',
      lines_snapshot: linesSnapshot,
    })
    .select()
    .single();

  if (prError || !pr) {
    throw new Error(prError?.message || '创建采购申请失败');
  }

  const prLines = activeLines.map((line, index) => ({
    request_id: pr.id,
    line_number: index + 1,
    material_id: line.confirmedMaterialId,
    material_snapshot: line.confirmedMaterialName || line.requirementText,
    requirement_text: line.requirementText,
    quantity: line.quantity,
    est_unit_price: line.estUnitPrice || null,
    expected_delivery_date: line.expectedDeliveryDate || null,
    note: line.note || null,
    progress: 'pending',
  }));

  const { error: linesError } = await ctx.client.from('purchase_request_lines').insert(prLines);
  if (linesError) {
    await ctx.client.from('purchase_requests').delete().eq('id', pr.id);
    throw new Error(linesError.message);
  }

  await ctx.client.from('audit_logs').insert({
    entity_type: 'purchase_request',
    entity_id: pr.id,
    action: 'create',
    actor: ctx.actor,
    actor_role: ctx.role,
    detail: {
      pr_number: prNumber,
      lines_count: activeLines.length,
      new_materials_created: createdMaterials.length,
      created_by_agent_action: true,
    },
  });

  const { data: createdLines } = await ctx.client
    .from('purchase_request_lines')
    .select('*')
    .eq('request_id', pr.id)
    .order('line_number', { ascending: true });

  return {
    created: true,
    data: {
      ...pr,
      lines: createdLines || [],
      new_materials: createdMaterials,
    },
  };
}

async function submitPurchaseRequest(ctx: ActionContext, prId: number) {
  if (ctx.role === 'manager') {
    throw new Error('Manager 不能提交采购申请');
  }

  const { data: existing, error: findError } = await ctx.client
    .from('purchase_requests')
    .select('*')
    .eq('id', prId)
    .single();

  if (findError || !existing) {
    throw new Error(findError?.message || '采购申请不存在');
  }

  if (existing.status !== 'draft') {
    return {
      submitted: false,
      alreadySubmitted: true,
      data: existing,
    };
  }

  const { data: lines } = await ctx.client
    .from('purchase_request_lines')
    .select('*')
    .eq('request_id', prId);

  if (!lines || lines.length === 0) {
    throw new Error('Cannot submit request without items');
  }

  const { data, error } = await ctx.client
    .from('purchase_requests')
    .update({
      status: 'pending',
      updated_at: new Date().toISOString(),
    })
    .eq('id', prId)
    .select()
    .single();

  if (error || !data) {
    throw new Error(error?.message || '提交采购申请失败');
  }

  await ctx.client.from('audit_logs').insert({
    entity_type: 'purchase_request',
    entity_id: prId,
    action: 'submit',
    actor: ctx.actor,
    actor_role: ctx.role,
    detail: { previous_status: 'draft', new_status: 'pending', created_by_agent_action: true },
  });

  let eventResult = null;
  try {
    const { data: profile } = await ctx.client
      .from('profiles')
      .select('full_name')
      .eq('id', existing.applicant)
      .single();

    eventResult = await emitPRSubmitted(
      {
        prId,
        prNumber: existing.pr_number,
        applicantId: existing.applicant,
        applicantName: profile?.full_name || undefined,
        totalAmount: existing.total_amount,
        linesCount: lines.length,
        actor: ctx.actor,
        actorRole: ctx.role,
      },
      'agent_action_create_pr',
    );
  } catch (error) {
    console.error('[AgentAction] Failed to emit PR_SUBMITTED:', error);
  }

  return {
    submitted: true,
    data: {
      ...data,
      purchase_request_lines: lines,
    },
    event: eventResult,
  };
}

async function createAutoPO(
  client: any,
  pr: any,
  lines: Array<{ line: any; fa: any; unitPrice: number }>,
  actor: string,
): Promise<any[]> {
  const createdPOs: any[] = [];
  const supplierGroups: Record<number, Array<{ line: any; fa: any; unitPrice: number }>> = {};

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
        status: 'sent',
        created_by: actor,
      })
      .select()
      .single();

    if (poError || !po) {
      console.error('[AgentAction] Failed to create auto PO:', poError);
      continue;
    }

    const poLines = supplierLines.map((item, index) => ({
      order_id: po.id,
      line_number: index + 1,
      pr_id: pr.id,
      pr_line_id: item.line.id,
      material_id: item.line.material_id,
      material_snapshot: item.line.material_snapshot || item.fa.material_snapshot,
      quantity: item.line.quantity,
      unit_price: item.unitPrice,
      total_price: Number(item.line.quantity) * item.unitPrice,
      received_qty: 0,
      pending_qty: item.line.quantity,
      status: 'ordered',
      fa_id: item.fa.id,
    }));

    const { error: linesError } = await client.from('purchase_order_lines').insert(poLines);
    if (linesError) {
      await client.from('purchase_orders').delete().eq('id', po.id);
      console.error('[AgentAction] Failed to insert auto PO lines:', linesError);
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
        created_by_agent_action: true,
      },
    });

    createdPOs.push(po);
  }

  return createdPOs;
}

async function matchFrameworkAgreements(client: any, requestId: number, actor: string) {
  const result = {
    autoPOs: [] as any[],
    sourcingTasks: [] as any[],
    faMatches: [] as any[],
  };

  const { data: pr } = await client
    .from('purchase_requests')
    .select('*')
    .eq('id', requestId)
    .single();

  if (!pr) return result;

  const { data: lines } = await client
    .from('purchase_request_lines')
    .select('*')
    .eq('request_id', requestId)
    .eq('progress', 'approved');

  const autoPOLines: Array<{ line: any; fa: any; unitPrice: number }> = [];

  for (const line of lines || []) {
    const todayShanghai = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    const { data: agreements } = await client
      .from('framework_agreements')
      .select('*')
      .eq('status', 'active')
      .lte('valid_from', todayShanghai)
      .gte('valid_to', todayShanghai);

    if (agreements && agreements.length > 0) {
      const idMatches = agreements.filter((fa: any) => fa.material_id === line.material_id && fa.material_id !== null);
      const textMatches = agreements.filter(
        (fa: any) => normalizeText(fa.material_original_text || '') === normalizeText(line.requirement_text || ''),
      );
      const allMatches = [
        ...idMatches,
        ...textMatches.filter((fa: any) => !idMatches.some((matched: any) => matched.id === fa.id)),
      ];

      if (allMatches.length > 0) {
        allMatches.sort((a: any, b: any) => Number(a.unit_price) - Number(b.unit_price));
        const best = allMatches[0];
        const isExactMatch = idMatches.some((matched: any) => matched.id === best.id);

        if (isExactMatch && line.material_id !== null) {
          autoPOLines.push({ line, fa: best, unitPrice: Number(best.unit_price) });
          result.faMatches.push({
            id: best.id,
            fa_number: best.fa_number,
            supplier_snapshot: best.supplier_snapshot,
            unit_price: Number(best.unit_price),
            match_type: 'material_id',
          });
        } else {
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
    }
  }

  if (autoPOLines.length > 0) {
    result.autoPOs = await createAutoPO(client, pr, autoPOLines, actor);
  }

  return result;
}

export async function createPRFromMaterialCheck(
  ctx: ActionContext,
  input: CreatePrFromMaterialCheckInput,
) {
  const checkResult = await checkMaterials(ctx.client, input.lines);

  const resolvedLines = input.lines.map((line, index) => {
    const checkedLine = checkResult.lines[index];
    if (!checkedLine) return { ...line };

    if (checkedLine.action === 'use_existing' && checkedLine.exactMatch) {
      return {
        ...line,
        confirmedMaterialId: line.confirmedMaterialId || checkedLine.exactMatch.id,
        confirmedMaterialName: line.confirmedMaterialName || checkedLine.exactMatch.name,
        confirmedMaterialUnit: line.confirmedMaterialUnit || checkedLine.exactMatch.unit || '个',
      };
    }

    if (checkedLine.action === 'create_new' && input.createMissingMaterials) {
      return {
        ...line,
        confirmedMaterialName: line.confirmedMaterialName || line.requirementText,
        confirmedMaterialUnit: line.confirmedMaterialUnit || '个',
      };
    }

    return { ...line };
  });

  const unresolvedLines = resolvedLines
    .map((line, index) => ({ line, check: checkResult.lines[index], index }))
    .filter(
      ({ line }) =>
        !line.confirmedMaterialId &&
        !line.confirmedMaterialName,
    )
    .map(({ check, line, index }) => ({
      index,
      requirementText: line.requirementText,
      action: check?.action || 'confirm',
      suggestions: check?.suggestions || [],
      message: check?.message || '需要确认物料',
    }));

  if (unresolvedLines.length > 0) {
    return {
      created: false,
      requiresConfirmation: true,
      materialCheck: checkResult,
      unresolvedLines,
      message: '存在需要确认的物料，未创建采购申请',
    };
  }

  const creationResult = await createPurchaseRequestWithResolvedMaterials(
    ctx,
    input.reason,
    resolvedLines,
    input.cancelledLines || [],
  );

  if (!creationResult.created) {
    return {
      ...creationResult,
      materialCheck: checkResult,
    };
  }

  let submitResult = null;
  if (input.autoSubmit) {
    submitResult = await submitPurchaseRequest(ctx, creationResult.data.id);
  }

  return {
    created: true,
    materialCheck: checkResult,
    purchaseRequest: creationResult.data,
    submitted: !!submitResult?.submitted,
    submission: submitResult,
  };
}

export async function approvePRAndHandleFA(ctx: ActionContext, input: ApprovePrInput) {
  if (!canApprove(ctx.role)) {
    throw new Error('只有 Manager 可以审批采购申请');
  }

  const approved = input.approved !== false;
  const { data: existing } = await ctx.client
    .from('purchase_requests')
    .select('id, status, pr_number, applicant')
    .eq('id', input.prId)
    .single();

  if (!existing) {
    throw new Error('Purchase request not found');
  }

  if (!['submitted', 'pending'].includes(existing.status)) {
    throw new Error(`Cannot approve request in status: ${existing.status}`);
  }

  const newStatus = approved ? 'approved' : 'rejected';
  const { error } = await ctx.client
    .from('purchase_requests')
    .update({
      status: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.prId);

  if (error) {
    throw new Error(error.message);
  }

  let approvalResult = {
    approved: false,
    autoPOs: [] as any[],
    sourcingTasks: [] as any[],
    faMatches: [] as any[],
  };

  if (approved) {
    await ctx.client
      .from('purchase_request_lines')
      .update({
        progress: 'approved',
        updated_at: new Date().toISOString(),
      })
      .eq('request_id', input.prId);

    approvalResult = {
      approved: true,
      ...(await matchFrameworkAgreements(ctx.client, input.prId, ctx.actor)),
    };
  }

  await ctx.client.from('audit_logs').insert({
    entity_type: 'purchase_request',
    entity_id: input.prId,
    action: approved ? 'approve' : 'reject',
    actor: ctx.actor,
    actor_role: ctx.role,
    detail: {
      from_status: existing.status,
      to_status: newStatus,
      note: input.note,
      created_by_agent_action: true,
      ...approvalResult,
    },
  });

  const { data: fullPR } = await ctx.client
    .from('purchase_requests')
    .select('*')
    .eq('id', input.prId)
    .single();

  const { data: lines } = await ctx.client
    .from('purchase_request_lines')
    .select('*')
    .eq('request_id', input.prId);

  emitPRApproved(
    {
      prId: existing.id,
      prNumber: existing.pr_number,
      approved,
      approverId: ctx.actor,
      approverName: undefined,
      note: input.note,
      faMatches: approvalResult.faMatches,
      sourcingTasks: approvalResult.sourcingTasks,
      autoPOs: approvalResult.autoPOs,
      actor: ctx.actor,
      actorRole: ctx.role,
    },
    'agent_action_approve_pr',
  ).catch((error) => console.error('[AgentAction] Failed to emit PR_APPROVED:', error));

  for (const task of approvalResult.sourcingTasks) {
    emitSourcingTaskCreated(
      {
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
      },
      'agent_action_approve_pr',
    ).catch((error) => console.error('[AgentAction] Failed to emit SOURCING_TASK_CREATED:', error));
  }

  for (const po of approvalResult.autoPOs) {
    emitPOCreated(
      {
        poId: po.id,
        poNumber: po.po_number,
        supplierId: po.supplier_id,
        supplierName: po.supplier_snapshot,
        prId: existing.id,
        prNumber: existing.pr_number,
        status: po.status || 'sent',
        linesCount: 1,
        actor: 'system',
        actorRole: 'system',
      },
      'agent_action_approve_pr',
    ).catch((error) => console.error('[AgentAction] Failed to emit PO_CREATED:', error));
  }

  return {
    data: {
      ...fullPR,
      purchase_request_lines: lines || [],
    },
    approval: approvalResult,
    events_published: {
      pr_approved: true,
      sourcing_tasks: approvalResult.sourcingTasks.length,
      auto_pos: approvalResult.autoPOs.length,
    },
  };
}

export async function createPOFromAwardedQuote(
  ctx: ActionContext,
  input: CreatePoFromAwardedQuoteInput,
) {
  if (!canCreatePO(ctx.role)) {
    throw new Error('只有 Buyer 或 Manager 可以授标');
  }

  const { data: quote, error: quoteError } = await ctx.client
    .from('quotes')
    .select(`
      *,
      sourcing_tasks!quotes_sourcing_task_id_fkey (
        id,
        task_number,
        pr_id,
        pr_line_id,
        material_id,
        material_snapshot
      )
    `)
    .eq('id', input.quoteId)
    .single();

  if (quoteError || !quote) {
    throw new Error(quoteError?.message || '报价单不存在');
  }

  if (quote.awarded === 'awarded') {
    const { data: existingPoLine } = await ctx.client
      .from('purchase_order_lines')
      .select('order_id')
      .eq('sourcing_task_id', quote.sourcing_task_id)
      .order('id', { ascending: false })
      .limit(1)
      .single();

    return {
      success: true,
      alreadyAwarded: true,
      quote: {
        id: quote.id,
        quote_number: quote.quote_number,
        awarded: quote.awarded,
      },
      purchaseOrderLine: existingPoLine || null,
    };
  }

  const sourcingTask = quote.sourcing_tasks;
  if (!sourcingTask) {
    throw new Error('关联的寻源任务不存在');
  }

  let deliveryDate: string;
  if (sourcingTask.pr_line_id) {
    const { data: prLine } = await ctx.client
      .from('purchase_request_lines')
      .select('expected_delivery_date')
      .eq('id', sourcingTask.pr_line_id)
      .single();

    deliveryDate =
      prLine?.expected_delivery_date ||
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  } else {
    deliveryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  }

  await ctx.client
    .from('quotes')
    .update({
      awarded: 'awarded',
      updated_at: getBeijingISOString(),
    })
    .eq('id', input.quoteId);

  await ctx.client
    .from('quotes')
    .update({ awarded: 'rejected' })
    .eq('sourcing_task_id', sourcingTask.id)
    .neq('id', input.quoteId);

  const poNumber = await numberGenerators.po();
  const { data: po, error: poError } = await ctx.client
    .from('purchase_orders')
    .insert({
      po_number: poNumber,
      supplier_id: quote.supplier_id,
      supplier_snapshot: quote.supplier_snapshot,
      delivery_date: deliveryDate,
      status: 'sent',
      created_by: ctx.actor,
      pr_id: sourcingTask.pr_id,
    })
    .select()
    .single();

  if (poError || !po) {
    throw new Error(poError?.message || '创建采购订单失败');
  }

  const { error: poLineError } = await ctx.client
    .from('purchase_order_lines')
    .insert({
      order_id: po.id,
      line_number: 1,
      pr_id: sourcingTask.pr_id,
      pr_line_id: sourcingTask.pr_line_id,
      material_id: quote.material_id || sourcingTask.material_id,
      material_snapshot: quote.material_snapshot || sourcingTask.material_snapshot,
      quantity: quote.quantity,
      unit_price: quote.unit_price,
      total_price: quote.total_price,
      received_qty: 0,
      pending_qty: quote.quantity,
      status: 'ordered',
      sourcing_task_id: sourcingTask.id,
    });

  if (poLineError) {
    await ctx.client.from('purchase_orders').delete().eq('id', po.id);
    throw new Error(poLineError.message);
  }

  await ctx.client
    .from('sourcing_tasks')
    .update({
      status: 'completed',
      updated_at: getBeijingISOString(),
    })
    .eq('id', sourcingTask.id);

  if (sourcingTask.pr_line_id) {
    await ctx.client
      .from('purchase_request_lines')
      .update({
        progress: 'ordered',
        purchase_order_id: po.id,
        po_line_number: 1,
        updated_at: getBeijingISOString(),
      })
      .eq('id', sourcingTask.pr_line_id);
  }

  await ctx.client.from('audit_logs').insert([
    {
      entity_type: 'quote',
      entity_id: input.quoteId,
      action: 'award',
      actor: ctx.actor,
      actor_role: ctx.role,
      detail: {
        quote_number: quote.quote_number,
        po_number: poNumber,
        quote_unit_price: quote.unit_price,
        quote_quantity: quote.quantity,
        created_by_agent_action: true,
      },
    },
    {
      entity_type: 'purchase_order',
      entity_id: po.id,
      action: 'create_from_award',
      actor: ctx.actor,
      actor_role: ctx.role,
      detail: {
        po_number: poNumber,
        quote_id: input.quoteId,
        quote_number: quote.quote_number,
        sourcing_task_id: sourcingTask.id,
        sourcing_task_number: sourcingTask.task_number,
        created_by_agent_action: true,
      },
    },
  ]);

  emitQuoteAwarded(
    {
      quoteId: input.quoteId,
      quoteNumber: quote.quote_number,
      sourcingTaskId: sourcingTask.id,
      sourcingTaskNumber: sourcingTask.task_number,
      prId: sourcingTask.pr_id,
      prNumber: undefined,
      supplierId: quote.supplier_id,
      supplierName: quote.supplier_snapshot || '未知供应商',
      materialSnapshot: quote.material_snapshot || sourcingTask.material_snapshot,
      quantity: quote.quantity,
      unitPrice: quote.unit_price,
      totalPrice: quote.total_price,
      autoPO: {
        poId: po.id,
        poNumber,
        status: 'sent',
      },
      actor: ctx.actor,
      actorRole: ctx.role,
    },
    'agent_action_quote_award',
  ).catch((error) => console.error('[AgentAction] Failed to emit QUOTE_AWARDED:', error));

  emitPOCreated(
    {
      poId: po.id,
      poNumber,
      supplierId: quote.supplier_id,
      supplierName: quote.supplier_snapshot || '未知供应商',
      prId: sourcingTask.pr_id,
      prNumber: undefined,
      status: 'sent',
      deliveryDate,
      linesCount: 1,
      actor: ctx.actor,
      actorRole: ctx.role,
    },
    'agent_action_quote_award',
  ).catch((error) => console.error('[AgentAction] Failed to emit PO_CREATED:', error));

  return {
    success: true,
    quote: {
      id: input.quoteId,
      quote_number: quote.quote_number,
      awarded: 'awarded',
    },
    purchaseOrder: {
      id: po.id,
      po_number: poNumber,
      status: 'sent',
      supplier_name: quote.supplier_snapshot,
      delivery_date: deliveryDate,
      total_price: quote.total_price,
    },
  };
}

export async function createActionContext(client: any, request: Request): Promise<ActionContext> {
  const identity = await (await import('@/lib/role-filter')).getUserIdentityWithLookup(request as any);
  return {
    client,
    actor: identity.actor,
    role: identity.role,
  };
}
