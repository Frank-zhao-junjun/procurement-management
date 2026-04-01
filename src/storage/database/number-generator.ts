/**
 * 统一单据编号生成服务
 * 规则：
 * - 使用 Asia/Shanghai 时区
 * - 每天流水号 01-99，超出返回错误
 * - 支持前缀：PR-, SC-, Q-, QT-, FA-, PO-, GR-, RT-
 */

import { getSupabaseClient } from './supabase-client';

const MAX_DAILY_SEQ = 99;
const SEQ_FIELD_MAP: Record<string, string> = {
  'PR': 'pr_number',
  'SC': 'task_number',
  'Q': 'quote_number',
  'QT': 'quote_number',  // 兼容旧前缀
  'FA': 'fa_number',     // 修复：使用正确的字段名
  'PO': 'po_number',
  'GR': 'gr_number',
  'RT': 'gr_number',    // 退货使用 GR 前缀，类型区分
};

// 获取上海时区日期字符串 YYYYMMDD
function getShanghaiDate(): string {
  const now = new Date();
  // 使用 Intl API 获取上海时区的日期
  const shanghaiDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  // 返回 YYYYMMDD 格式
  return shanghaiDate.replace(/-/g, '');
}

/**
 * 生成单据编号
 * @param prefix 前缀，如 'PR', 'SC', 'Q', 'FA', 'PO', 'GR'
 * @param tableName 表名，如 'purchase_requests', 'sourcing_tasks' 等
 * @returns 编号字符串，如 'PR-20260322-01'
 */
export async function generateDocumentNumber(
  prefix: keyof typeof SEQ_FIELD_MAP,
  tableName: string
): Promise<string> {
  const client = getSupabaseClient();
  const dateStr = getShanghaiDate();
  const likePattern = `${prefix}-${dateStr}-%`;
  
  // 查询当天已使用的最大序号
  // 使用 PostgreSQL 直接查询以获取准确计数
  const { data, error } = await client.rpc('get_max_seq', {
    p_table_name: tableName,
    p_prefix: prefix,
    p_date_str: dateStr,
  }).single();
  
  if (error) {
    // 如果 RPC 不存在，回退到计数方式
    const countResult = await client
      .from(tableName)
      .select('*', { count: 'exact', head: true })
      .like(SEQ_FIELD_MAP[prefix] || SEQ_FIELD_MAP['PR'], likePattern);
    
    const count = countResult.count || 0;
    
    if (count >= MAX_DAILY_SEQ) {
      throw new Error(`编号已达到日上限 ${MAX_DAILY_SEQ}，请明天再试`);
    }
    
    const seq = String(count + 1).padStart(2, '0');
    return `${prefix}-${dateStr}-${seq}`;
  }
  
  const maxSeq = (data as any)?.max_seq || 0;
  
  if (maxSeq >= MAX_DAILY_SEQ) {
    throw new Error(`编号已达到日上限 ${MAX_DAILY_SEQ}，请明天再试`);
  }
  
  const seq = String(maxSeq + 1).padStart(2, '0');
  return `${prefix}-${dateStr}-${seq}`;
}

/**
 * 生成简单编号（无日期流水）
 * 用于 Q- 前缀的报价单（规格中 Q- 是 6 位数字）
 */
export async function generateQuoteNumber(): Promise<string> {
  const client = getSupabaseClient();
  
  // 查询最大编号
  const { data, error } = await client.rpc('get_max_quote_number').single();
  
  if (error || !data) {
    // 回退：使用旧方式生成 QT-YYYYMMDD-XX
    return generateDocumentNumber('QT', 'quotes');
  }
  
  const maxNum = (data as any)?.max_number || 0;
  const newNum = maxNum + 1;
  
  // 格式化为 6 位数字
  return `Q-${String(newNum).padStart(6, '0')}`;
}

// 预定义的生成函数
export const numberGenerators = {
  pr: (tableName = 'purchase_requests') => generateDocumentNumber('PR', tableName),
  sc: (tableName = 'sourcing_tasks') => generateDocumentNumber('SC', tableName),
  fa: (tableName = 'framework_agreements') => generateDocumentNumber('FA', tableName),
  po: (tableName = 'purchase_orders') => generateDocumentNumber('PO', tableName),
  gr: (tableName = 'goods_receipts') => generateDocumentNumber('GR', tableName),
  rt: (tableName = 'goods_receipts') => generateDocumentNumber('RT', tableName),
  quote: () => generateQuoteNumber(),
};

// GR 编号生成（支持 GR/RT 前缀）
export async function generateGRNumber(grType: 'in' | 'out' = 'in'): Promise<string> {
  const prefix = grType === 'out' ? 'RT' : 'GR';
  return generateDocumentNumber(prefix as any, 'goods_receipts');
}
