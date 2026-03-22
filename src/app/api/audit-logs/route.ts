import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { getUserIdentity, type Role } from '@/lib/role-filter';

// GET /api/audit-logs - 获取审计日志列表
// Manager 可查看所有；其他角色只能查看自己操作的
export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { actor, role } = getUserIdentity(request) as { actor: string; role: Role };
    const searchParams = request.nextUrl.searchParams;
    const entityType = searchParams.get('entityType');
    const entityId = searchParams.get('entityId');
    const filterActor = searchParams.get('actor');
    const action = searchParams.get('action');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '50', 10);
    const offset = (page - 1) * pageSize;

    let query = client
      .from('audit_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (entityType) {
      query = query.eq('entity_type', entityType);
    }

    if (entityId) {
      query = query.eq('entity_id', parseInt(entityId, 10));
    }

    if (action) {
      query = query.eq('action', action);
    }

    // 按角色过滤
    // Manager 可看所有；其他角色只能看自己操作的
    if (role !== 'manager') {
      query = query.eq('actor', actor);
    } else if (filterActor) {
      // Manager 可以指定查看某个 actor 的日志
      query = query.eq('actor', filterActor);
    }

    const { data, error, count } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      data,
      total: count || 0,
      page,
      pageSize,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
