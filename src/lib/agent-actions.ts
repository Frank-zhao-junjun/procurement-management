import { Client as PgClient } from 'pg';
import { getDatabaseUrl } from '@/storage/database';
import { exec, queryMany, queryOne, withPgTransaction, type PgTransactionClient } from '@/lib/transactional-db';
import { numberGenerators } from '@/storage/database/number-generator';
import { getBeijingISOString } from '@/lib/datetime';
import {
  emitPOCreated,
  emitPRApproved,
  emitPRFAMatched,
  emitPRSubmitted,
  emitQuoteAwarded,
  emitGRCompleted,
  emitGROverdelivery,
  emitSourcingTaskCreated,
} from '@/lib/events';
import { canApprove, canCreatePO, type Role } from '@/lib/role-filter';
import { onContractPending } from '@/lib/agent-notify';

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

type ConfirmFAAndCreatePOInput = {
  prLineId: number;
  confirmed?: boolean;
  faId?: number;
  autoCreatePO?: boolean;
};

type ReceiveGoodsAndHandleOverdeliveryInput = {
  poLineId: number;
  poId?: number;
  quantity: number;
  grType?: 'in' | 'out';
  receiptDate?: string;
  notes?: string;
  autoApproveOverdelivery?: boolean;
  overdeliveryApproval?: boolean;
  approvalNote?: string;
};

type SubmitContractForApprovalInput = {
  contractId: number;
};

type SubmitPRInput = {
  prId: number;
};

type ApproveOverdeliveryInput = {
  goodsReceiptId: number;
  approved?: boolean;
  note?: string;
};

type AgentActionName =
  | 'create-pr-from-material-check'
  | 'approve-pr-and-handle-fa'
  | 'create-po-from-awarded-quote'
  | 'confirm-fa-and-create-po'
  | 'receive-goods-and-handle-overdelivery'
  | 'submit-contract-for-approval'
  | 'submit-pr'
  | 'approve-overdelivery'
  | 'submit-pr';

type AgentActionNextStep = {
  action: AgentActionName;
  reason: string;
  suggestedPayload?: Record<string, unknown>;
};

type AgentActionEnvelope<T> = {
  success: boolean;
  action: AgentActionName;
  data: T;
  nextActions: AgentActionNextStep[];
  warnings: string[];
  statusCode?: number;
};

type VerificationResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string };

export type AgentActionManifestItem = {
  action: AgentActionName;
  description: string;
  idempotent: boolean;
  idempotencySources: Array<'Idempotency-Key' | 'requestId' | 'request_id' | 'idempotencyKey' | 'idempotency_key'>;
  requiredRole: Array<Role | 'any_bound_actor'>;
  inputSchema: Record<string, unknown>;
  responseNotes: string[];
};

export const AGENT_ACTION_MANIFEST: AgentActionManifestItem[] = [
  {
    action: 'create-pr-from-material-check',
    description: '检查物料、创建 PR，并可选自动提交',
    idempotent: true,
    idempotencySources: ['Idempotency-Key', 'requestId', 'request_id', 'idempotencyKey', 'idempotency_key'],
    requiredRole: ['any_bound_actor'],
    inputSchema: {
      reason: 'string',
      lines: 'array',
      autoSubmit: 'boolean?',
      createMissingMaterials: 'boolean?',
      cancelledLines: 'number[]?',
    },
    responseNotes: ['可能返回 requiresConfirmation=true', 'nextActions 可能建议 submit-pr 或 approve-pr-and-handle-fa'],
  },
  {
    action: 'submit-pr',
    description: '提交已创建的采购申请进入审批流',
    idempotent: true,
    idempotencySources: ['Idempotency-Key', 'requestId', 'request_id', 'idempotencyKey', 'idempotency_key'],
    requiredRole: ['requester', 'buyer'],
    inputSchema: { prId: 'number' },
    responseNotes: ['仅允许提交 draft 状态 PR'],
  },
  {
    action: 'approve-pr-and-handle-fa',
    description: '审批 PR 并自动处理 FA / 寻源 / 自动 PO',
    idempotent: true,
    idempotencySources: ['Idempotency-Key', 'requestId', 'request_id', 'idempotencyKey', 'idempotency_key'],
    requiredRole: ['manager'],
    inputSchema: { prId: 'number', approved: 'boolean?', note: 'string?' },
    responseNotes: ['nextActions 可能建议 confirm-fa-and-create-po 或 create-po-from-awarded-quote'],
  },
  {
    action: 'confirm-fa-and-create-po',
    description: '确认或拒绝 FA 匹配，并按需创建 PO 或寻源任务',
    idempotent: true,
    idempotencySources: ['Idempotency-Key', 'requestId', 'request_id', 'idempotencyKey', 'idempotency_key'],
    requiredRole: ['buyer', 'manager'],
    inputSchema: { prLineId: 'number', faId: 'number?', confirmed: 'boolean?', autoCreatePO: 'boolean?' },
    responseNotes: ['拒绝 FA 时会创建寻源任务', '确认后可自动创建 PO'],
  },
  {
    action: 'create-po-from-awarded-quote',
    description: '授标报价单并自动创建 PO',
    idempotent: true,
    idempotencySources: ['Idempotency-Key', 'requestId', 'request_id', 'idempotencyKey', 'idempotency_key'],
    requiredRole: ['buyer', 'manager'],
    inputSchema: { quoteId: 'number' },
    responseNotes: ['会同步更新 sourcing task 和 PR line'],
  },
  {
    action: 'receive-goods-and-handle-overdelivery',
    description: '执行收货，并在超收时返回待审批或自动审批结果',
    idempotent: true,
    idempotencySources: ['Idempotency-Key', 'requestId', 'request_id', 'idempotencyKey', 'idempotency_key'],
    requiredRole: ['buyer', 'manager'],
    inputSchema: {
      poLineId: 'number',
      poId: 'number?',
      quantity: 'number',
      grType: '"in" | "out"?',
      receiptDate: 'string?',
      notes: 'string?',
      autoApproveOverdelivery: 'boolean?',
      overdeliveryApproval: 'boolean?',
      approvalNote: 'string?',
    },
    responseNotes: ['超收时 warnings 会提示审批', 'nextActions 可能建议 approve-overdelivery'],
  },
  {
    action: 'approve-overdelivery',
    description: '审批或拒绝超收收货单',
    idempotent: true,
    idempotencySources: ['Idempotency-Key', 'requestId', 'request_id', 'idempotencyKey', 'idempotency_key'],
    requiredRole: ['manager'],
    inputSchema: { goodsReceiptId: 'number', approved: 'boolean?', note: 'string?' },
    responseNotes: ['仅处理 pending_approval 状态的收货单'],
  },
  {
    action: 'submit-contract-for-approval',
    description: '提交合同进入审批并通知 manager',
    idempotent: true,
    idempotencySources: ['Idempotency-Key', 'requestId', 'request_id', 'idempotencyKey', 'idempotency_key'],
    requiredRole: ['buyer', 'manager'],
    inputSchema: { contractId: 'number' },
    responseNotes: ['仅允许 draft 合同提交'],
  },
];

function makeActionResponse<T>(
  action: AgentActionName,
  data: T,
  options: {
    success?: boolean;
    nextActions?: AgentActionNextStep[];
    warnings?: string[];
    statusCode?: number;
  } = {},
): AgentActionEnvelope<T> {
  return {
    success: options.success ?? true,
    action,
    data,
    nextActions: options.nextActions ?? [],
    warnings: options.warnings ?? [],
    statusCode: options.statusCode,
  };
}

async function verifySingleRowExists(
  client: DBClient,
  table: string,
  id: number,
): Promise<VerificationResult<Record<string, unknown>>> {
  const { data, error } = await client.from(table).select('*').eq('id', id).single();
  if (error || !data) {
    return {
      ok: false,
      reason: `写后校验失败: ${table}#${id} 未成功落库`,
    };
  }
  return { ok: true, data: data as Record<string, unknown> };
}

async function verifyRowsByField(
  client: DBClient,
  table: string,
  field: string,
  value: number,
  expectedCount: number,
): Promise<VerificationResult<Record<string, unknown>[]>> {
  const { data, error } = await client.from(table).select('*').eq(field, value);
  const rows = (data || []) as Record<string, unknown>[];
  if (error || rows.length !== expectedCount) {
    return {
      ok: false,
      reason: `写后校验失败: ${table}.${field}=${value} 期望 ${expectedCount} 行，实际 ${rows.length} 行`,
    };
  }
  return { ok: true, data: rows };
}

type IdempotentHandlerOptions = {
  action: AgentActionName;
  actor: string;
  idempotencyKey?: string | null;
};

function buildIdempotencyConfigKey(action: AgentActionName, actor: string, idempotencyKey: string): string {
  return `agent_action:${action}:${actor}:${idempotencyKey}`;
}

export async function getIdempotencyKey(request: Request, body?: Record<string, unknown>): Promise<string | null> {
  const headerKey = request.headers.get('Idempotency-Key')?.trim();
  if (headerKey) return headerKey;

  const bodyKey = body?.requestId ?? body?.request_id ?? body?.idempotencyKey ?? body?.idempotency_key;
  if (typeof bodyKey === 'string' && bodyKey.trim()) {
    return bodyKey.trim();
  }

  return null;
}

