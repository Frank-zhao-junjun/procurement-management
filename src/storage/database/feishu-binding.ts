/**
 * 飞书三入口绑定与隔离服务
 * 决策 38：三入口、绑定、隔离
 * 决策 39：自助绑定、无工号邮箱
 */

import { getSupabaseClient } from './supabase-client';

// 飞书三应用入口类型
export type FeishuEntry = 'requester' | 'manager' | 'buyer';

// 绑定记录
interface FeishuBinding {
  id: number;
  feishu_user_id: string;
  feishu_open_id: string;
  feishu_union_id: string;
  entry: FeishuEntry;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * 创建飞书用户绑定（自助绑定，无工号邮箱）
 * 决策 39：用户通过飞书授权自助绑定
 */
export async function createBinding(
  feishuUserId: string,
  feishuOpenId: string,
  feishuUnionId: string,
  entry: FeishuEntry
): Promise<{ success: boolean; bindingId?: number; error?: string }> {
  const client = getSupabaseClient();

  // 检查是否已有该飞书用户的绑定
  const { data: existing } = await client
    .from('feishu_bindings')
    .select('id, entry, is_active')
    .eq('feishu_user_id', feishuUserId)
    .single();

  if (existing) {
    // 检查该入口是否已被占用
    if (existing.is_active && existing.entry === entry) {
      return { success: true, bindingId: existing.id, error: 'Already bound to this entry' };
    }
    
    // 如果该飞书用户绑定了其他入口，返回错误（一人不能绑定多个入口）
    if (existing.is_active) {
      return { success: false, error: 'This Feishu account is already bound to another entry' };
    }
  }

  // 检查该入口是否已被其他飞书用户绑定
  const { data: entryBound } = await client
    .from('feishu_bindings')
    .select('id')
    .eq('entry', entry)
    .eq('is_active', true)
    .single();

  if (entryBound) {
    return { success: false, error: `Entry ${entry} is already bound to another account` };
  }

  // 创建或更新绑定
  const { data, error } = existing
    ? await client
        .from('feishu_bindings')
        .update({
          feishu_user_id: feishuUserId,
          feishu_open_id: feishuOpenId,
          feishu_union_id: feishuUnionId,
          entry,
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select('id')
        .single()
    : await client
        .from('feishu_bindings')
        .insert({
          feishu_user_id: feishuUserId,
          feishu_open_id: feishuOpenId,
          feishu_union_id: feishuUnionId,
          entry,
          is_active: true,
        })
        .select('id')
        .single();

  if (error) {
    return { success: false, error: error.message };
  }

  // 记录审计日志
  await client.from('audit_logs').insert({
    entity_type: 'feishu_binding',
    entity_id: data.id,
    action: 'bind',
    actor: feishuUserId,
    actor_role: entry,
    detail: { entry },
  });

  return { success: true, bindingId: data.id };
}

/**
 * 根据飞书用户 ID 获取绑定信息
 */
export async function getBindingByFeishuUserId(feishuUserId: string): Promise<FeishuBinding | null> {
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('feishu_bindings')
    .select('*')
    .eq('feishu_user_id', feishuUserId)
    .eq('is_active', true)
    .single();

  if (error || !data) {
    return null;
  }

  return data as FeishuBinding;
}

/**
 * 根据入口类型获取绑定信息
 */
export async function getBindingByEntry(entry: FeishuEntry): Promise<FeishuBinding | null> {
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('feishu_bindings')
    .select('*')
    .eq('entry', entry)
    .eq('is_active', true)
    .single();

  if (error || !data) {
    return null;
  }

  return data as FeishuBinding;
}

/**
 * 获取所有活跃绑定
 */
export async function getAllActiveBindings(): Promise<FeishuBinding[]> {
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('feishu_bindings')
    .select('*')
    .eq('is_active', true);

  if (error) {
    return [];
  }

  return (data || []) as FeishuBinding[];
}

/**
 * 获取指定入口的通知目标（飞书用户 ID）
 */
export async function getNotificationTarget(entry: FeishuEntry): Promise<string | null> {
  const binding = await getBindingByEntry(entry);
  return binding?.feishu_user_id || null;
}

/**
 * 根据业务角色获取通知目标
 * 决策 38：三入口、绑定、隔离
 * - pr_submit/pr_reject -> 通知 requester
 * - po_send/gr_create -> 通知 buyer
 * - pr_approve_overdelivery -> 通知 manager
 */
export async function getTargetByNotificationType(
  notificationType: string
): Promise<{ entry: FeishuEntry; targetId: string | null }> {
  const entryMap: Record<string, FeishuEntry | 'supplier'> = {
    // PR 相关通知
    'pr_submit': 'manager',
    'pr_approve': 'requester',
    'pr_reject': 'requester',
    // PO 相关通知
    'po_create': 'buyer',
    'po_send': 'supplier', // 供应商系统
    // GR 相关通知
    'gr_create': 'buyer',
    'gr_overdelivery': 'manager',
    'gr_approved': 'requester',
    // SC/Quote 相关
    'sc_create': 'buyer',
    'quote_submit': 'buyer',
  };

  const entry = entryMap[notificationType] || 'manager';
  let targetId: string | null = null;
  
  if (entry !== 'supplier') {
    targetId = await getNotificationTarget(entry as FeishuEntry);
  }

  return { entry: entry as FeishuEntry, targetId };
}

/**
 * 验证用户是否有权限访问指定入口
 * 决策 38：隔离 - 不同入口只能看到对应权限的数据
 */
export async function validateAccess(
  feishuUserId: string,
  requiredEntry: FeishuEntry
): Promise<boolean> {
  const binding = await getBindingByFeishuUserId(feishuUserId);
  
  if (!binding) {
    return false;
  }

  // 检查绑定是否激活
  if (!binding.is_active) {
    return false;
  }

  // 检查入口是否匹配
  return binding.entry === requiredEntry;
}

/**
 * 获取用户对应的角色
 */
export async function getUserRole(feishuUserId: string): Promise<string | null> {
  const binding = await getBindingByFeishuUserId(feishuUserId);
  
  if (!binding) {
    return null;
  }

  // 映射入口到角色
  const roleMap: Record<FeishuEntry, string> = {
    'requester': 'requester',
    'manager': 'manager',
    'buyer': 'buyer',
  };

  return roleMap[binding.entry] || null;
}
