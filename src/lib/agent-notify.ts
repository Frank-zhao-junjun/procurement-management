/**
 * 业务事件 Webhook 通知
 *
 * 统一通过 sendWebhook / notifyManagers / notifyBuyers 发送，并写入 webhook_logs。
 */

import { getSupabaseClient } from '@/storage/database';
import {
  notifyManagers,
  notifyBuyers,
  type WebhookResult,
} from '@/lib/webhook';

export type WebhookNotifyResult = {
  success: boolean;
  results: WebhookResult[];
};

function summarizeResults(results: WebhookResult[]): WebhookNotifyResult {
  return {
    success: results.some(r => r.success),
    results,
  };
}

/**
 * PR 提交 → 通知所有配置了 Webhook 的 Manager
 */
export async function onPRSubmitted(prId: number): Promise<WebhookNotifyResult> {
  const client = getSupabaseClient();
  const { data: pr } = await client
    .from('purchase_requests')
    .select('*, applicant:profiles(full_name)')
    .eq('id', prId)
    .single();

  if (!pr) {
    return { success: false, results: [] };
  }

  const results = await notifyManagers(
    'pr_submitted',
    {
      pr_id: pr.id,
      pr_number: pr.pr_number,
      applicant_name: (pr as { applicant?: { full_name?: string } }).applicant?.full_name,
      total_amount: pr.total_amount,
    },
    { entityType: 'purchase_request', entityId: pr.id }
  );

  return summarizeResults(results);
}

/**
 * PO 创建 → 通知所有配置了 Webhook 的 Buyer
 */
export async function onPOCreated(poId: number): Promise<WebhookNotifyResult> {
  const client = getSupabaseClient();
  const { data: po } = await client
    .from('purchase_orders')
    .select('*')
    .eq('id', poId)
    .single();

  if (!po) {
    return { success: false, results: [] };
  }

  const snap = po.supplier_snapshot;
  const supplierName =
    typeof snap === 'string'
      ? snap
      : (snap as { name?: string } | null)?.name ?? '';

  const results = await notifyBuyers(
    'po_created',
    {
      po_id: po.id,
      po_number: po.po_number,
      supplier_name: supplierName,
      expected_delivery_date: po.expected_delivery_date ?? po.delivery_date,
    },
    { entityType: 'purchase_order', entityId: po.id }
  );

  return summarizeResults(results);
}

/**
 * 待收货相关（预留：可由收货流程调用）
 */
export async function onGRPending(grId: number): Promise<WebhookNotifyResult> {
  const client = getSupabaseClient();
  const { data: gr } = await client
    .from('goods_receipts')
    .select('*, purchase_order:purchase_orders(po_number)')
    .eq('id', grId)
    .single();

  if (!gr) {
    return { success: false, results: [] };
  }

  const po = gr.purchase_order as { po_number?: string } | null;

  const results = await notifyBuyers(
    'gr_pending',
    {
      gr_id: gr.id,
      gr_number: gr.gr_number,
      po_number: po?.po_number,
      pending_quantity: gr.quantity,
    },
    { entityType: 'goods_receipt', entityId: gr.id }
  );

  return summarizeResults(results);
}

/**
 * 框架协议提交待审批 → 通知 Manager
 */
export async function onContractPending(contractId: number): Promise<WebhookNotifyResult> {
  const client = getSupabaseClient();
  const { data: contract } = await client
    .from('contracts')
    .select('*, supplier:suppliers(name)')
    .eq('id', contractId)
    .single();

  if (!contract) {
    return { success: false, results: [] };
  }

  const sup = contract.supplier as { name?: string } | null;

  const results = await notifyManagers(
    'contract_pending',
    {
      contract_id: contract.id,
      contract_name: contract.title,
      supplier_name: sup?.name,
      valid_until: contract.valid_until,
    },
    { entityType: 'contract', entityId: contract.id }
  );

  return summarizeResults(results);
}

/**
 * PR 审批结束 → 通知 Manager（摘要；需求方详细内容由 approve 路由单独推送）
 */
export async function onPRApproved(
  prId: number,
  approved: boolean,
  approvalResult: {
    autoPOs: any[];
    sourcingTasks: any[];
    faMatches: any[];
  }
): Promise<WebhookNotifyResult> {
  const client = getSupabaseClient();
  const { data: pr } = await client
    .from('purchase_requests')
    .select('*, applicant:profiles(full_name)')
    .eq('id', prId)
    .single();

  if (!pr) {
    return { success: false, results: [] };
  }

  const event = approved ? 'pr_approved' : 'pr_rejected';
  const applicant = (pr as { applicant?: { full_name?: string } }).applicant;

  const results = await notifyManagers(
    event,
    {
      pr_id: pr.id,
      pr_number: pr.pr_number,
      approved,
      applicant_name: applicant?.full_name,
      ...(approved && {
        auto_created_pos: approvalResult.autoPOs.map((po: { id: number; po_number: string }) => ({
          po_id: po.id,
          po_number: po.po_number,
        })),
        sourcing_tasks: approvalResult.sourcingTasks.map(
          (sc: { id: number; task_number: string }) => ({
            task_id: sc.id,
            task_number: sc.task_number,
          })
        ),
        fa_matches_count: approvalResult.faMatches.length,
      }),
    },
    { entityType: 'purchase_request', entityId: pr.id }
  );

  return summarizeResults(results);
}