export async function runIdempotentAgentAction<T>(
  client: DBClient,
  options: IdempotentHandlerOptions,
  handler: () => Promise<AgentActionEnvelope<T>>,
): Promise<AgentActionEnvelope<T>> {
  const { action, actor, idempotencyKey } = options;
  if (!idempotencyKey) {
    return handler();
  }

  const configKey = buildIdempotencyConfigKey(action, actor, idempotencyKey);
  const { data: existing } = await client
    .from('system_configs')
    .select('config_value')
    .eq('config_key', configKey)
    .single();

  if (existing?.config_value) {
    try {
      const parsed = JSON.parse(existing.config_value);
      return {
        ...(parsed as AgentActionEnvelope<T>),
        warnings: [
          ...(((parsed as AgentActionEnvelope<T>).warnings || []) as string[]),
          `幂等命中: ${idempotencyKey}`,
        ],
      };
    } catch {
      // ignore broken cache and recompute
    }
  }

  const result = await handler();

  await client
    .from('system_configs')
    .upsert({
      config_key: configKey,
      config_value: JSON.stringify(result),
      description: `Idempotent cache for ${action}`,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'config_key',
    });

  return result;
}

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

  const transactionalResult = await tryCreatePurchaseRequestInTransaction(ctx, reason, activeLines);
  if (transactionalResult) {
    return transactionalResult;
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

  const prVerify = await verifySingleRowExists(ctx.client, 'purchase_requests', pr.id);
  if (!prVerify.ok) {
    await ctx.client.from('purchase_request_lines').delete().eq('request_id', pr.id);
    await ctx.client.from('purchase_requests').delete().eq('id', pr.id);
    throw new Error(prVerify.reason);
  }

  const prLinesVerify = await verifyRowsByField(
    ctx.client,
    'purchase_request_lines',
    'request_id',
    pr.id,
    prLines.length,
  );
  if (!prLinesVerify.ok) {
    await ctx.client.from('purchase_request_lines').delete().eq('request_id', pr.id);
    await ctx.client.from('purchase_requests').delete().eq('id', pr.id);
    throw new Error(prLinesVerify.reason);
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

async function tryCreatePurchaseRequestInTransaction(
  ctx: ActionContext,
  reason: string,
  activeLines: MaterialCheckInputLine[],
): Promise<
  | {
      created: true;
      data: Record<string, unknown>;
    }
  | null
> {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    return null;
  }

  const pg = new PgClient({ connectionString: databaseUrl });
  await pg.connect();

  try {
    await pg.query('BEGIN');

    const resolvedLines = [...activeLines];
    const createdMaterials: Array<Record<string, unknown>> = [];

    for (const line of resolvedLines) {
      if (line.confirmedMaterialId || !line.confirmedMaterialName) continue;

      const existingMaterial = await pg.query(
        'SELECT id, name, unit FROM materials WHERE name = $1 AND is_active = true LIMIT 1',
        [line.confirmedMaterialName],
      );

      if (existingMaterial.rowCount && existingMaterial.rows[0]) {
        line.confirmedMaterialId = existingMaterial.rows[0].id as number;
        continue;
      }

      const insertMaterial = await pg.query(
        `INSERT INTO materials (name, code, unit, is_active, created_at)
         VALUES ($1, $2, $3, true, NOW())
         RETURNING id, code, name, unit`,
        [line.confirmedMaterialName, `NEW-${Date.now()}`, line.confirmedMaterialUnit || '个'],
      );

      if (!insertMaterial.rowCount || !insertMaterial.rows[0]) {
        throw new Error('事务内创建物料失败');
      }

      line.confirmedMaterialId = insertMaterial.rows[0].id as number;
      createdMaterials.push(insertMaterial.rows[0] as Record<string, unknown>);
    }

    const prNumber = await numberGenerators.pr();
    const linesSnapshot = JSON.stringify(resolvedLines);

    const insertPR = await pg.query(
      `INSERT INTO purchase_requests (
        pr_number, applicant, applicant_role, reason, status, lines_snapshot, created_at
      ) VALUES ($1, $2, $3, $4, 'draft', $5, NOW())
      RETURNING *`,
      [prNumber, ctx.actor, ctx.role, reason, linesSnapshot],
    );

    if (!insertPR.rowCount || !insertPR.rows[0]) {
      throw new Error('事务内创建采购申请失败');
    }

    const pr = insertPR.rows[0] as Record<string, unknown>;
    const prId = Number(pr.id);
    if (!Number.isInteger(prId) || prId <= 0) {
      throw new Error('事务内创建采购申请后未返回有效 ID');
    }

    for (let index = 0; index < resolvedLines.length; index += 1) {
      const line = resolvedLines[index];
      await pg.query(
        `INSERT INTO purchase_request_lines (
          request_id, line_number, material_id, material_snapshot, requirement_text,
          quantity, est_unit_price, expected_delivery_date, note, progress, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', NOW())`,
        [
          prId,
          index + 1,
          line.confirmedMaterialId,
          line.confirmedMaterialName || line.requirementText,
          line.requirementText,
          line.quantity,
          line.estUnitPrice || null,
          line.expectedDeliveryDate || null,
          line.note || null,
        ],
      );
    }

    const linesCountResult = await pg.query(
      'SELECT * FROM purchase_request_lines WHERE request_id = $1 ORDER BY line_number ASC',
      [prId],
    );
    if (linesCountResult.rowCount !== resolvedLines.length) {
      throw new Error('事务内 PR 行写入数量与预期不一致');
    }

    await pg.query(
      `INSERT INTO audit_logs (
        entity_type, entity_id, action, actor, actor_role, detail, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())`,
      [
        'purchase_request',
        prId,
        'create',
        ctx.actor,
        ctx.role,
        JSON.stringify({
          pr_number: prNumber,
          lines_count: resolvedLines.length,
          new_materials_created: createdMaterials.length,
          created_by_agent_action: true,
          transaction_mode: 'pg',
        }),
      ],
    );

    await pg.query('COMMIT');

    return {
      created: true,
      data: {
        ...pr,
        lines: linesCountResult.rows,
        new_materials: createdMaterials,
        transaction_mode: 'pg',
      },
    };
  } catch (error) {
    await pg.query('ROLLBACK');
    throw error;
  } finally {
    await pg.end();
  }
}

async function tryCreatePOInTransaction(
  ctx: ActionContext,
  input: {
    supplierId: number;
    supplierSnapshot: string;
    deliveryDate: string | null;
    status: 'draft' | 'sent';
    prId?: number | null;
    prLineId?: number | null;
    materialId?: number | null;
    materialSnapshot: string;
    quantity: number | string;
    unitPrice: number | string;
    totalPrice: number | string;
    faId?: number | null;
    sourcingTaskId?: number | null;
    quoteId?: number | null;
    quoteNumber?: string | null;
    actorRole: Role;
    auditAction: 'create_from_fa' | 'create_from_award';
    auditDetail: Record<string, unknown>;
    updatePrLine?: {
      id: number;
      progress: string;
      poLineNumber: number;
    };
    updateSourcingTask?: {
      id: number;
      status: string;
    };
  },
): Promise<
  | {
      po: Record<string, unknown>;
      poLine: Record<string, unknown>;
      transaction_mode: 'pg';
    }
  | null
> {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    return null;
  }

  const pg = new PgClient({ connectionString: databaseUrl });
  await pg.connect();

  try {
    await pg.query('BEGIN');

    const poNumber = await numberGenerators.po();
    const insertPO = await pg.query(
      `INSERT INTO purchase_orders (
        po_number, supplier_id, supplier_snapshot, delivery_date, status, created_by, pr_id, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING *`,
      [
        poNumber,
        input.supplierId,
        input.supplierSnapshot,
        input.deliveryDate,
        input.status,
        ctx.actor,
        input.prId ?? null,
      ],
    );

    if (!insertPO.rowCount || !insertPO.rows[0]) {
      throw new Error('事务内创建采购订单失败');
    }

    const po = insertPO.rows[0] as Record<string, unknown>;
    const poId = Number(po.id);
    if (!Number.isInteger(poId) || poId <= 0) {
      throw new Error('事务内创建采购订单后未返回有效 ID');
    }

    const insertPOLine = await pg.query(
      `INSERT INTO purchase_order_lines (
        order_id, line_number, pr_id, pr_line_id, material_id, material_snapshot,
        quantity, unit_price, total_price, received_qty, pending_qty, status, fa_id, sourcing_task_id, created_at
      ) VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, 0, $9, 'ordered', $10, $11, NOW())
      RETURNING *`,
      [
        poId,
        input.prId ?? null,
        input.prLineId ?? null,
        input.materialId ?? null,
        input.materialSnapshot,
        input.quantity,
        input.unitPrice,
        input.totalPrice,
        input.quantity,
        input.faId ?? null,
        input.sourcingTaskId ?? null,
      ],
    );

    if (!insertPOLine.rowCount || !insertPOLine.rows[0]) {
      throw new Error('事务内创建采购订单行失败');
    }

    const poLine = insertPOLine.rows[0] as Record<string, unknown>;

    if (input.updatePrLine) {
      await pg.query(
        `UPDATE purchase_request_lines
         SET progress = $1, purchase_order_id = $2, po_line_number = $3, updated_at = NOW()
         WHERE id = $4`,
        [
          input.updatePrLine.progress,
          poId,
          input.updatePrLine.poLineNumber,
          input.updatePrLine.id,
        ],
      );
    }

    if (input.updateSourcingTask) {
      await pg.query(
        `UPDATE sourcing_tasks
         SET status = $1, updated_at = NOW()
         WHERE id = $2`,
        [input.updateSourcingTask.status, input.updateSourcingTask.id],
      );
    }

    await pg.query(
      `INSERT INTO audit_logs (
        entity_type, entity_id, action, actor, actor_role, detail, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())`,
      [
        'purchase_order',
        poId,
        input.auditAction,
        ctx.actor,
        input.actorRole,
        JSON.stringify({
          po_number: poNumber,
          transaction_mode: 'pg',
          created_by_agent_action: true,
          ...input.auditDetail,
        }),
      ],
    );

    if (input.quoteId) {
      await pg.query(
        `INSERT INTO audit_logs (
          entity_type, entity_id, action, actor, actor_role, detail, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())`,
        [
          'quote',
          input.quoteId,
          'award',
          ctx.actor,
          input.actorRole,
          JSON.stringify({
            quote_number: input.quoteNumber,
            po_number: poNumber,
            created_by_agent_action: true,
            transaction_mode: 'pg',
          }),
        ],
      );
    }

    await pg.query('COMMIT');

    return {
      po: {
        ...po,
        po_number: poNumber,
      },
      poLine,
      transaction_mode: 'pg',
    };
  } catch (error) {
    await pg.query('ROLLBACK');
    throw error;
  } finally {
    await pg.end();
  }
}

