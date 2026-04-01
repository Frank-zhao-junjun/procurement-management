import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { getUserIdentityWithLookup } from '@/lib/role-filter';

/**
 * POST /api/purchase-requests/confirm-materials
 * 
 * 确认物料选择并创建采购申请
 * 
 * 请求体:
 * {
 *   "reason": "办公设备采购",
 *   "lines": [
 *     {
 *       "requirementText": "无线鼠标",
 *       "quantity": 10,
 *       "confirmedMaterialId": 5,  // 使用现有物料ID
 *       "confirmedMaterialName": null  // 或创建新物料的名称
 *     },
 *     {
 *       "requirementText": "蓝牙键盘",
 *       "quantity": 5,
 *       "confirmedMaterialId": null,
 *       "confirmedMaterialName": "蓝牙键盘",  // 创建新物料
 *       "confirmedMaterialUnit": "个"
 *     }
 *   ],
 *   "cancelledLines": [2, 3]  // 取消的行索引（可选）
 * }
 * 
 * 如果所有行都被取消或确认结果为空，则不创建 PR
 */
export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);
    const body = await request.json();
    const lines = body.lines || [];
    const cancelledLines = body.cancelledLines || [];

    if (lines.length === 0) {
      return NextResponse.json({
        created: false,
        message: '没有需要处理的采购行，采购申请未创建',
      });
    }

    // 过滤掉取消的行
    const activeLines = lines.filter((_: any, index: number) => !cancelledLines.includes(index));

    if (activeLines.length === 0) {
      return NextResponse.json({
        created: false,
        message: '所有采购行已被取消，采购申请未创建',
      });
    }

    // 检查每行是否有确认的物料
    const unconfirmedLines = activeLines.filter((line: any) => 
      !line.confirmedMaterialId && !line.confirmedMaterialName
    );

    if (unconfirmedLines.length > 0) {
      return NextResponse.json({
        created: false,
        error: '部分行未确认物料',
        unconfirmedLines: unconfirmedLines.map((l: any) => l.requirementText),
      }, { status: 400 });
    }

    // 处理需要创建的新物料
    const newMaterialLines = activeLines.filter((line: any) => 
      !line.confirmedMaterialId && line.confirmedMaterialName
    );

    const createdMaterials: any[] = [];
    for (const line of newMaterialLines) {
      // 检查是否已存在同名物料
      const { data: existing } = await client
        .from('materials')
        .select('id')
        .eq('name', line.confirmedMaterialName)
        .eq('is_active', true)
        .single();

      if (existing) {
        line.confirmedMaterialId = existing.id;
      } else {
        // 创建新物料
        const { data: newMaterial, error: materialError } = await client
          .from('materials')
          .insert({
            name: line.confirmedMaterialName,
            code: `NEW-${Date.now()}`,
            unit: line.confirmedMaterialUnit || '个',
            is_active: true,
          })
          .select()
          .single();

        if (materialError) {
          return NextResponse.json({ 
            error: `创建物料失败: ${materialError.message}` 
          }, { status: 500 });
        }

        line.confirmedMaterialId = newMaterial.id;
        createdMaterials.push(newMaterial);
      }
    }

    // 生成 PR 编号
    const prNumber = await generatePRNumber();

    // 创建 PR 主表
    const linesSnapshot = JSON.stringify(activeLines);
    const { data: pr, error: prError } = await client
      .from('purchase_requests')
      .insert({
        pr_number: prNumber,
        applicant: actor,
        applicant_role: role,
        reason: body.reason || '',
        status: 'draft',
        lines_snapshot: linesSnapshot,
      })
      .select()
      .single();

    if (prError) {
      return NextResponse.json({ error: prError.message }, { status: 500 });
    }

    // 创建 PR 行
    const prLines = activeLines.map((line: any, index: number) => ({
      request_id: pr.id,
      line_number: index + 1,
      material_id: line.confirmedMaterialId,
      material_snapshot: line.confirmedMaterialName || line.requirementText,
      requirement_text: line.requirementText,
      quantity: line.quantity,
      est_unit_price: line.estUnitPrice || null,
      expected_delivery_date: line.expectedDeliveryDate || null,
      note: line.note || null,
      progress: 'pending',
    }));

    const { error: linesError } = await client
      .from('purchase_request_lines')
      .insert(prLines);

    if (linesError) {
      await client.from('purchase_requests').delete().eq('id', pr.id);
      return NextResponse.json({ error: linesError.message }, { status: 500 });
    }

    // 记录审计日志
    await client.from('audit_logs').insert({
      entity_type: 'purchase_request',
      entity_id: pr.id,
      action: 'create',
      actor,
      actor_role: role,
      detail: { 
        pr_number: prNumber, 
        lines_count: activeLines.length,
        new_materials_created: createdMaterials.length,
      },
    });

    return NextResponse.json({
      created: true,
      data: {
        id: pr.id,
        pr_number: prNumber,
        status: 'draft',
        lines_count: activeLines.length,
        new_materials: createdMaterials,
      },
    }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// 生成 PR 编号
async function generatePRNumber(): Promise<string> {
  const client = getSupabaseClient();
  
  // 获取上海时区日期
  const now = new Date();
  const shanghaiDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  
  const dateStr = shanghaiDate.replace(/-/g, '');
  const prefix = `PR-${dateStr}-`;

  // 查询今天的 PR 数量
  const { data, error } = await client
    .from('purchase_requests')
    .select('pr_number')
    .like('pr_number', `${prefix}%`)
    .order('pr_number', { ascending: false })
    .limit(1);

  if (error) {
    console.error('Error generating PR number:', error);
  }

  let seq = 1;
  if (data && data.length > 0) {
    const lastNumber = data[0].pr_number;
    const lastSeq = parseInt(lastNumber.split('-')[2], 10);
    if (!isNaN(lastSeq)) {
      seq = lastSeq + 1;
    }
  }

  if (seq > 99) {
    throw new Error('今日 PR 编号已达上限（99）');
  }

  return `${prefix}${String(seq).padStart(2, '0')}`;
}
