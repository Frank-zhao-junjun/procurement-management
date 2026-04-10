/**
 * Audit Logs Entity History API - 实体变更历史
 * 
 * GET /api/audit-logs/entity/:type/:id - 获取单个实体的变更历史
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { getUserIdentityWithLookup } from '@/lib/role-filter';

// GET /api/audit-logs/entity/:type/:id - 获取实体变更历史
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> }
) {
  try {
    const { type, id } = await params;
    const entityId = parseInt(id, 10);

    if (isNaN(entityId)) {
      return NextResponse.json({ error: '无效的实体 ID' }, { status: 400 });
    }

    // 权限检查
    const { role } = await getUserIdentityWithLookup(request);
    if (!role) {
      return NextResponse.json({ error: '未认证' }, { status: 401 });
    }

    const client = getSupabaseClient();

    // 查询该实体的所有变更记录
    const { data, error } = await client
      .from('audit_logs')
      .select('*')
      .eq('entity_type', type)
      .eq('entity_id', entityId)
      .order('created_at', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 分析变更详情
    const history = (data || []).map((log) => ({
      id: log.id,
      action: log.action,
      actor: log.actor,
      actorRole: log.actor_role,
      detail: log.detail,
      timestamp: log.created_at,
    }));

    // 生成变更摘要
    const summary = {
      entityType: type,
      entityId,
      totalChanges: history.length,
      firstChange: history.length > 0 ? history[0].timestamp : null,
      lastChange: history.length > 0 ? history[history.length - 1].timestamp : null,
      actors: [...new Set(history.map((h) => h.actor))],
      actions: [...new Set(history.map((h) => h.action))],
    };

    return NextResponse.json({
      data: {
        summary,
        history,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