async function calculateNextPOStatusInTransaction(tx: PgTransactionClient, poId: number): Promise<string> {
  const poLines = await queryMany<{ status: string }>(
    tx,
    'SELECT status FROM purchase_order_lines WHERE order_id = $1',
    [poId],
  );

  const statuses = poLines.map((row) => String(row.status));
  if (statuses.length === 0) return 'draft';
  if (statuses.every((status) => status === 'received')) return 'received';
  if (statuses.some((status) => status === 'partial_received' || status === 'received')) return 'partial';
  if (statuses.every((status) => status === 'ordered')) return 'sent';
  return 'draft';
}

async function tryReceiveGoodsInTransaction(
  ctx: ActionContext,
  input: {
    poLineId: number;
    poId?: number;
    quantity: number;
    grType: 'in' | 'out';
    receiptDate: string;
    receiptTime: string;
    notes?: string;
    autoApproveOverdelivery?: boolean;
    overdeliveryApproval?: boolean;
    approvalNote?: string;
  },
): Promise<
  | {
      goodsReceipt: Record<string, unknown>;
      requiresApproval: boolean;
      approval: Record<string, unknown> | null;
      transaction_mode: 'pg';
      warning?: string;
    }
  | null
> {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    return null;
  }

  const pg = new PgClient({ connectionString: databaseUrl });
  await pg.connect();

  try {
    await pg.query('BEGIN');

    const poLineResult = await pg.query(
      'SELECT * FROM purchase_order_lines WHERE id = $1 FOR UPDATE',
      [input.poLineId],
    );
    if (!poLineResult.rowCount || !poLineResult.rows[0]) {
      throw new Error(`采购订单行不存在 (ID: ${input.poLineId})`);
    }

    const poLine = poLineResult.rows[0] as Record<string, unknown>;
    const poId = Number(input.poId ?? poLine.order_id);
    const poHeaderResult = await pg.query(
      'SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE',
      [poId],
    );
    if (!poHeaderResult.rowCount || !poHeaderResult.rows[0]) {
      throw new Error(`采购订单不存在 (ID: ${poId})`);
    }

    const orderQty = Number(poLine.quantity);
    const currentReceived = Number(poLine.received_qty || 0);
    const newReceivedQty =
      input.grType === 'out'
        ? Math.max(0, currentReceived - input.quantity)
        : currentReceived + input.quantity;
    const pendingQty = Math.max(0, orderQty - newReceivedQty);

    let isOverdelivery = false;
    let overdeliveryRatio = 0;
    if (input.grType === 'in' && newReceivedQty > orderQty) {
      overdeliveryRatio = (newReceivedQty - orderQty) / orderQty;
      isOverdelivery = overdeliveryRatio > 0.05;
    }

    const grNumber = await numberGenerators[input.grType === 'out' ? 'rt' : 'gr']();
    const insertGR = await pg.query(
      `INSERT INTO goods_receipts (
        gr_number, po_id, po_line_id, gr_type, quantity, receipt_date, receipt_time,
        receiver, notes, status, is_overdelivery, overdelivery_ratio, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
      RETURNING *`,
      [
        grNumber,
        poId,
        input.poLineId,
        input.grType,
        input.quantity,
        input.receiptDate,
        input.receiptTime,
        ctx.actor,
        input.notes || null,
        isOverdelivery ? 'pending_approval' : 'completed',
        isOverdelivery,
        overdeliveryRatio,
      ],
    );

    if (!insertGR.rowCount || !insertGR.rows[0]) {
      throw new Error('事务内创建收货单失败');
    }

    const goodsReceipt = insertGR.rows[0] as Record<string, unknown>;
    let approval: Record<string, unknown> | null = null;
    let warning: string | undefined;

    if (isOverdelivery) {
      warning = '超收超过5%，需要 Manager 审批';

      if (input.autoApproveOverdelivery && canApprove(ctx.role)) {
        const approved = input.overdeliveryApproval !== false;
        if (approved) {
          const lineStatus = pendingQty === 0 ? 'received' : 'partial_received';
          await pg.query(
            `UPDATE goods_receipts
             SET status = 'approved', approved_by = $1, approved_at = NOW()
             WHERE id = $2`,
            [ctx.actor, goodsReceipt.id],
          );
          await pg.query(
            `UPDATE purchase_order_lines
             SET received_qty = $1, pending_qty = $2, status = $3, updated_at = NOW()
             WHERE id = $4`,
            [newReceivedQty, pendingQty, lineStatus, input.poLineId],
          );

          const nextPOStatus = await calculateNextPOStatusInTransaction(pg, poId);
          await pg.query(
            `UPDATE purchase_orders SET status = $1, updated_at = NOW() WHERE id = $2`,
            [nextPOStatus, poId],
          );

          if (poLine.pr_line_id) {
            await pg.query(
              `UPDATE purchase_request_lines
               SET progress = $1, updated_at = NOW()
               WHERE id = $2`,
              [pendingQty === 0 ? 'received' : 'partial_received', Number(poLine.pr_line_id)],
            );
          }

          approval = {
            goodsReceiptId: goodsReceipt.id,
            approved: true,
            status: 'approved',
            note: input.approvalNote,
            newReceivedQty,
            pendingQty,
            lineStatus,
          };
        } else {
          await pg.query(
            `UPDATE goods_receipts
             SET status = 'rejected', approved_by = $1, approved_at = NOW()
             WHERE id = $2`,
            [ctx.actor, goodsReceipt.id],
          );
          approval = {
            goodsReceiptId: goodsReceipt.id,
            approved: false,
            status: 'rejected',
            note: input.approvalNote,
          };
        }
      }
    } else {
      const lineStatus = pendingQty === 0 ? 'received' : newReceivedQty > 0 ? 'partial_received' : 'ordered';
      await pg.query(
        `UPDATE purchase_order_lines
         SET received_qty = $1, pending_qty = $2, status = $3, updated_at = NOW()
         WHERE id = $4`,
        [newReceivedQty, pendingQty, lineStatus, input.poLineId],
      );

      const nextPOStatus = await calculateNextPOStatusInTransaction(pg, poId);
      await pg.query(
        `UPDATE purchase_orders SET status = $1, updated_at = NOW() WHERE id = $2`,
        [nextPOStatus, poId],
      );

      if (poLine.pr_line_id) {
        await pg.query(
          `UPDATE purchase_request_lines
           SET progress = $1, updated_at = NOW()
           WHERE id = $2`,
          [pendingQty === 0 ? 'received' : 'partial_received', Number(poLine.pr_line_id)],
        );
      }
    }

    await pg.query(
      `INSERT INTO audit_logs (
        entity_type, entity_id, action, actor, actor_role, detail, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())`,
      [
        'goods_receipt',
        Number(goodsReceipt.id),
        input.grType === 'out' ? 'return' : 'receive',
        ctx.actor,
        ctx.role,
        JSON.stringify({
          gr_number: grNumber,
          po_id: poId,
          po_line_id: input.poLineId,
          quantity: input.quantity,
          gr_type: input.grType,
          receipt_date: input.receiptDate,
          new_received_qty: newReceivedQty,
          pending_qty: pendingQty,
          transaction_mode: 'pg',
          created_by_agent_action: true,
        }),
      ],
    );

    await pg.query('COMMIT');

    return {
      goodsReceipt,
      requiresApproval: isOverdelivery && !approval,
      approval,
      transaction_mode: 'pg',
      warning,
    };
  } catch (error) {
    await pg.query('ROLLBACK');
    throw error;
  } finally {
    await pg.end();
  }
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

    const poVerify = await verifySingleRowExists(client, 'purchase_orders', po.id);
    const poLinesVerify = await verifyRowsByField(client, 'purchase_order_lines', 'order_id', po.id, poLines.length);
    if (!poVerify.ok || !poLinesVerify.ok) {
      await client.from('purchase_order_lines').delete().eq('order_id', po.id);
      await client.from('purchase_orders').delete().eq('id', po.id);
      const verifyReason = !poVerify.ok
        ? poVerify.reason
        : !poLinesVerify.ok
          ? poLinesVerify.reason
          : 'unknown verification error';
      console.error('[AgentAction] Auto PO verification failed:', verifyReason);
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

async function tryApprovePRAndHandleFAInTransaction(
  ctx: ActionContext,
  input: ApprovePrInput,
): Promise<
  | {
      existing: Record<string, unknown>;
      fullPR: Record<string, unknown>;
      lines: Record<string, unknown>[];
      approvalResult: {
        approved: boolean;
        autoPOs: Array<Record<string, unknown>>;
        sourcingTasks: Array<Record<string, unknown>>;
        faMatches: Array<Record<string, unknown>>;
      };
      transaction_mode: 'pg';
    }
  | null
> {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    return null;
  }

  const approved = input.approved !== false;
  const pg = new PgClient({ connectionString: databaseUrl });
  await pg.connect();

  try {
    await pg.query('BEGIN');

    const existingResult = await pg.query(
      'SELECT id, status, pr_number, applicant FROM purchase_requests WHERE id = $1 FOR UPDATE',
      [input.prId],
    );
    if (!existingResult.rowCount || !existingResult.rows[0]) {
      throw new Error('Purchase request not found');
    }

    const existing = existingResult.rows[0] as Record<string, unknown>;
    const currentStatus = String(existing.status);
    if (!['submitted', 'pending'].includes(currentStatus)) {
      throw new Error(`Cannot approve request in status: ${currentStatus}`);
    }

    const newStatus = approved ? 'approved' : 'rejected';
    await pg.query(
      `UPDATE purchase_requests
       SET status = $1, updated_at = NOW()
       WHERE id = $2`,
      [newStatus, input.prId],
    );

    const approvalResult = {
      approved: false,
      autoPOs: [] as Array<Record<string, unknown>>,
      sourcingTasks: [] as Array<Record<string, unknown>>,
      faMatches: [] as Array<Record<string, unknown>>,
    };

    if (approved) {
      await pg.query(
        `UPDATE purchase_request_lines
         SET progress = 'approved', updated_at = NOW()
         WHERE request_id = $1`,
        [input.prId],
      );

      const linesResult = await pg.query(
        'SELECT * FROM purchase_request_lines WHERE request_id = $1 AND progress = $2 ORDER BY line_number ASC',
        [input.prId, 'approved'],
      );
      const prLines = linesResult.rows as Array<Record<string, unknown>>;

      const todayShanghai = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());

      const agreementsResult = await pg.query(
        `SELECT * FROM framework_agreements
         WHERE status = 'active'
           AND valid_from <= $1
           AND valid_to >= $1`,
        [todayShanghai],
      );
      const agreements = agreementsResult.rows as Array<Record<string, unknown>>;

      const supplierBuckets = new Map<
        number,
        Array<{ line: Record<string, unknown>; fa: Record<string, unknown>; unitPrice: number }>
      >();

      for (const line of prLines) {
        const materialId = line.material_id == null ? null : Number(line.material_id);
        const idMatches = agreements.filter(
          (fa) => fa.material_id != null && materialId != null && Number(fa.material_id) === materialId,
        );
        const textMatches = agreements.filter(
          (fa) =>
            normalizeText(String(fa.material_original_text || '')) ===
            normalizeText(String(line.requirement_text || '')),
        );
        const allMatches = [
          ...idMatches,
          ...textMatches.filter((fa) => !idMatches.some((matched) => matched.id === fa.id)),
        ].sort((a, b) => Number(a.unit_price) - Number(b.unit_price));

        if (allMatches.length > 0) {
          const best = allMatches[0];
          const isExactMatch = idMatches.some((matched) => matched.id === best.id);

          if (isExactMatch && materialId !== null) {
            const supplierId = Number(best.supplier_id);
            if (!supplierBuckets.has(supplierId)) {
              supplierBuckets.set(supplierId, []);
            }
            supplierBuckets.get(supplierId)!.push({
              line,
              fa: best,
              unitPrice: Number(best.unit_price),
            });
            approvalResult.faMatches.push({
              id: Number(best.id),
              fa_number: String(best.fa_number),
              supplier_snapshot: String(best.supplier_snapshot || ''),
              unit_price: Number(best.unit_price),
              match_type: 'material_id',
            });
          } else {
            await pg.query(
              `UPDATE purchase_request_lines
               SET progress = 'pending_confirm',
                   material_id = $1,
                   material_snapshot = $2,
                   match_confirm = 'pending',
                   matched_fa_id = $3,
                   updated_at = NOW()
               WHERE id = $4`,
              [best.material_id, best.material_snapshot, best.id, line.id],
            );
            approvalResult.faMatches.push({
              id: Number(best.id),
              fa_number: String(best.fa_number),
              supplier_snapshot: String(best.supplier_snapshot || ''),
              unit_price: Number(best.unit_price),
              match_type: 'text_similarity',
              requires_confirmation: true,
            });
          }
          continue;
        }

        const taskNumber = await numberGenerators.sc();
        const sourcingTaskResult = await pg.query(
          `INSERT INTO sourcing_tasks (
            task_number, pr_id, pr_line_id, material_id, material_snapshot,
            requirement_text, status, created_by, created_at
          ) VALUES ($1, $2, $3, NULL, $4, $5, 'pending', 'system', NOW())
          RETURNING *`,
          [taskNumber, input.prId, line.id, line.requirement_text, line.requirement_text],
        );

        if (!sourcingTaskResult.rowCount || !sourcingTaskResult.rows[0]) {
          throw new Error('事务内创建寻源任务失败');
        }

        const sourcingTask = sourcingTaskResult.rows[0] as Record<string, unknown>;
        approvalResult.sourcingTasks.push(sourcingTask);

        await pg.query(
          `UPDATE purchase_request_lines
           SET progress = 'sourced',
               sourcing_task_id = $1,
               updated_at = NOW()
           WHERE id = $2`,
          [sourcingTask.id, line.id],
        );

        await pg.query(
          `INSERT INTO audit_logs (
            entity_type, entity_id, action, actor, actor_role, detail, created_at
          ) VALUES ($1, $2, $3, 'system', 'system', $4::jsonb, NOW())`,
          [
            'purchase_request_line',
            line.id,
            'create_sourcing_task',
            JSON.stringify({
              sourcing_task_id: sourcingTask.id,
              task_number: taskNumber,
              transaction_mode: 'pg',
            }),
          ],
        );
      }

      for (const [supplierId, supplierLines] of supplierBuckets.entries()) {
        const first = supplierLines[0];
        const transactionalPO = await tryCreatePOInTransaction(ctx, {
          supplierId,
          supplierSnapshot: String(first.fa.supplier_snapshot || ''),
          deliveryDate: null,
          status: 'sent',
          prId: input.prId,
          prLineId: Number(first.line.id),
          materialId: first.line.material_id == null ? null : Number(first.line.material_id),
          materialSnapshot: String(first.line.material_snapshot || first.fa.material_snapshot || ''),
          quantity: first.line.quantity as number | string,
          unitPrice: first.unitPrice,
          totalPrice: Number(first.line.quantity) * first.unitPrice,
          faId: Number(first.fa.id),
          actorRole: ctx.role,
          auditAction: 'create_from_fa',
          auditDetail: {
            pr_id: input.prId,
            pr_number: String(existing.pr_number || ''),
            supplier_id: supplierId,
            supplier_snapshot: String(first.fa.supplier_snapshot || ''),
            lines_count: supplierLines.length,
            created_by_agent_action: true,
          },
          updatePrLine: {
            id: Number(first.line.id),
            progress: 'ordered',
            poLineNumber: 1,
          },
        });

        if (!transactionalPO) {
          throw new Error('审批事务依赖的 PO 事务能力不可用');
        }

        for (let index = 1; index < supplierLines.length; index += 1) {
          const item = supplierLines[index];
          await pg.query(
            `INSERT INTO purchase_order_lines (
              order_id, line_number, pr_id, pr_line_id, material_id, material_snapshot,
              quantity, unit_price, total_price, received_qty, pending_qty, status, fa_id, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, $10, 'ordered', $11, NOW())`,
            [
              transactionalPO.po.id,
              index + 1,
              input.prId,
              item.line.id,
              item.line.material_id,
              item.line.material_snapshot || item.fa.material_snapshot,
              item.line.quantity,
              item.unitPrice,
              Number(item.line.quantity) * item.unitPrice,
              item.line.quantity,
              item.fa.id,
            ],
          );
          await pg.query(
            `UPDATE purchase_request_lines
             SET progress = 'ordered',
                 purchase_order_id = $1,
                 po_line_number = $2,
                 matched_fa_id = $3,
                 updated_at = NOW()
             WHERE id = $4`,
            [transactionalPO.po.id, index + 1, item.fa.id, item.line.id],
          );
        }

        approvalResult.autoPOs.push({
          ...transactionalPO.po,
          po_number: transactionalPO.po.po_number,
        });
      }

      approvalResult.approved = true;
    }

    await pg.query(
      `INSERT INTO audit_logs (
        entity_type, entity_id, action, actor, actor_role, detail, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())`,
      [
        'purchase_request',
        input.prId,
        approved ? 'approve' : 'reject',
        ctx.actor,
        ctx.role,
        JSON.stringify({
          from_status: currentStatus,
          to_status: newStatus,
          note: input.note,
          created_by_agent_action: true,
          transaction_mode: 'pg',
          ...approvalResult,
        }),
      ],
    );

    const fullPRResult = await pg.query(
      'SELECT * FROM purchase_requests WHERE id = $1',
      [input.prId],
    );
    const fullPR = fullPRResult.rows[0] as Record<string, unknown>;
    const linesResult = await pg.query(
      'SELECT * FROM purchase_request_lines WHERE request_id = $1 ORDER BY line_number ASC',
      [input.prId],
    );

    await pg.query('COMMIT');

    return {
      existing,
      fullPR,
      lines: linesResult.rows as Record<string, unknown>[],
      approvalResult,
      transaction_mode: 'pg',
    };
  } catch (error) {
    await pg.query('ROLLBACK');
    throw error;
  } finally {
    await pg.end();
  }
}

