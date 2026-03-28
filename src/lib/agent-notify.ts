/**
 * Agent 通知业务逻辑
 * 
 * 负责在特定业务场景下通知相关 Agent
 */

import { getSupabaseClient } from '@/storage/database';

/**
 * 通知事件类型
 */
export type NotifyEvent = {
  type: 'pr_submitted' | 'po_created' | 'gr_pending' | 'over_receipt_pending' | 'contract_pending';
  data: Record<string, any>;
};

/**
 * 根据事件类型获取通知目标
 */
function getNotifyTargets(event: NotifyEvent): { agent: string; message: string; priority: string }[] {
  const { type, data } = event;

  switch (type) {
    case 'pr_submitted':
      // PR 提交后通知 Manager Agent
      return [{
        agent: 'manager-agent',
        message: `新的采购申请已提交，请及时处理。\n申请人: ${data.applicant_name || '未知'}\n申请单号: ${data.pr_number}\n总金额: ¥${(data.total_amount || 0).toLocaleString()}`,
        priority: 'high',
      }];

    case 'po_created':
      // PO 创建后通知相关 Agent
      return [{
        agent: 'logistics-agent',
        message: `新的采购订单已创建。\n订单号: ${data.po_number}\n供应商: ${data.supplier_name}\n预计交付日期: ${data.expected_delivery_date || '待确认'}`,
        priority: 'normal',
      }];

    case 'gr_pending':
      // 待收货通知
      return [{
        agent: 'logistics-agent',
        message: `有待处理的收货单需要确认。\nPO号: ${data.po_number}\n收货单号: ${data.gr_number}\n待验数量: ${data.pending_quantity}`,
        priority: 'high',
      }];

    case 'over_receipt_pending':
      // 超收待审批通知
      return [{
        agent: 'manager-agent',
        message: `有超收待审批，需要您确认。\n收货单号: ${data.gr_number}\n超收数量: ${data.over_quantity}\n超收原因: ${data.reason || '未填写'}`,
        priority: 'high',
      }];

    case 'contract_pending':
      // 框架协议待审批通知
      return [{
        agent: 'manager-agent',
        message: `有新的框架协议待审批。\n协议名称: ${data.contract_name}\n供应商: ${data.supplier_name}\n有效期至: ${data.valid_until}`,
        priority: 'normal',
      }];

    default:
      return [];
  }
}

/**
 * 发送业务事件通知
 */
export async function notifyBusinessEvent(event: NotifyEvent): Promise<{ success: boolean; results: any[] }> {
  const targets = getNotifyTargets(event);
  
  if (targets.length === 0) {
    return { success: true, results: [] };
  }

  const results = [];

  for (const target of targets) {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:5000'}/api/a2a/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'purchasing-system',
          to: target.agent,
          message: target.message,
          priority: target.priority,
        }),
      });

      const result = await response.json();
      results.push({ agent: target.agent, ...result });
    } catch (error) {
      console.error(`Failed to notify ${target.agent}:`, error);
      results.push({ agent: target.agent, error: 'Notification failed' });
    }
  }

  const success = results.every(r => !r.error);
  return { success, results };
}

/**
 * PR 提交时触发通知
 */
export async function onPRSubmitted(prId: number) {
  const client = getSupabaseClient();
  const { data: pr } = await client
    .from('purchase_requests')
    .select('*, applicant:profiles(full_name)')
    .eq('id', prId)
    .single();

  if (pr) {
    return notifyBusinessEvent({
      type: 'pr_submitted',
      data: {
        pr_number: pr.pr_number,
        applicant_name: pr.applicant?.full_name,
        total_amount: pr.total_amount,
      },
    });
  }

  return { success: false, results: [] };
}

/**
 * PO 创建时触发通知
 */
export async function onPOCreated(poId: number) {
  const client = getSupabaseClient();
  const { data: po } = await client
    .from('purchase_orders')
    .select('*')
    .eq('id', poId)
    .single();

  if (po) {
    return notifyBusinessEvent({
      type: 'po_created',
      data: {
        po_number: po.po_number,
        supplier_name: po.supplier_snapshot?.name,
        expected_delivery_date: po.expected_delivery_date,
      },
    });
  }

  return { success: false, results: [] };
}

/**
 * 待收货时触发通知
 */
export async function onGRPending(grId: number) {
  const client = getSupabaseClient();
  const { data: gr } = await client
    .from('goods_receipts')
    .select('*, purchase_order:purchase_orders(po_number)')
    .eq('id', grId)
    .single();

  if (gr) {
    return notifyBusinessEvent({
      type: 'gr_pending',
      data: {
        gr_number: gr.gr_number,
        po_number: gr.purchase_order?.po_number,
        pending_quantity: gr.quantity,
      },
    });
  }

  return { success: false, results: [] };
}

/**
 * 超收待审批时触发通知
 */
export async function onOverReceiptPending(grId: number, overQuantity: number, reason: string) {
  const client = getSupabaseClient();
  const { data: gr } = await client
    .from('goods_receipts')
    .select('gr_number')
    .eq('id', grId)
    .single();

  if (gr) {
    return notifyBusinessEvent({
      type: 'over_receipt_pending',
      data: {
        gr_number: gr.gr_number,
        over_quantity: overQuantity,
        reason,
      },
    });
  }

  return { success: false, results: [] };
}

/**
 * 框架协议待审批时触发通知
 */
export async function onContractPending(contractId: number) {
  const client = getSupabaseClient();
  const { data: contract } = await client
    .from('contracts')
    .select('*, supplier:suppliers(name)')
    .eq('id', contractId)
    .single();

  if (contract) {
    return notifyBusinessEvent({
      type: 'contract_pending',
      data: {
        contract_name: contract.title,
        supplier_name: contract.supplier?.name,
        valid_until: contract.valid_until,
      },
    });
  }

  return { success: false, results: [] };
}
