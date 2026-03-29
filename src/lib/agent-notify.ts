/**
 * Agent 通知业务逻辑
 * 
 * 在 Coze 沙箱环境中，A2A Scheduler 可能不可用。
 * 此模块作为可选能力实现，通知失败时不会影响主业务流程。
 * 
 * 主要通知方式（按优先级）：
 * 1. Webhook - Manager Agent 注册的 Webhook URL（主要方式，在 Coze 沙箱中可用）
 * 2. A2A - 通过 A2A Scheduler 通知（可选能力，在完整环境中可用）
 */

import { getSupabaseClient } from '@/storage/database';

/**
 * 通知事件类型
 */
export type NotifyEvent = {
  type: 'pr_submitted' | 'po_created' | 'gr_pending' | 'over_receipt_pending' | 'contract_pending' | 'pr_approved';
  data: Record<string, any>;
};

/**
 * 获取 A2A Scheduler 配置
 */
function getA2AConfig() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:5000';
  const a2aUrl = process.env.A2A_SCHEDULER_URL || 'http://localhost:8000';
  return { baseUrl, a2aUrl };
}

/**
 * 根据事件类型获取通知目标
 */
function getNotifyTargets(event: NotifyEvent): { agent: string; message: string; priority: string }[] {
  const { type, data } = event;

  switch (type) {
    case 'pr_submitted':
      return [{
        agent: 'manager-agent',
        message: `新的采购申请已提交，请及时处理。\n申请人: ${data.applicant_name || '未知'}\n申请单号: ${data.pr_number}\n总金额: ¥${(data.total_amount || 0).toLocaleString()}`,
        priority: 'high',
      }];

    case 'po_created':
      return [{
        agent: 'logistics-agent',
        message: `新的采购订单已创建。\n订单号: ${data.po_number}\n供应商: ${data.supplier_name}\n预计交付日期: ${data.expected_delivery_date || '待确认'}`,
        priority: 'normal',
      }];

    case 'gr_pending':
      return [{
        agent: 'logistics-agent',
        message: `有待处理的收货单需要确认。\nPO号: ${data.po_number}\n收货单号: ${data.gr_number}\n待验数量: ${data.pending_quantity}`,
        priority: 'high',
      }];

    case 'over_receipt_pending':
      return [{
        agent: 'manager-agent',
        message: `有超收待审批，需要您确认。\n收货单号: ${data.gr_number}\n超收数量: ${data.over_quantity}\n超收原因: ${data.reason || '未填写'}`,
        priority: 'high',
      }];

    case 'contract_pending':
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
 * 发送 A2A 通知（可选能力）
 * 
 * 在 Coze 沙箱环境中，此功能可能不可用。
 * 调用方应忽略失败，不影响主业务流程。
 */
async function sendA2ANotification(
  to: string,
  message: string,
  options?: { from?: string; priority?: string }
): Promise<{ success: boolean; error?: string }> {
  const { baseUrl } = getA2AConfig();

  try {
    const response = await fetch(`${baseUrl}/api/a2a/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: options?.from || 'purchasing-system',
        to,
        message,
        priority: options?.priority || 'normal',
      }),
      signal: AbortSignal.timeout(5000), // 5秒超时，避免阻塞
    });

    if (!response.ok) {
      const result = await response.json();
      // 如果是 503（服务不可用），说明 A2A Scheduler 未连接，这是预期的
      if (response.status === 503) {
        return { success: false, error: 'A2A_NOT_AVAILABLE' };
      }
      return { success: false, error: result.error || `HTTP ${response.status}` };
    }

    return { success: true };
  } catch (error: any) {
    if (error.name === 'TimeoutError') {
      return { success: false, error: 'A2A_NOT_AVAILABLE' };
    }
    if (error.code === 'ECONNREFUSED') {
      return { success: false, error: 'A2A_NOT_AVAILABLE' };
    }
    console.warn('[A2A] Notification failed:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 发送业务事件通知
 * 
 * 注意：这是可选能力，在 Coze 沙箱中 A2A Scheduler 可能不可用。
 * 此函数不会抛出异常，失败时静默降级。
 */
export async function notifyBusinessEvent(event: NotifyEvent): Promise<{ 
  success: boolean; 
  results: any[];
  a2aAvailable: boolean;
}> {
  const targets = getNotifyTargets(event);
  
  if (targets.length === 0) {
    return { success: true, results: [], a2aAvailable: true };
  }

  const results: any[] = [];
  let a2aAvailable = false;

  for (const target of targets) {
    const result = await sendA2ANotification(target.agent, target.message, {
      priority: target.priority,
    });
    
    results.push({ agent: target.agent, ...result });
    
    if (result.success) {
      a2aAvailable = true;
    }
  }

  // 至少有一个成功就算成功
  const success = results.some(r => r.success);
  
  return { success, results, a2aAvailable };
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
    const result = await notifyBusinessEvent({
      type: 'pr_submitted',
      data: {
        pr_number: pr.pr_number,
        applicant_name: pr.applicant?.full_name,
        total_amount: pr.total_amount,
      },
    });
    
    // 如果 A2A 不可用，静默降级（不影响主流程）
    if (!result.a2aAvailable) {
      console.info('[Notification] A2A not available, skipping Agent notification for PR:', pr.pr_number);
    }
    
    return result;
  }

  return { success: false, results: [], a2aAvailable: false };
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
    const result = await notifyBusinessEvent({
      type: 'po_created',
      data: {
        po_number: po.po_number,
        supplier_name: po.supplier_snapshot?.name,
        expected_delivery_date: po.expected_delivery_date,
      },
    });
    
    if (!result.a2aAvailable) {
      console.info('[Notification] A2A not available, skipping Agent notification for PO:', po.po_number);
    }
    
    return result;
  }

  return { success: false, results: [], a2aAvailable: false };
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

  return { success: false, results: [], a2aAvailable: false };
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

  return { success: false, results: [], a2aAvailable: false };
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

  return { success: false, results: [], a2aAvailable: false };
}

/**
 * PR 审批完成时触发通知（A2A 可选能力）
 * 
 * 主要通知通过 Webhook 发送（见 approve/route.ts）
 * 此函数用于通过 A2A 通知 Manager（如果 A2A 可用）
 */
export async function onPRApproved(
  prId: number, 
  approved: boolean, 
  approvalResult: {
    autoPOs: any[];
    sourcingTasks: any[];
    faMatches: any[];
  }
) {
  const client = getSupabaseClient();
  const { data: pr } = await client
    .from('purchase_requests')
    .select('*, applicant:profiles(full_name)')
    .eq('id', prId)
    .single();

  if (!pr) {
    return { success: false, results: [], a2aAvailable: false };
  }

  let message: string;
  if (approved) {
    const poCount = approvalResult.autoPOs.length;
    const scCount = approvalResult.sourcingTasks.length;
    message = `采购申请已审批通过。\n申请单号: ${pr.pr_number}\n申请人: ${pr.applicant?.full_name || '未知'}\n自动创建采购订单: ${poCount} 张\n创建寻源任务: ${scCount} 个`;
  } else {
    message = `采购申请已被拒绝。\n申请单号: ${pr.pr_number}\n申请人: ${pr.applicant?.full_name || '未知'}`;
  }

  return notifyBusinessEvent({
    type: 'pr_approved',
    data: {
      pr_number: pr.pr_number,
      applicant_name: pr.applicant?.full_name,
      approved,
      auto_pos: approvalResult.autoPOs,
      sourcing_tasks: approvalResult.sourcingTasks,
      message,
    },
  });
}