async function _deprecated_tryApprovePRInTransaction(
  ctx: ActionContext,
  input: ApprovePrInput,
): Promise<
  | {
      data: Record<string, unknown>;
      approval: {
        approved: boolean;
        autoPOs: any[];
        sourcingTasks: any[];
        faMatches: any[];
      };
      events_published: {
        pr_approved: true;
        sourcing_tasks: number;
        auto_pos: number;
      };
      transaction_mode: 'pg';
    }
  | null
> {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    return null;
  }

  const pg = new PgClient({ connectionString: databaseUrl });
  await pg.connect();

  try {
    await pg.query('BEGIN');

    const approved = input.approved !== false;
    const existingResult = await pg.query(
      'SELECT id, status, pr_number, applicant FROM purchase_requests WHERE id = $1 FOR UPDATE',
      [input.prId],
    );
    if (!existingResult.rowCount || !existingResult.rows[0]) {
      throw new Error('Purchase request not found');
    }

    const existing = existingResult.rows[0] as Record<string, unknown>;
    const currentStatus = String(existing.status);
    if (!['submitted', 'pending'].includes(currentStatus)) {
      throw new Error(`Cannot approve request in status: ${currentStatus}`);
    }

    const newStatus = approved ? 'approved' : 'rejected';
    await pg.query(
      'UPDATE purchase_requests SET status = $1, updated_at = NOW() WHERE id = $2',
      [newStatus, input.prId],
    );

    const approvalResult = {
      approved: false,
      autoPOs: [] as any[],
      sourcingTasks: [] as any[],
      faMatches: [] as any[],
    };

    if (approved) {
      await pg.query(
        'UPDATE purchase_request_lines SET progress = $1, updated_at = NOW() WHERE request_id = $2',
        ['approved', input.prId],
      );

      const prResult = await pg.query('SELECT * FROM purchase_requests WHERE id = $1', [input.prId]);
      const pr = prResult.rows[0] as Record<string, unknown> | undefined;
      if (!pr) {
        throw new Error('事务内审批后未找到采购申请');
      }

      const lineResult = await pg.query(
        'SELECT * FROM purchase_request_lines WHERE request_id = $1 AND progress = $2 ORDER BY id ASC',
        [input.prId, 'approved'],
      );

      const autoPOGroups = new Map<number, Array<{
        line: Record<string, unknown>;
        fa: Record<string, unknown>;
        unitPrice: number;
      }>>();

      for (const line of lineResult.rows as Array<Record<string, unknown>>) {
        const todayShanghai = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date());

        const agreementsResult = await pg.query(
          `SELECT * FROM framework_agreements
           WHERE status = 'active'
             AND valid_from <= $1
             AND valid_to >= $1`,
          [todayShanghai],
        );

        const agreements = agreementsResult.rows as Array<Record<string, unknown>>;
        const idMatches = agreements.filter(
          (fa) => fa.material_id === line.material_id && fa.material_id !== null,
        );
        const textMatches = agreements.filter(
          (fa) =>
            normalizeText(String(fa.material_original_text || '')) ===
            normalizeText(String(line.requirement_text || '')),
        );
        const allMatches = [
          ...idMatches,
          ...textMatches.filter((fa) => !idMatches.some((matched) => matched.id === fa.id)),
        ];

        if (allMatches.length > 0) {
          allMatches.sort((a, b) => Number(a.unit_price) - Number(b.unit_price));
          const best = allMatches[0];
          const isExactMatch = idMatches.some((matched) => matched.id === best.id);

          if (isExactMatch && line.material_id !== null) {
            const supplierId = Number(best.supplier_id);
            const list = autoPOGroups.get(supplierId) || [];
            list.push({
              line,
              fa: best,
              unitPrice: Number(best.unit_price),
            });
            autoPOGroups.set(supplierId, list);
            approvalResult.faMatches.push({
              id: best.id,
              fa_number: best.fa_number,
              supplier_snapshot: best.supplier_snapshot,
              unit_price: Number(best.unit_price),
              match_type: 'material_id',
            });
          } else {
            await pg.query(
              `UPDATE purchase_request_lines
               SET progress = 'pending_confirm',
                   material_id = $1,
                   material_snapshot = $2,
                   match_confirm = 'pending',
                   matched_fa_id = $3,
                   updated_at = NOW()
               WHERE id = $4`,
              [best.material_id, best.material_snapshot, best.id, line.id],
            );
            approvalResult.faMatches.push({
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

        const taskNumber = await numberGenerators.sc();
        const sourcingTaskResult = await pg.query(
          `INSERT INTO sourcing_tasks (
             task_number, pr_id, pr_line_id, material_id, material_snapshot,
             requirement_text, status, created_by, created_at
           ) VALUES ($1, $2, $3, NULL, $4, $5, 'pending', 'system', NOW())
           RETURNING *`,
          [taskNumber, input.prId, line.id, line.requirement_text, line.requirement_text],
        );
        const sourcingTask = sourcingTaskResult.rows[0] as Record<string, unknown> | undefined;
        if (!sourcingTask) {
          throw new Error('事务内创建寻源任务失败');
        }

        approvalResult.sourcingTasks.push(sourcingTask);
        await pg.query(
          `UPDATE purchase_request_lines
           SET progress = 'sourced', sourcing_task_id = $1, updated_at = NOW()
           WHERE id = $2`,
          [sourcingTask.id, line.id],
        );
      }

      for (const [supplierId, groupedLines] of autoPOGroups.entries()) {
        const poNumber = await numberGenerators.po();
        const supplierName = String(groupedLines[0].fa.supplier_snapshot || '');
        const insertPO = await pg.query(
          `INSERT INTO purchase_orders (
             po_number, supplier_id, supplier_snapshot, pr_id, status, created_by, created_at
           ) VALUES ($1, $2, $3, $4, 'sent', $5, NOW())
           RETURNING *`,
          [poNumber, supplierId, supplierName, input.prId, ctx.actor],
        );
        const po = insertPO.rows[0] as Record<string, unknown> | undefined;
        if (!po) {
          throw new Error('事务内自动创建采购订单失败');
        }

        const poId = Number(po.id);
        for (let index = 0; index < groupedLines.length; index += 1) {
          const item = groupedLines[index];
          await pg.query(
            `INSERT INTO purchase_order_lines (
               order_id, line_number, pr_id, pr_line_id, material_id, material_snapshot,
               quantity, unit_price, total_price, received_qty, pending_qty, status, fa_id, created_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, $10, 'ordered', $11, NOW())`,
            [
              poId,
              index + 1,
              input.prId,
              item.line.id,
              item.line.material_id,
              item.line.material_snapshot || item.fa.material_snapshot,
              item.line.quantity,
              item.unitPrice,
              Number(item.line.quantity) * item.unitPrice,
              item.line.quantity,
              item.fa.id,
            ],
          );

          await pg.query(
            `UPDATE purchase_request_lines
             SET progress = 'ordered',
                 purchase_order_id = $1,
                 po_line_number = $2,
                 matched_fa_id = $3,
                 updated_at = NOW()
             WHERE id = $4`,
            [poId, index + 1, item.fa.id, item.line.id],
          );
        }

        approvalResult.autoPOs.push(po);
      }

      approvalResult.approved = true;
    }

    await pg.query(
      `INSERT INTO audit_logs (
         entity_type, entity_id, action, actor, actor_role, detail, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())`,
      [
        'purchase_request',
        input.prId,
        approved ? 'approve' : 'reject',
        ctx.actor,
        ctx.role,
        JSON.stringify({
          from_status: currentStatus,
          to_status: newStatus,
          note: input.note,
          created_by_agent_action: true,
          transaction_mode: 'pg',
          ...approvalResult,
        }),
      ],
    );

    const fullPRResult = await pg.query('SELECT * FROM purchase_requests WHERE id = $1', [input.prId]);
    const fullPR = fullPRResult.rows[0] as Record<string, unknown> | undefined;
    const linesResult = await pg.query(
      'SELECT * FROM purchase_request_lines WHERE request_id = $1 ORDER BY line_number ASC',
      [input.prId],
    );

    await pg.query('COMMIT');

    return {
      data: {
        ...(fullPR || {}),
        purchase_request_lines: linesResult.rows,
      },
      approval: approvalResult,
      events_published: {
        pr_approved: true,
        sourcing_tasks: approvalResult.sourcingTasks.length,
        auto_pos: approvalResult.autoPOs.length,
      },
      transaction_mode: 'pg',
    };
  } catch (error) {
    await pg.query('ROLLBACK');
    throw error;
  } finally {
    await pg.end();
  }
}

export async function createPRFromMaterialCheck(
  ctx: ActionContext,
  input: CreatePrFromMaterialCheckInput,
): Promise<AgentActionEnvelope<Record<string, unknown>>> {
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
    const data = {
      created: false,
      requiresConfirmation: true,
      materialCheck: checkResult,
      unresolvedLines,
      message: '存在需要确认的物料，未创建采购申请',
    };
    return wrapActionResult('create-pr-from-material-check', data, {
      nextActions: inferNextActions('create-pr-from-material-check', data),
      warnings: ['存在需确认物料，当前未创建采购申请'],
    });
  }

  const creationResult = await createPurchaseRequestWithResolvedMaterials(
    ctx,
    input.reason,
    resolvedLines,
    input.cancelledLines || [],
  );

  if (!creationResult.created) {
    const data = {
      ...creationResult,
      materialCheck: checkResult,
    };
    return wrapActionResult('create-pr-from-material-check', data, {
      nextActions: inferNextActions('create-pr-from-material-check', data),
      warnings: creationResult.message ? [creationResult.message] : [],
    });
  }

  let submitResult = null;
  if (input.autoSubmit) {
    submitResult = await submitPurchaseRequest(ctx, creationResult.data.id);
  }

  const data = {
    created: true,
    materialCheck: checkResult,
    purchaseRequest: creationResult.data,
    submitted: !!submitResult?.submitted,
    submission: submitResult,
  };
  return wrapActionResult('create-pr-from-material-check', data, {
    nextActions: inferNextActions('create-pr-from-material-check', data),
  });
}

export async function approvePRAndHandleFA(
  ctx: ActionContext,
  input: ApprovePrInput,
): Promise<AgentActionEnvelope<Record<string, unknown>>> {
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

  const transactionalApproval = await tryApprovePRAndHandleFAInTransaction(ctx, input);
  let newStatus = approved ? 'approved' : 'rejected';
  let approvalResult = {
    approved: false,
    autoPOs: [] as any[],
    sourcingTasks: [] as any[],
    faMatches: [] as any[],
  };
  let fullPR: any;
  let lines: any[] | null = null;

  if (transactionalApproval) {
    newStatus = String(transactionalApproval.fullPR.status || newStatus);
    approvalResult = transactionalApproval.approvalResult;
    fullPR = transactionalApproval.fullPR;
    lines = transactionalApproval.lines;
  } else {
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

    const prResult = await ctx.client
      .from('purchase_requests')
      .select('*')
      .eq('id', input.prId)
      .single();
    fullPR = prResult.data;

    const linesResult = await ctx.client
      .from('purchase_request_lines')
      .select('*')
      .eq('request_id', input.prId);
    lines = linesResult.data;
  }

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

  const data = {
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
  return wrapActionResult('approve-pr-and-handle-fa', data, {
    nextActions: inferNextActions('approve-pr-and-handle-fa', data),
  });
}

export async function createPOFromAwardedQuote(
  ctx: ActionContext,
  input: CreatePoFromAwardedQuoteInput,
): Promise<AgentActionEnvelope<Record<string, unknown>>> {
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

    const data = {
      success: true,
      alreadyAwarded: true,
      quote: {
        id: quote.id,
        quote_number: quote.quote_number,
        awarded: quote.awarded,
      },
      purchaseOrderLine: existingPoLine || null,
    };
    return wrapActionResult('create-po-from-awarded-quote', data, {
      nextActions: inferNextActions('create-po-from-awarded-quote', data),
      warnings: ['报价单已授标，返回现有订单线索'],
    });
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

  const transactionalPO = await tryCreatePOInTransaction(ctx, {
    supplierId: Number(quote.supplier_id),
    supplierSnapshot: quote.supplier_snapshot,
    deliveryDate,
    status: 'sent',
    prId: sourcingTask.pr_id,
    prLineId: sourcingTask.pr_line_id,
    materialId: quote.material_id || sourcingTask.material_id,
    materialSnapshot: quote.material_snapshot || sourcingTask.material_snapshot,
    quantity: Number(quote.quantity),
    unitPrice: Number(quote.unit_price),
    totalPrice: Number(quote.total_price),
    sourcingTaskId: sourcingTask.id,
    updatePrLine: sourcingTask.pr_line_id
      ? {
          id: sourcingTask.pr_line_id,
          progress: 'ordered',
          poLineNumber: 1,
        }
      : undefined,
    updateSourcingTask: {
      id: sourcingTask.id,
      status: 'completed',
    },
    auditAction: 'create_from_award',
    auditDetail: {
      quote_id: input.quoteId,
      quote_number: quote.quote_number,
      sourcing_task_id: sourcingTask.id,
      sourcing_task_number: sourcingTask.task_number,
      created_by_agent_action: true,
    },
    quoteId: input.quoteId,
    quoteNumber: quote.quote_number,
    actorRole: ctx.role,
  });

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

  let po = transactionalPO?.po;
  let poNumber = transactionalPO?.po?.po_number as string | undefined;

  if (!transactionalPO) {
    const fallbackPoNumber = await numberGenerators.po();
    const { data: createdPo, error: poError } = await ctx.client
      .from('purchase_orders')
      .insert({
        po_number: fallbackPoNumber,
        supplier_id: quote.supplier_id,
        supplier_snapshot: quote.supplier_snapshot,
        delivery_date: deliveryDate,
        status: 'sent',
        created_by: ctx.actor,
        pr_id: sourcingTask.pr_id,
      })
      .select()
      .single();

    if (poError || !createdPo) {
      throw new Error(poError?.message || '创建采购订单失败');
    }

    const { error: poLineError } = await ctx.client
      .from('purchase_order_lines')
      .insert({
        order_id: createdPo.id,
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
      await ctx.client.from('purchase_orders').delete().eq('id', createdPo.id);
      throw new Error(poLineError.message);
    }

    const poVerify = await verifySingleRowExists(ctx.client, 'purchase_orders', createdPo.id);
    const poLinesVerify = await verifyRowsByField(
      ctx.client,
      'purchase_order_lines',
      'order_id',
      createdPo.id,
      1,
    );
    if (!poVerify.ok || !poLinesVerify.ok) {
      await ctx.client.from('purchase_order_lines').delete().eq('order_id', createdPo.id);
      await ctx.client.from('purchase_orders').delete().eq('id', createdPo.id);
      throw new Error(!poVerify.ok ? poVerify.reason : (poLinesVerify as { ok: false; reason: string }).reason);
    }

    po = createdPo;
    poNumber = fallbackPoNumber;
  }

  await ctx.client
    .from('sourcing_tasks')
    .update({
      status: 'completed',
      updated_at: getBeijingISOString(),
    })
    .eq('id', sourcingTask.id);

  if (sourcingTask.pr_line_id && po) {
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

  await ctx.client.from('audit_logs').insert({
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
  });

  const poId = Number(po!.id);

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
        poId,
        poNumber: poNumber!,
        status: 'sent',
      },
      actor: ctx.actor,
      actorRole: ctx.role,
    },
    'agent_action_quote_award',
  ).catch((error) => console.error('[AgentAction] Failed to emit QUOTE_AWARDED:', error));

  emitPOCreated(
    {
      poId,
      poNumber: poNumber!,
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

  const data = {
    success: true,
    quote: {
      id: input.quoteId,
      quote_number: quote.quote_number,
      awarded: 'awarded',
    },
    purchaseOrder: {
      id: po!.id,
      po_number: poNumber!,
      status: 'sent',
      supplier_name: quote.supplier_snapshot,
      delivery_date: deliveryDate,
      total_price: quote.total_price,
    },
  };
  return wrapActionResult('create-po-from-awarded-quote', data, {
    nextActions: inferNextActions('create-po-from-awarded-quote', data),
  });
}

export async function createActionContext(client: any, request: Request): Promise<ActionContext> {
  const identity = await (await import('@/lib/role-filter')).getUserIdentityWithLookup(request as any);
  return {
    client,
    actor: identity.actor,
    role: identity.role,
  };
}

export async function submitPRAction(
  ctx: ActionContext,
  input: SubmitPRInput,
): Promise<AgentActionEnvelope<Record<string, unknown>>> {
  const submission = await submitPurchaseRequest(ctx, input.prId);
  const data = {
    prId: input.prId,
    submission,
  };
  return wrapActionResult('submit-pr', data, {
    nextActions: inferNextActions('create-pr-from-material-check', {
      submitted: submission?.submitted,
    }),
    statusCode: submission?.submitted ? 200 : 200,
  });
}

export async function approveOverdelivery(
  ctx: ActionContext,
  input: ApproveOverdeliveryInput,
): Promise<AgentActionEnvelope<Record<string, unknown>>> {
  const approved = input.approved !== false;
  const approval = await approveOverdeliveryInAction(ctx, input.goodsReceiptId, approved, input.note);
  const data = {
    goodsReceiptId: input.goodsReceiptId,
    approval,
  };
  return wrapActionResult('approve-overdelivery', data, {
    statusCode: 200,
  });
}

function wrapActionResult<T>(
  action: AgentActionName,
  data: T,
  options: {
    statusCode?: number;
    nextActions?: AgentActionNextStep[];
    warnings?: string[];
  } = {},
): AgentActionEnvelope<T> {
  return {
    success: true,
    action,
    data,
    nextActions: options.nextActions || [],
    warnings: options.warnings || [],
  };
}

function inferNextActions(action: string, data: any): AgentActionNextStep[] {
  switch (action) {
    case 'create-pr-from-material-check':
      if (data?.requiresConfirmation) {
        return [
          {
            action: 'confirm-fa-and-create-po',
            reason: '仍有物料需要确认，补充 confirmedMaterialId/confirmedMaterialName 后重试创建 PR',
            suggestedPayload: {
              linesNeedingConfirmation: data.unresolvedLines || [],
            },
          },
        ];
      }
      if (data?.submitted) {
        return [
          {
            action: 'approve-pr-and-handle-fa',
            reason: 'PR 已提交，等待 manager agent 审批并触发后续 FA/寻源/PO 流程',
          },
        ];
      }
      return [
        {
          action: 'submit-pr',
          reason: 'PR 已创建但未提交，可继续提交进入审批流',
        },
      ];
    case 'approve-pr-and-handle-fa':
      if (data?.approval?.faMatches?.some((match: any) => match.requires_confirmation)) {
        return [
          {
            action: 'confirm-fa-and-create-po',
            reason: '存在待确认 FA 匹配，请按 prLineId + faId 继续确认',
            suggestedPayload: {
              faMatches: data.approval.faMatches.filter((match: any) => match.requires_confirmation),
            },
          },
        ];
      }
      if ((data?.approval?.sourcingTasks?.length || 0) > 0) {
        return [
          {
            action: 'create-po-from-awarded-quote',
            reason: '已生成寻源任务，后续报价授标后可自动创建 PO',
            suggestedPayload: {
              sourcingTasks: data.approval.sourcingTasks,
            },
          },
        ];
      }
      return [];
    case 'confirm-fa-and-create-po':
      if (data?.poCreated) {
        return [
          {
            action: 'receive-goods-and-handle-overdelivery',
            reason: 'PO 已创建，可继续执行收货动作',
            suggestedPayload: {
              poId: data.purchaseOrder?.id,
              poLineId: data.purchaseOrder?.poLineId,
            },
          },
        ];
      }
      if (data?.sourcingTaskCreated) {
        return [
          {
            action: 'create-po-from-awarded-quote',
            reason: '已创建寻源任务，报价授标后可自动创建 PO',
            suggestedPayload: {
              sourcingTaskId: data.sourcingTask?.id,
            },
          },
        ];
      }
      return [];
    case 'create-po-from-awarded-quote':
      return [
        {
          action: 'receive-goods-and-handle-overdelivery',
          reason: 'PO 已生成，可继续执行收货并自动处理超收',
          suggestedPayload: {
            poId: data?.purchaseOrder?.id,
            poNumber: data?.purchaseOrder?.po_number,
          },
        },
      ];
    case 'receive-goods-and-handle-overdelivery':
      if (data?.requiresApproval && data?.goodsReceipt?.id) {
        return [
          {
            action: 'receive-goods-and-handle-overdelivery',
            reason: '收货超收超过阈值，等待 manager agent 审批超收',
            suggestedPayload: {
              goodsReceiptId: data.goodsReceipt.id,
              autoApproveOverdelivery: true,
              overdeliveryApproval: true,
            },
          },
        ];
      }
      return [];
    case 'submit-contract-for-approval':
      return [];
    default:
      return [];
  }
}

export async function confirmFAAndCreatePO(
  ctx: ActionContext,
  input: ConfirmFAAndCreatePOInput,
): Promise<AgentActionEnvelope<Record<string, unknown>>> {
  if (!canCreatePO(ctx.role)) {
    throw new Error('只有 Buyer 或 Manager 可以确认 FA 并创建 PO');
  }

  const { data: prLine, error: lineError } = await ctx.client
    .from('purchase_request_lines')
    .select('*, purchase_requests(*)')
    .eq('id', input.prLineId)
    .single();

  if (lineError || !prLine) {
    throw new Error(lineError?.message || 'PR line not found');
  }

  if (input.confirmed === false) {
    const taskNumber = await numberGenerators.sc();
    await ctx.client
      .from('purchase_request_lines')
      .update({
        match_confirm: 'rejected',
        matched_fa_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.prLineId);

    const { data: sourcingTask, error: scError } = await ctx.client
      .from('sourcing_tasks')
      .insert({
        task_number: taskNumber,
        pr_id: prLine.request_id,
        pr_line_id: prLine.id,
        material_id: null,
        material_snapshot: prLine.requirement_text,
        requirement_text: prLine.requirement_text,
        status: 'pending',
        created_by: ctx.actor,
      })
      .select()
      .single();

    if (scError) {
      throw new Error(scError.message);
    }

    await ctx.client
      .from('purchase_request_lines')
      .update({
        progress: 'sourced',
        sourcing_task_id: sourcingTask.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.prLineId);

    await ctx.client.from('audit_logs').insert({
      entity_type: 'purchase_request_line',
      entity_id: input.prLineId,
      action: 'reject_fa_create_sc',
      actor: ctx.actor,
      actor_role: ctx.role,
      detail: {
        sourcing_task_id: sourcingTask.id,
        task_number: taskNumber,
        created_by_agent_action: true,
      },
    });

    const data = {
      prLineId: input.prLineId,
      confirmed: false,
      sourcingTaskCreated: true,
      sourcingTask,
    };

    return wrapActionResult('confirm-fa-and-create-po', data, {
      nextActions: inferNextActions('confirm-fa-and-create-po', data),
    });
  }

  const targetFaId = input.faId || prLine.matched_fa_id;
  if (!targetFaId) {
    throw new Error('No FA matched. Please match first.');
  }

  const { data: fa, error: faError } = await ctx.client
    .from('framework_agreements')
    .select('*')
    .eq('id', targetFaId)
    .single();

  if (faError || !fa) {
    throw new Error(faError?.message || 'FA not found');
  }

  await ctx.client
    .from('purchase_request_lines')
    .update({
      progress: 'matched_protocol',
      material_id: fa.material_id,
      material_snapshot: fa.material_snapshot,
      match_confirm: 'confirmed',
      matched_fa_id: targetFaId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.prLineId);

  await ctx.client.from('audit_logs').insert({
    entity_type: 'purchase_request_line',
    entity_id: input.prLineId,
    action: 'confirm_fa',
    actor: ctx.actor,
    actor_role: ctx.role,
    detail: {
      fa_id: targetFaId,
      fa_number: fa.fa_number,
      unit_price: fa.unit_price,
      created_by_agent_action: true,
    },
  });

  let poCreated = false;
  let poResult: { success: boolean; poId?: number; poNumber?: string; error?: string } | null = null;

  if (input.autoCreatePO !== false) {
    const poNumber = await numberGenerators.po();
    const deliveryDate = prLine.expected_delivery_date ?? prLine.expectedDeliveryDate ?? null;

    const { data: po, error: poError } = await ctx.client
      .from('purchase_orders')
      .insert({
        po_number: poNumber,
        supplier_id: fa.supplier_id,
        supplier_snapshot: fa.supplier_snapshot,
        delivery_date: deliveryDate,
        status: 'draft',
        created_by: ctx.actor,
      })
      .select()
      .single();

    if (poError || !po) {
      throw new Error(poError?.message || 'Failed to create PO');
    }

    const { error: lineInsertError } = await ctx.client
      .from('purchase_order_lines')
      .insert({
        order_id: po.id,
        line_number: 1,
        pr_id: prLine.request_id,
        pr_line_id: prLine.id,
        material_id: fa.material_id,
        material_snapshot: fa.material_snapshot,
        quantity: prLine.quantity,
        unit_price: fa.unit_price,
        total_price: Number(fa.unit_price) * Number(prLine.quantity),
        received_qty: 0,
        pending_qty: prLine.quantity,
        status: 'ordered',
        fa_id: fa.id,
      });

    if (lineInsertError) {
      await ctx.client.from('purchase_orders').delete().eq('id', po.id);
      throw new Error(lineInsertError.message);
    }

    await ctx.client
      .from('purchase_request_lines')
      .update({
        progress: 'ordered',
        purchase_order_id: po.id,
        po_line_number: 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', prLine.id);

    await ctx.client.from('audit_logs').insert({
      entity_type: 'purchase_order',
      entity_id: po.id,
      action: 'create_from_fa',
      actor: ctx.actor,
      actor_role: ctx.role,
      detail: {
        po_number: poNumber,
        fa_id: fa.id,
        pr_line_id: prLine.id,
        created_by_agent_action: true,
      },
    });

    emitPRFAMatched(
      {
        prId: prLine.request_id,
        prNumber: '',
        prLineId: prLine.id,
        faId: fa.id,
        faNumber: fa.fa_number,
        supplierId: fa.supplier_id,
        supplierName: fa.supplier_snapshot,
        materialId: fa.material_id,
        materialSnapshot: fa.material_snapshot,
        unitPrice: Number(fa.unit_price),
        quantity: prLine.quantity,
        matchType: 'material_id',
        actor: ctx.actor,
        actorRole: ctx.role,
      },
      'agent_action_confirm_fa',
    ).catch((error) => console.error('[AgentAction] Failed to emit PR_FA_MATCHED:', error));

    emitPOCreated(
      {
        poId: po.id,
        poNumber,
        supplierId: fa.supplier_id,
        supplierName: fa.supplier_snapshot,
        prId: prLine.request_id,
        prNumber: undefined,
        status: 'draft',
        linesCount: 1,
        actor: ctx.actor,
        actorRole: ctx.role,
      },
      'agent_action_confirm_fa',
    ).catch((error) => console.error('[AgentAction] Failed to emit PO_CREATED:', error));

    poCreated = true;
    poResult = { success: true, poId: po.id, poNumber };
  }

  const data = {
    prLineId: input.prLineId,
    confirmed: true,
    faId: targetFaId,
    poCreated,
    po: poResult,
  };

  return wrapActionResult('confirm-fa-and-create-po', data, {
    nextActions: inferNextActions('confirm-fa-and-create-po', data),
  });
}

async function updatePOStatusForReceipt(client: DBClient, poId: number) {
  const { data: lines } = await client
    .from('purchase_order_lines')
    .select('status')
    .eq('order_id', poId);

  if (!lines || lines.length === 0) return;

  const statuses = (lines as Array<{ status: string }>).map((line) => line.status);
  let newStatus = 'draft';
  if (statuses.every((status) => status === 'received')) {
    newStatus = 'received';
  } else if (statuses.some((status) => status === 'partial_received' || status === 'received')) {
    newStatus = 'partial';
  } else if (statuses.every((status) => status === 'ordered')) {
    newStatus = 'sent';
  }

  await client
    .from('purchase_orders')
    .update({
      status: newStatus,
      updated_at: getBeijingISOString(),
    })
    .eq('id', poId);
}

async function approveOverdeliveryInAction(
  ctx: ActionContext,
  goodsReceiptId: number,
  approved: boolean,
  note?: string,
) {
  if (!canApprove(ctx.role)) {
    throw new Error('只有 Manager 可以审批超收');
  }

  const { data: gr, error: grError } = await ctx.client
    .from('goods_receipts')
    .select('*')
    .eq('id', goodsReceiptId)
    .eq('status', 'pending_approval')
    .single();

  if (grError || !gr) {
    throw new Error(grError?.message || '收货单不存在或不在待审批状态');
  }

  const { data: poLine, error: poLineError } = await ctx.client
    .from('purchase_order_lines')
    .select('*')
    .eq('id', gr.po_line_id)
    .single();

  if (poLineError || !poLine) {
    throw new Error(poLineError?.message || '采购订单行不存在');
  }

  const orderQty = Number(poLine.quantity);
  const grQty = Number(gr.quantity);

  if (approved) {
    await ctx.client
      .from('goods_receipts')
      .update({
        status: 'approved',
        approved_by: ctx.actor,
        approved_at: new Date().toISOString(),
      })
      .eq('id', goodsReceiptId);

    const oldReceived = Number(poLine.received_qty || '0');
    const newReceivedQty = oldReceived + grQty;
    const pendingQty = Math.max(0, orderQty - newReceivedQty);
    const lineStatus = pendingQty === 0 ? 'received' : 'partial_received';

    await ctx.client
      .from('purchase_order_lines')
      .update({
        received_qty: newReceivedQty,
        pending_qty: pendingQty,
        status: lineStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', gr.po_line_id);

    await updatePOStatusForReceipt(ctx.client, gr.po_id);

    return {
      goodsReceiptId,
      approved: true,
      status: 'approved',
      note,
      newReceivedQty,
      pendingQty,
      lineStatus,
    };
  }

  await ctx.client
    .from('goods_receipts')
    .update({
      status: 'rejected',
      approved_by: ctx.actor,
      approved_at: new Date().toISOString(),
    })
    .eq('id', goodsReceiptId);

  return {
    goodsReceiptId,
    approved: false,
    status: 'rejected',
    note,
  };
}

export async function receiveGoodsAndHandleOverdelivery(
  ctx: ActionContext,
  input: ReceiveGoodsAndHandleOverdeliveryInput,
): Promise<AgentActionEnvelope<Record<string, unknown>>> {
  if (!canCreatePO(ctx.role)) {
    throw new Error('只有 Buyer 或 Manager 可以执行收货动作');
  }

  const poLineId = Number(input.poLineId);
  if (!Number.isInteger(poLineId) || poLineId <= 0) {
    throw new Error('poLineId 必须为正整数');
  }

  const grQuantity = Number(input.quantity);
  if (Number.isNaN(grQuantity) || grQuantity <= 0) {
    throw new Error('quantity 必须为正数');
  }

  const grType = input.grType || 'in';
  const receiptDate = input.receiptDate || new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const receiptTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date());

  const transactionalReceipt = await tryReceiveGoodsInTransaction(ctx, {
    poLineId,
    poId: input.poId,
    quantity: grQuantity,
    grType,
    receiptDate,
    receiptTime,
    notes: input.notes,
    autoApproveOverdelivery: input.autoApproveOverdelivery,
    overdeliveryApproval: input.overdeliveryApproval,
    approvalNote: input.approvalNote,
  });

  if (transactionalReceipt) {
    const warnings = transactionalReceipt.warning ? [transactionalReceipt.warning] : [];
    const data = {
      goodsReceipt: transactionalReceipt.goodsReceipt,
      requiresApproval: transactionalReceipt.requiresApproval && !transactionalReceipt.approval,
      approval: transactionalReceipt.approval,
      transaction_mode: transactionalReceipt.transaction_mode,
      overdeliveryRatio: transactionalReceipt.requiresApproval
        ? transactionalReceipt.goodsReceipt.overdelivery_ratio ?? null
        : null,
    };

    if (transactionalReceipt.requiresApproval) {
      emitGROverdelivery(
        {
          grId: Number(transactionalReceipt.goodsReceipt.id),
          grNumber: String(transactionalReceipt.goodsReceipt.gr_number),
          poId: Number(transactionalReceipt.goodsReceipt.po_id),
          poNumber: '',
          poLineId: Number(transactionalReceipt.goodsReceipt.po_line_id),
          materialSnapshot: '',
          orderedQty: 0,
          receivedQty: 0,
          overdeliveryQty: 0,
          overdeliveryRatio: Number(transactionalReceipt.goodsReceipt.overdelivery_ratio || 0),
          grStatus: String(transactionalReceipt.goodsReceipt.status) as 'pending_approval' | 'approved' | 'rejected',
          actor: ctx.actor,
          actorRole: ctx.role,
        },
        'agent_action_receive_goods',
      ).catch((error) => console.error('[AgentAction] Failed to emit GR_OVERDELIVERY:', error));
    } else {
      emitGRCompleted(
        {
          grId: Number(transactionalReceipt.goodsReceipt.id),
          grNumber: String(transactionalReceipt.goodsReceipt.gr_number),
          poId: Number(transactionalReceipt.goodsReceipt.po_id),
          poNumber: '',
          poLineId: Number(transactionalReceipt.goodsReceipt.po_line_id),
          materialSnapshot: '',
          orderedQty: 0,
          receivedQty: grQuantity,
          cumulativeReceivedQty: 0,
          pendingQty: 0,
          isFullyReceived: false,
          overdeliveryRatio: undefined,
          actor: ctx.actor,
          actorRole: ctx.role,
        },
        'agent_action_receive_goods',
      ).catch((error) => console.error('[AgentAction] Failed to emit GR_COMPLETED:', error));
    }

    return wrapActionResult('receive-goods-and-handle-overdelivery', data, {
      nextActions: inferNextActions('receive-goods-and-handle-overdelivery', data),
      warnings,
    });
  }

  const { data: poLine, error: poLineError } = await ctx.client
    .from('purchase_order_lines')
    .select('*')
    .eq('id', poLineId)
    .single();

  if (poLineError || !poLine) {
    throw new Error(poLineError?.message || `采购订单行不存在 (ID: ${poLineId})`);
  }

  const orderQty = Number(poLine.quantity);
  const currentReceived = Number(poLine.received_qty || '0');
  const newReceivedQty =
    grType === 'out'
      ? Math.max(0, currentReceived - grQuantity)
      : currentReceived + grQuantity;
  const pendingQty = Math.max(0, orderQty - newReceivedQty);

  let isOverdelivery = false;
  let overdeliveryRatio = 0;
  if (grType === 'in' && newReceivedQty > orderQty) {
    overdeliveryRatio = (newReceivedQty - orderQty) / orderQty;
    isOverdelivery = overdeliveryRatio > 0.05;
  }

  const grNumber = await numberGenerators[grType === 'out' ? 'rt' : 'gr']();
  const { data: goodsReceipt, error: grError } = await ctx.client
    .from('goods_receipts')
    .insert({
      gr_number: grNumber,
      po_id: input.poId || poLine.order_id,
      po_line_id: poLineId,
      gr_type: grType,
      quantity: grQuantity,
      receipt_date: receiptDate,
      receipt_time: receiptTime,
      receiver: ctx.actor,
      notes: input.notes || null,
      status: isOverdelivery ? 'pending_approval' : undefined,
      is_overdelivery: isOverdelivery,
      overdelivery_ratio: overdeliveryRatio,
    })
    .select()
    .single();

  if (grError || !goodsReceipt) {
    throw new Error(grError?.message || '创建收货单失败');
  }

  const warnings: string[] = [];
  let approval = null;

  if (isOverdelivery) {
    warnings.push('超收超过5%，需要 Manager 审批');
    emitGROverdelivery(
      {
        grId: goodsReceipt.id,
        grNumber,
        poId: poLine.order_id,
        poNumber: '',
        poLineId,
        materialSnapshot: poLine.material_snapshot || '',
        orderedQty: orderQty,
        receivedQty: newReceivedQty,
        overdeliveryQty: newReceivedQty - orderQty,
        overdeliveryRatio,
        grStatus: 'pending_approval',
        actor: ctx.actor,
        actorRole: ctx.role,
      },
      'agent_action_receive_goods',
    ).catch((error) => console.error('[AgentAction] Failed to emit GR_OVERDELIVERY:', error));

    if (input.autoApproveOverdelivery && canApprove(ctx.role)) {
      approval = await approveOverdeliveryInAction(
        ctx,
        goodsReceipt.id,
        input.overdeliveryApproval !== false,
        input.approvalNote,
      );
    }
  } else {
    await ctx.client
      .from('purchase_order_lines')
      .update({
        received_qty: newReceivedQty,
        pending_qty: pendingQty,
        status: pendingQty === 0 ? 'received' : newReceivedQty > 0 ? 'partial_received' : 'ordered',
        updated_at: getBeijingISOString(),
      })
      .eq('id', poLineId);

    await updatePOStatusForReceipt(ctx.client, poLine.order_id);

    if (poLine.pr_line_id) {
      await ctx.client
        .from('purchase_request_lines')
        .update({
          progress: pendingQty === 0 ? 'received' : 'partial_received',
          updated_at: getBeijingISOString(),
        })
        .eq('id', poLine.pr_line_id);
    }

    emitGRCompleted(
      {
        grId: goodsReceipt.id,
        grNumber,
        poId: poLine.order_id,
        poNumber: '',
        poLineId,
        materialSnapshot: poLine.material_snapshot || '',
        orderedQty: orderQty,
        receivedQty: grQuantity,
        cumulativeReceivedQty: newReceivedQty,
        pendingQty,
        isFullyReceived: pendingQty === 0,
        overdeliveryRatio: undefined,
        actor: ctx.actor,
        actorRole: ctx.role,
      },
      'agent_action_receive_goods',
    ).catch((error) => console.error('[AgentAction] Failed to emit GR_COMPLETED:', error));
  }

  const data = {
    goodsReceipt,
    requiresApproval: isOverdelivery && !approval,
    approval,
    overdeliveryRatio: isOverdelivery ? overdeliveryRatio : null,
  };

  return wrapActionResult('receive-goods-and-handle-overdelivery', data, {
    nextActions: inferNextActions('receive-goods-and-handle-overdelivery', data),
    warnings,
  });
}

export async function submitContractForApproval(
  ctx: ActionContext,
  input: SubmitContractForApprovalInput,
): Promise<AgentActionEnvelope<Record<string, unknown>>> {
  const { data: existing, error: findError } = await ctx.client
    .from('contracts')
    .select('*')
    .eq('id', input.contractId)
    .single();

  if (findError || !existing) {
    throw new Error(findError?.message || 'Contract not found');
  }

  if (existing.status !== 'draft') {
    throw new Error('Only draft contracts can be submitted');
  }

  const { data, error } = await ctx.client
    .from('contracts')
    .update({
      status: 'pending',
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.contractId)
    .select()
    .single();

  if (error || !data) {
    throw new Error(error?.message || '提交框架协议失败');
  }

  await ctx.client.from('audit_logs').insert({
    entity_type: 'contract',
    entity_id: input.contractId,
    action: 'submit',
    actor: ctx.actor,
    actor_role: ctx.role,
    detail: {
      previous_status: 'draft',
      new_status: 'pending',
      created_by_agent_action: true,
    },
  });

  const { onContractPending } = await import('@/lib/agent-notify');
  let notification = null;
  try {
    notification = await onContractPending(input.contractId);
  } catch (error) {
    console.error('[AgentAction] Failed to notify contract pending:', error);
  }

  const wrapped = wrapActionResult(
    'submit-contract-for-approval',
    {
      contract: data,
      notification,
    },
    {
      nextActions: inferNextActions('submit-contract-for-approval', data),
    },
  );

  return wrapped;
}
