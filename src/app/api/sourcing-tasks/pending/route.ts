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
    // 注意：由于缺少部分外键约束，不使用 Supabase auto join，改用手动查询
    const { data, error, count } = await client
      .from('purchase_request_lines')
      .select('*', { count: 'exact' })
      .in('progress', ['pending_sourcing', 'fa_match_failed'])
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error('Error fetching pending sourcing:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 过滤出关联 PR 状态为 approved 的行（替代 !inner 过滤）
    const lineData = data || [];
    const prIds = [...new Set(lineData.map((line: any) => line.request_id).filter(Boolean))];
    
    let prMap: Record<number, any> = {};
    if (prIds.length > 0) {
      const { data: prs } = await client
        .from('purchase_requests')
        .select('id, pr_number, status, applicant, reason')
        .in('id', prIds)
        .eq('status', 'approved');
      
      if (prs) {
        prs.forEach((pr: any) => { prMap[pr.id] = pr; });
      }
    }

    // 只保留 PR 状态为 approved 的行
    const approvedLines = lineData.filter((line: any) => prMap[line.request_id]);

    // 批量查询物料信息
    const materialIds = [...new Set(approvedLines.map((line: any) => line.material_id).filter(Boolean))];
    let materialMap: Record<number, any> = {};
    if (materialIds.length > 0) {
      const { data: mats } = await client
        .from('materials')
        .select('id, code, name, unit')
        .in('id', materialIds);
      
      if (mats) {
        mats.forEach((mat: any) => { materialMap[mat.id] = mat; });
      }
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
    const result = approvedLines.map((line: any) => {
      const pr = prMap[line.request_id];
      const mat = materialMap[line.material_id];
      return {
        id: line.id,
        prId: line.request_id,
        prNumber: pr?.pr_number,
        prReason: pr?.reason,
        applicant: pr?.applicant,
        materialId: line.material_id,
        materialCode: mat?.code,
        materialName: mat?.name || line.material_snapshot,
        unit: mat?.unit,
        quantity: line.quantity,
        estUnitPrice: line.est_unit_price,
        requirementText: line.requirement_text,
        progress: line.progress,
        sourcingTaskId: sourcingTaskMap[line.id]?.id || null,
        sourcingTaskNumber: sourcingTaskMap[line.id]?.task_number || null,
        sourcingTaskStatus: sourcingTaskMap[line.id]?.status || null,
        hasSourcingTask: !!sourcingTaskMap[line.id],
        createdAt: line.created_at,
      };
    });

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
