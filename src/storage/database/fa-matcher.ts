/**
 * 框架协议（FA）智能匹配服务
 * 规则（§5.1）：
 * 1. 优先按 material_id 精确匹配
 * 2. 次级按 material_original_text 文本匹配
 * 3. 有效期使用上海时区判断
 * 4. 多条匹配时取最低价
 * 5. 需要用户确认（match_confirm = pending → confirmed）
 */

import { getSupabaseClient } from './supabase-client';

interface MatchResult {
  matched: boolean;
  fa?: {
    id: number;
    fa_number: string;
    supplier_id: number;
    supplier_snapshot: string;
    material_id: number | null;
    material_snapshot: string;
    unit_price: number;
    valid_from: string;
    valid_to: string;
  };
  match_type?: 'material_id' | 'text';
  alternatives?: Array<{
    id: number;
    fa_number: string;
    unit_price: number;
  }>;
}

// 获取上海时区日期字符串 YYYYMMDD
function getShanghaiDate(): string {
  const now = new Date();
  const shanghaiDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return shanghaiDate.replace(/-/g, '');
}

// 获取上海时区日期（用于日期比较）
function getShanghaiISODate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// 文本归一化
function normalizeText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[Ａ-Ｚａ-ｚ]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFF10));
}

/**
 * 智能匹配框架协议
 * @param materialId 物料ID（可选，用于精确匹配）
 * @param requirementText 需求描述文本（用于文本匹配）
 * @param returnTopN 返回前 N 个备选（用于用户确认）
 */
export async function matchFrameworkAgreement(
  materialId?: number | null,
  requirementText?: string,
  returnTopN: number = 3
): Promise<MatchResult> {
  const client = getSupabaseClient();
  const today = getShanghaiISODate();
  
  let query = client
    .from('framework_agreements')
    .select('*')
    .eq('status', 'active')
    .lte('valid_from', today)
    .gte('valid_to', today)
    .order('unit_price', { ascending: true }); // 按价格升序，最低优先

  const { data: agreements, error } = await query;

  if (error || !agreements || agreements.length === 0) {
    return { matched: false };
  }

  // 1. 优先按 material_id 匹配
  if (materialId) {
    const idMatches = agreements.filter((fa: any) => fa.material_id === materialId);
    
    if (idMatches.length > 0) {
      const best = idMatches[0];
      return {
        matched: true,
        fa: {
          id: best.id,
          fa_number: best.fa_number,
          supplier_id: best.supplier_id,
          supplier_snapshot: best.supplier_snapshot,
          material_id: best.material_id,
          material_snapshot: best.material_snapshot,
          unit_price: parseFloat(best.unit_price),
          valid_from: best.valid_from,
          valid_to: best.valid_to,
        },
        match_type: 'material_id',
        alternatives: idMatches.slice(1, returnTopN).map((fa: any) => ({
          id: fa.id,
          fa_number: fa.fa_number,
          unit_price: parseFloat(fa.unit_price),
        })),
      };
    }
  }

  // 2. 次级按 material_original_text 文本匹配
  if (requirementText) {
    const normalizedText = normalizeText(requirementText);
    const textMatches = agreements.filter((fa: any) => 
      normalizeText(fa.material_original_text || '') === normalizedText
    );

    if (textMatches.length > 0) {
      const best = textMatches[0];
      return {
        matched: true,
        fa: {
          id: best.id,
          fa_number: best.fa_number,
          supplier_id: best.supplier_id,
          supplier_snapshot: best.supplier_snapshot,
          material_id: best.material_id,
          material_snapshot: best.material_snapshot,
          unit_price: parseFloat(best.unit_price),
          valid_from: best.valid_from,
          valid_to: best.valid_to,
        },
        match_type: 'text',
        alternatives: textMatches.slice(1, returnTopN).map((fa: any) => ({
          id: fa.id,
          fa_number: fa.fa_number,
          unit_price: parseFloat(fa.unit_price),
        })),
      };
    }
  }

  return { matched: false };
}

/**
 * 更新 PR 行的匹配确认状态
 */
export async function updateMatchConfirm(
  prLineId: number,
  faId: number,
  confirmed: boolean
): Promise<void> {
  const client = getSupabaseClient();
  
  await client
    .from('purchase_request_lines')
    .update({
      match_confirm: confirmed ? 'confirmed' : 'rejected',
      updated_at: new Date().toISOString(),
    })
    .eq('id', prLineId);

  // 记录审计日志
  await client.from('audit_logs').insert({
    entity_type: 'purchase_request_line',
    entity_id: prLineId,
    action: confirmed ? 'confirm_match' : 'reject_match',
    actor: 'system',
    actor_role: 'system',
    detail: {
      fa_id: faId,
      confirmed,
    },
  });
}
