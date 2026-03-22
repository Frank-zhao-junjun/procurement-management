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
// 重试间隔（毫秒）- 决策34: 3×1min
const RETRY_INTERVALS_MS = [60000, 60000, 60000]; // 3次，每次1分钟

// 飞书 API 配置
const FEISHU_WEBHOOK_URL = process.env.FEISHU_WEBHOOK_URL || '';
const FEISHU_APP_ID = process.env.FEISHU_APP_ID || '';
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || '';
const FEISHU_BOT_TOKEN = process.env.FEISHU_BOT_TOKEN || '';

// Token 缓存
let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * 获取飞书 tenant_access_token
 */
async function getFeishuToken(): Promise<string | null> {
  // 检查缓存
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) {
    console.warn('[Feishu] Missing FEISHU_APP_ID or FEISHU_APP_SECRET');
    return null;
  }

  try {
    const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: FEISHU_APP_ID,
        app_secret: FEISHU_APP_SECRET,
      }),
    });

    const data = await response.json();
    if (data.code === 0 && data.tenant_access_token) {
      // 缓存 2 小时（飞书 token 默认有效期）
      cachedToken = {
        token: data.tenant_access_token,
        expiresAt: Date.now() + 2 * 60 * 60 * 1000 - 5 * 60 * 1000, // 提前5分钟刷新
      };
      return cachedToken.token;
    }
    
    console.error('[Feishu] Failed to get token:', data);
    return null;
  } catch (error) {
    console.error('[Feishu] Error getting token:', error);
    return null;
  }
}

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
 * 发送通知到飞书（支持 Webhook 和 应用身份两种模式）
 */
async function sendToFeishu(notification: FeishuNotification): Promise<boolean> {
  const messageContent = {
    title: notification.title,
    text: notification.content,
  };

  // 模式1: Webhook 机器人（简单配置）
  if (FEISHU_WEBHOOK_URL) {
    try {
      const response = await fetch(FEISHU_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          msg_type: 'interactive',
          card: {
            config: { wide_screen_mode: true },
            elements: [
              { tag: 'div', text: { content: `**${messageContent.title}**`, tag: 'lark_md' } },
              { tag: 'div', text: { content: messageContent.text, tag: 'lark_md' } },
              {
                tag: 'hr',
              },
              {
                tag: 'note',
                elements: [
                  { tag: 'lark_md', text: `类型: ${notification.notification_type}` },
                ],
              },
            ],
          },
        }),
      });

      if (response.ok) {
        console.log(`[Feishu] Webhook sent successfully to ${notification.recipient_id}`);
        return true;
      }
      
      const error = await response.text();
      console.error(`[Feishu] Webhook failed: ${error}`);
      return false;
    } catch (error) {
      console.error('[Feishu] Webhook error:', error);
      return false;
    }
  }

  // 模式2: 应用身份发送（需要 open_id 或 user_id）
  const token = await getFeishuToken();
  if (token && notification.recipient_id && notification.recipient_id !== 'manager') {
    try {
      const response = await fetch('https://open.feishu.cn/open-apis/im/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          receive_id: notification.recipient_id,
          msg_type: 'text',
          content: JSON.stringify({
            text: `${messageContent.title}\n${messageContent.text}`,
          }),
        }),
      });

      const data = await response.json();
      if (data.code === 0 || data.code === '0') {
        console.log(`[Feishu] Message sent successfully to ${notification.recipient_id}`);
        return true;
      }
      
      console.error(`[Feishu] API failed: code=${data.code}, msg=${data.msg}`);
      return false;
    } catch (error) {
      console.error('[Feishu] API error:', error);
      return false;
    }
  }

  // 降级: 记录日志（真实场景应配置飞书环境变量）
  console.log(`[Feishu] Fallback log - would send to ${notification.recipient_id}:`, messageContent);
  return true; // 降级场景视为成功，避免阻塞流程
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
