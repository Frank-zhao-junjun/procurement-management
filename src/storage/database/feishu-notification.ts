/**
 * 飞书通知服务
 * 支持：
 * - 消息队列（存储待发送通知）
 * - 重试机制（决策 37）
 * - 三入口、绑定、隔离（决策 38）
 */

import { getSupabaseClient } from './supabase-client';

interface FeishuNotification {
  id?: number;
  notification_type: 'pr_submit' | 'pr_approve' | 'pr_reject' | 
                    'po_create' | 'po_send' | 'po_receive' |
                    'gr_create' | 'gr_overdelivery' | 'gr_approved' |
                    'sc_create' | 'quote_submit';
  recipient_type: 'requester' | 'buyer' | 'manager';
  recipient_id: string;  // 飞书用户ID或绑定ID
  title: string;
  content: string;
  entity_type?: string;
  entity_id?: number;
  status: 'pending' | 'sending' | 'sent' | 'failed';
  retry_count: number;
  max_retries: number;
  last_error?: string;
  created_at?: string;
  updated_at?: string;
}

// 最大重试次数
const MAX_RETRIES = 3;
// 重试间隔（毫秒）
const RETRY_INTERVALS = [60000, 300000, 600000]; // 1分钟, 5分钟, 10分钟

/**
 * 创建飞书通知记录
 */
export async function createNotification(
  notification: Omit<FeishuNotification, 'id' | 'status' | 'retry_count' | 'max_retries' | 'created_at' | 'updated_at'>
): Promise<number> {
  const client = getSupabaseClient();
  
  const { data, error } = await client
    .from('feishu_notifications')
    .insert({
      notification_type: notification.notification_type,
      recipient_type: notification.recipient_type,
      recipient_id: notification.recipient_id,
      title: notification.title,
      content: notification.content,
      entity_type: notification.entity_type,
      entity_id: notification.entity_id,
      status: 'pending',
      retry_count: 0,
      max_retries: MAX_RETRIES,
    })
    .select('id')
    .single();

  if (error) {
    console.error('Failed to create notification:', error);
    throw error;
  }

  return data.id;
}

/**
 * 获取待发送的通知
 */
export async function getPendingNotifications(limit: number = 10): Promise<FeishuNotification[]> {
  const client = getSupabaseClient();
  
  const { data, error } = await client
    .from('feishu_notifications')
    .select('*')
    .eq('status', 'pending')
    .lt('retry_count', MAX_RETRIES)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('Failed to get pending notifications:', error);
    return [];
  }

  return data || [];
}

/**
 * 发送通知（模拟，实际应调用飞书 API）
 */
async function sendToFeishu(notification: FeishuNotification): Promise<boolean> {
  // TODO: 实现实际的飞书 API 调用
  // const response = await fetch('https://open.feishu.cn/open-apis/bot/v2/hook/...', {...});
  
  // 模拟发送
  console.log(`[Feishu] Sending notification to ${notification.recipient_id}:`, {
    title: notification.title,
    content: notification.content,
  });
  
  // 模拟成功率 80%
  return Math.random() > 0.2;
}

/**
 * 处理通知队列
 */
export async function processNotificationQueue(): Promise<{ sent: number; failed: number }> {
  const pending = await getPendingNotifications(10);
  let sent = 0;
  let failed = 0;

  for (const notification of pending) {
    try {
      // 更新状态为发送中
      const client = getSupabaseClient();
      await client
        .from('feishu_notifications')
        .update({ status: 'sending' })
        .eq('id', notification.id);

      const success = await sendToFeishu(notification);

      if (success) {
        await client
          .from('feishu_notifications')
          .update({ status: 'sent', updated_at: new Date().toISOString() })
          .eq('id', notification.id);
        sent++;
      } else {
        // 发送失败，准备重试
        const newRetryCount = notification.retry_count + 1;
        if (newRetryCount >= MAX_RETRIES) {
          await client
            .from('feishu_notifications')
            .update({ 
              status: 'failed', 
              retry_count: newRetryCount,
              last_error: 'Max retries exceeded',
              updated_at: new Date().toISOString(),
            })
            .eq('id', notification.id);
        } else {
          await client
            .from('feishu_notifications')
            .update({ 
              status: 'pending', 
              retry_count: newRetryCount,
              last_error: 'Send failed',
              updated_at: new Date().toISOString(),
            })
            .eq('id', notification.id);
        }
        failed++;
      }
    } catch (error: any) {
      console.error(`Failed to process notification ${notification.id}:`, error);
      failed++;
    }
  }

  return { sent, failed };
}

/**
 * 便捷方法：发送 PR 相关通知
 */
export async function notifyPRSubmit(prNumber: string, applicantId: string) {
  return createNotification({
    notification_type: 'pr_submit',
    recipient_type: 'manager',
    recipient_id: 'manager', // 应该根据绑定查询
    title: '新的采购申请待审批',
    content: `采购申请 ${prNumber} 已提交，请及时审批。`,
    entity_type: 'purchase_request',
  });
}

export async function notifyPRApprove(prNumber: string, requesterId: string) {
  return createNotification({
    notification_type: 'pr_approve',
    recipient_type: 'requester',
    recipient_id: requesterId,
    title: '采购申请已批准',
    content: `您的采购申请 ${prNumber} 已批准。`,
    entity_type: 'purchase_request',
  });
}

export async function notifyGROverdelivery(grNumber: string, managerId: string) {
  return createNotification({
    notification_type: 'gr_overdelivery',
    recipient_type: 'manager',
    recipient_id: managerId,
    title: '超收收货单待审批',
    content: `收货单 ${grNumber} 超过订单 5%，需要您审批。`,
    entity_type: 'goods_receipt',
  });
}

export async function notifyGRApproved(grNumber: string, requesterId: string) {
  return createNotification({
    notification_type: 'gr_approved',
    recipient_type: 'requester',
    recipient_id: requesterId,
    title: '超收收货单已批准',
    content: `收货单 ${grNumber} 已通过审批。`,
    entity_type: 'goods_receipt',
  });
}
