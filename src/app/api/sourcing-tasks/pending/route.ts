import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { getUserIdentityWithLookup } from '@/lib/role-filter';

// GET /api/sourcing-tasks/pending - 获取待寻源的采购申请行
// 返回需要创建寻源任务的 PR 行（FA 匹配失败或尚未分配供应商的）
export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { role } = await getUserIdentityWithLookup(request);

    // 仅 buyer 和 manager 可以查看
    if (role !== 'buyer' && role !== 'manager') {
      return NextResponse.json(
        { error: '只有 Buyer 或 Manager 可以查看待寻源列表' },
        { status: 403 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
    const offset = (page - 1) * pageSize;

    // 查询待寻源的 PR 行：状态为 pending_sourcing 且没有关联寻源任务的
    // 或者状态为 fa_match_failed 的
    const { data, error, count } = await client
      .from('purchase_request_lines')
      .select(`
        *,
        purchase_requests!inner(
          id,
          pr_number,
          status,
          applicant,
          reason
        ),
        materials(id, code, name, unit)
      `, { count: 'exact' })
      .in('progress', ['pending_sourcing', 'fa_match_failed'])
      .eq('purchase_requests.status', 'approved')
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error('Error fetching pending sourcing:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 检查每行是否已有寻源任务
    const lineIds = data?.map((line: any) => line.id) || [];
    let sourcingTaskMap: Record<number, any> = {};

    if (lineIds.length > 0) {
      const { data: tasks } = await client
        .from('sourcing_tasks')
        .select('id, pr_line_id, status, task_number')
        .in('pr_line_id', lineIds);

      if (tasks) {
        tasks.forEach((task: any) => {
          sourcingTaskMap[task.pr_line_id] = task;
        });
      }
    }

    // 组装结果，标记每行是否已有寻源任务
    const result = (data || []).map((line: any) => ({
      id: line.id,
      prId: line.request_id,
      prNumber: line.purchase_requests?.pr_number,
      prReason: line.purchase_requests?.reason,
      applicant: line.purchase_requests?.applicant,
      materialId: line.material_id,
      materialCode: line.materials?.code,
      materialName: line.materials?.name || line.material_snapshot,
      unit: line.materials?.unit,
      quantity: line.quantity,
      estUnitPrice: line.est_unit_price,
      requirementText: line.requirement_text,
      progress: line.progress,
      sourcingTaskId: sourcingTaskMap[line.id]?.id || null,
      sourcingTaskNumber: sourcingTaskMap[line.id]?.task_number || null,
      sourcingTaskStatus: sourcingTaskMap[line.id]?.status || null,
      hasSourcingTask: !!sourcingTaskMap[line.id],
      createdAt: line.created_at,
    }));

    return NextResponse.json({
      data: result,
      total: count || 0,
      page,
      pageSize,
    });
  } catch (error: any) {
    console.error('Error in pending sourcing:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
