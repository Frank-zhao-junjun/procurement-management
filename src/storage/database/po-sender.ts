/**
 * PO 发送服务
 * 决策 34：FA 路径 PO 失败重试 3×1min + 显式重试 + §8.3 审计
 */

import { getSupabaseClient } from './supabase-client';

const MAX_RETRIES = 3;
const RETRY_INTERVALS = [60, 300, 600]; // 秒：1分钟, 5分钟, 10分钟

interface POSendResult {
  success: boolean;
  error?: string;
  failureId?: number;
}

/**
 * 发送 PO 给供应商（模拟）
 * 实际应调用供应商系统 API
 */
async function sendPOToSupplier(poId: number): Promise<{ success: boolean; error?: string }> {
  // TODO: 实现实际的供应商系统调用
  // 这里模拟 80% 成功率
  const client = getSupabaseClient();
  
  const { data: po } = await client
    .from('purchase_orders')
    .select('po_number, supplier_snapshot')
    .eq('id', poId)
    .single();

  console.log(`[PO Send] Sending PO ${po?.po_number} to supplier ${po?.supplier_snapshot}...`);
  
  // 模拟发送
  const success = Math.random() > 0.2;
  
  if (!success) {
    return { success: false, error: 'Supplier system temporarily unavailable' };
  }
  
  return { success: true };
}

/**
 * 记录 PO 发送失败
 */
export async function recordPOSendFailure(
  poId: number,
  reason: string
): Promise<number> {
  const client = getSupabaseClient();
  
  // 计算下次重试时间
  const nextRetryAt = new Date(Date.now() + RETRY_INTERVALS[0] * 1000);
  
  const { data, error } = await client
    .from('po_send_failures')
    .insert({
      po_id: poId,
      failure_reason: reason,
      retry_count: 0,
      status: 'pending',
      next_retry_at: nextRetryAt.toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    throw error;
  }

  // 记录审计日志
  await client.from('audit_logs').insert({
    entity_type: 'purchase_order',
    entity_id: poId,
    action: 'po_send_failed',
    actor: 'system',
    actor_role: 'system',
    detail: {
      failure_reason: reason,
      retry_count: 0,
      next_retry_at: nextRetryAt.toISOString(),
    },
  });

  return data.id;
}

/**
 * 发送 PO 并处理失败重试
 */
export async function sendPurchaseOrder(poId: number): Promise<POSendResult> {
  const client = getSupabaseClient();
  
  // 发送 PO
  const result = await sendPOToSupplier(poId);
  
  if (result.success) {
    // 更新 PO 状态
    await client
      .from('purchase_orders')
      .update({ status: 'sent', updated_at: new Date().toISOString() })
      .eq('id', poId);

    // 记录审计日志
    await client.from('audit_logs').insert({
      entity_type: 'purchase_order',
      entity_id: poId,
      action: 'po_sent',
      actor: 'system',
      actor_role: 'system',
      detail: {},
    });

    return { success: true };
  }

  // 发送失败，记录失败
  const failureId = await recordPOSendFailure(poId, result.error || 'Unknown error');
  
  return {
    success: false,
    error: result.error,
    failureId,
  };
}

/**
 * 处理 PO 重试
 */
export async function retryPOSend(failureId: number): Promise<POSendResult> {
  const client = getSupabaseClient();
  
  // 获取失败记录
  const { data: failure, error } = await client
    .from('po_send_failures')
    .select('*')
    .eq('id', failureId)
    .single();

  if (error || !failure) {
    return { success: false, error: 'Failure record not found' };
  }

  if (failure.status === 'resolved') {
    return { success: false, error: 'Already resolved' };
  }

  if (failure.retry_count >= MAX_RETRIES) {
    // 达到最大重试次数，标记为失败
    await client
      .from('po_send_failures')
      .update({
        status: 'failed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', failureId);

    // 记录审计日志
    await client.from('audit_logs').insert({
      entity_type: 'purchase_order',
      entity_id: failure.po_id,
      action: 'po_send_max_retries_exceeded',
      actor: 'system',
      actor_role: 'system',
      detail: {
        failure_id: failureId,
        retry_count: failure.retry_count,
      },
    });

    return { success: false, error: 'Max retries exceeded' };
  }

  // 更新状态为重试中
  await client
    .from('po_send_failures')
    .update({
      status: 'retrying',
      updated_at: new Date().toISOString(),
    })
    .eq('id', failureId);

  // 发送 PO
  const result = await sendPOToSupplier(failure.po_id);

  if (result.success) {
    // 成功，更新状态
    await client
      .from('po_send_failures')
      .update({
        status: 'resolved',
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', failureId);

    // 更新 PO 状态
    await client
      .from('purchase_orders')
      .update({ status: 'sent', updated_at: new Date().toISOString() })
      .eq('id', failure.po_id);

    // 记录审计日志
    await client.from('audit_logs').insert({
      entity_type: 'purchase_order',
      entity_id: failure.po_id,
      action: 'po_retry_success',
      actor: 'system',
      actor_role: 'system',
      detail: {
        failure_id: failureId,
        retry_count: failure.retry_count + 1,
      },
    });

    return { success: true };
  }

  // 重试失败，更新失败记录
  const newRetryCount = failure.retry_count + 1;
  const nextRetryAt = new Date(Date.now() + (RETRY_INTERVALS[newRetryCount] || 600) * 1000);
  const newStatus = newRetryCount >= MAX_RETRIES ? 'failed' : 'pending';

  await client
    .from('po_send_failures')
    .update({
      retry_count: newRetryCount,
      status: newStatus,
      failure_reason: result.error || 'Retry failed',
      next_retry_at: newStatus === 'pending' ? nextRetryAt.toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', failureId);

  // 记录审计日志
  await client.from('audit_logs').insert({
    entity_type: 'purchase_order',
    entity_id: failure.po_id,
    action: 'po_retry_failed',
    actor: 'system',
    actor_role: 'system',
    detail: {
      failure_id: failureId,
      retry_count: newRetryCount,
      next_retry_at: newStatus === 'pending' ? nextRetryAt.toISOString() : null,
    },
  });

  return {
    success: false,
    error: result.error,
    failureId,
  };
}

/**
 * 获取待重试的 PO 发送失败记录
 */
export async function getPendingRetries(): Promise<any[]> {
  const client = getSupabaseClient();
  const now = new Date().toISOString();
  
  const { data, error } = await client
    .from('po_send_failures')
    .select('*, purchase_orders(po_number)')
    .eq('status', 'pending')
    .lte('next_retry_at', now)
    .lt('retry_count', MAX_RETRIES)
    .order('next_retry_at', { ascending: true });

  if (error) {
    console.error('Failed to get pending retries:', error);
    return [];
  }

  return data || [];
}

/**
 * 显式重试 PO 发送（手动触发）
 */
export async function explicitRetryPOSend(poId: number): Promise<POSendResult> {
  const client = getSupabaseClient();
  
  // 查找是否存在未解决的失败记录
  const { data: existing } = await client
    .from('po_send_failures')
    .select('id')
    .eq('po_id', poId)
    .eq('status', 'failed')
    .single();

  if (existing) {
    // 重置失败记录
    await client
      .from('po_send_failures')
      .update({
        retry_count: 0,
        status: 'pending',
        failure_reason: 'Manual retry',
        next_retry_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);

    return retryPOSend(existing.id);
  }

  // 没有失败记录，直接发送
  return sendPurchaseOrder(poId);
}
