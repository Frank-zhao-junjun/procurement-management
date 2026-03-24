import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';

// GET /api/materials/match - 检查物料匹配
// 参数: text (物料名称/描述), threshold (相似度阈值，默认0.3)
export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const searchParams = request.nextUrl.searchParams;
    const text = searchParams.get('text')?.trim();
    const threshold = Number(searchParams.get('threshold') || '0.3');
    const limit = parseInt(searchParams.get('limit') || '5');

    if (!text) {
      return NextResponse.json({ error: 'text 参数必填' }, { status: 400 });
    }

    // 获取所有活跃物料
    const { data: materials, error } = await client
      .from('materials')
      .select('*')
      .eq('is_active', true);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!materials || materials.length === 0) {
      return NextResponse.json({
        found: false,
        exactMatch: null,
        suggestions: [],
        message: '物料库为空，建议创建新物料',
        action: 'create_new',
      });
    }

    // 归一化文本
    const normalizedText = normalizeText(text);

    // 计算相似度并排序
    const matches = materials.map((m: any) => {
      const nameSimilarity = calculateSimilarity(normalizedText, normalizeText(m.name || ''));
      const codeSimilarity = m.code ? calculateSimilarity(normalizedText, normalizeText(m.code)) : 0;
      const similarity = Math.max(nameSimilarity, codeSimilarity);
      
      return {
        material: {
          id: m.id,
          code: m.code,
          name: m.name,
          unit: m.unit,
        },
        similarity,
        matchType: similarity >= 0.8 ? 'high' : similarity >= 0.5 ? 'medium' : 'low',
      };
    }).filter((m: any) => m.similarity >= threshold)
      .sort((a: any, b: any) => b.similarity - a.similarity)
      .slice(0, limit);

    // 检查精确匹配
    const exactMatch = matches.find((m: any) => m.similarity >= 0.95);

    if (exactMatch) {
      return NextResponse.json({
        found: true,
        exactMatch: exactMatch.material,
        suggestions: [],
        message: `找到精确匹配的物料: ${exactMatch.material.name}`,
        action: 'use_existing',
      });
    }

    if (matches.length > 0) {
      return NextResponse.json({
        found: true,
        exactMatch: null,
        suggestions: matches,
        message: `找到 ${matches.length} 个相似物料，请选择使用现有物料或创建新物料`,
        action: 'confirm',
        options: ['use_existing', 'create_new', 'cancel'],
      });
    }

    // 没有匹配
    return NextResponse.json({
      found: false,
      exactMatch: null,
      suggestions: [],
      message: '未找到匹配物料，建议创建新物料',
      action: 'create_new',
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// 文本归一化
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '')
    .replace(/[Ａ-Ｚａ-ｚ]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFF10))
    .replace(/[－—]/g, '-');
}

// 计算相似度（Levenshtein 距离）
function calculateSimilarity(s1: string, s2: string): number {
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;

  const len1 = s1.length;
  const len2 = s2.length;

  // 如果一个字符串包含另一个，提高相似度
  if (s1.includes(s2) || s2.includes(s1)) {
    const shorter = Math.min(len1, len2);
    const longer = Math.max(len1, len2);
    return shorter / longer;
  }

  // Levenshtein 距离
  const dp: number[][] = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));

  for (let i = 0; i <= len1; i++) dp[i][0] = i;
  for (let j = 0; j <= len2; j++) dp[0][j] = j;

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  const distance = dp[len1][len2];
  const maxLen = Math.max(len1, len2);
  return 1 - distance / maxLen;
}
