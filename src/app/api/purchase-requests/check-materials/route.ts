import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';

/**
 * POST /api/purchase-requests/check-materials
 * 
 * 在创建采购申请前检查物料匹配情况
 * 
 * 请求体:
 * {
 *   "lines": [
 *     { "requirementText": "无线鼠标", "quantity": 10 },
 *     { "requirementText": "蓝牙键盘", "quantity": 5 }
 *   ]
 * }
 * 
 * 返回:
 * {
 *   "canProceed": boolean,
 *   "lines": [
 *     {
 *       "requirementText": "无线鼠标",
 *       "found": true,
 *       "exactMatch": { id, code, name, unit },
 *       "suggestions": [...],
 *       "action": "use_existing" | "create_new" | "confirm" | "cancel"
 *     }
 *   ],
 *   "summary": {
 *     "total": 2,
 *     "exactMatches": 1,
 *     "needConfirm": 1,
 *     "notFound": 0
 *   },
 *   "nextAction": "create_pr" | "confirm_materials" | "all_cancelled"
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const body = await request.json();
    const lines = body.lines || [];

    if (lines.length === 0) {
      return NextResponse.json({ error: 'lines 不能为空' }, { status: 400 });
    }

    // 获取所有活跃物料
    const { data: materials, error } = await client
      .from('materials')
      .select('*')
      .eq('is_active', true);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const materialList = materials || [];

    // 检查每一行的物料匹配
    const checkedLines = lines.map((line: any) => {
      const text = line.requirementText?.trim();
      if (!text) {
        return {
          requirementText: line.requirementText,
          found: false,
          exactMatch: null,
          suggestions: [],
          action: 'cancel',
          message: '需求描述为空',
        };
      }

      const normalizedText = normalizeText(text);

      // 计算相似度
      const matches = materialList.map((m: any) => {
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
        };
      }).sort((a: any, b: any) => b.similarity - a.similarity);

      // 检查精确匹配 (>= 0.95)
      const exactMatch = matches.find((m: any) => m.similarity >= 0.95);
      if (exactMatch) {
        return {
          requirementText: text,
          found: true,
          exactMatch: exactMatch.material,
          suggestions: [],
          action: 'use_existing',
          message: `找到精确匹配: ${exactMatch.material.name}`,
        };
      }

      // 检查相似匹配 (>= 0.3)
      const suggestions = matches.filter((m: any) => m.similarity >= 0.3).slice(0, 5);
      
      if (suggestions.length > 0) {
        return {
          requirementText: text,
          found: true,
          exactMatch: null,
          suggestions: suggestions.map((s: any) => ({
            ...s,
            matchType: s.similarity >= 0.7 ? 'high' : s.similarity >= 0.5 ? 'medium' : 'low',
          })),
          action: 'confirm',
          message: `找到 ${suggestions.length} 个相似物料，请确认`,
        };
      }

      // 没有匹配
      return {
        requirementText: text,
        found: false,
        exactMatch: null,
        suggestions: [],
        action: 'create_new',
        message: '未找到匹配物料，建议创建新物料',
      };
    });

    // 统计
    const summary = {
      total: lines.length,
      exactMatches: checkedLines.filter((l: any) => l.action === 'use_existing').length,
      needConfirm: checkedLines.filter((l: any) => l.action === 'confirm').length,
      notFound: checkedLines.filter((l: any) => l.action === 'create_new').length,
    };

    // 决定下一步动作
    let nextAction = 'create_pr';
    if (summary.needConfirm > 0 || summary.notFound > 0) {
      nextAction = 'confirm_materials';
    }
    if (checkedLines.every((l: any) => l.action === 'cancel')) {
      nextAction = 'all_cancelled';
    }

    return NextResponse.json({
      canProceed: summary.needConfirm === 0 && summary.notFound === 0,
      lines: checkedLines,
      summary,
      nextAction,
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

// 计算相似度
function calculateSimilarity(s1: string, s2: string): number {
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;

  const len1 = s1.length;
  const len2 = s2.length;

  // 包含关系提高相似度
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
        dp[i][j - 1]  + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  const distance = dp[len1][len2];
  const maxLen = Math.max(len1, len2);
  return 1 - distance / maxLen;
}
