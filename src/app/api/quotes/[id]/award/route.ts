import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { numberGenerators } from '@/storage/database/number-generator';
import { getUserIdentityWithLookup, canCreatePO, type Role } from '@/lib/role-filter';
import { getRequesterWebhooks } from '@/storage/database/agent-binding';

/**
 * POST /api/quotes/[id]/award - 授标（标记为中标）
 * 仅 buyer 和 manager 可操作
 * 
 * 流程：
 * 1. 标记报价单为 awarded
 * 2. 自动创建 PO
 * 3. 更新寻源任务状态
 * 4. 更新 PR 行状态
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);

    // 权限检查
    if (!canCreatePO(role as Role)) {
      return NextResponse.json({ error: '只有 Buyer 或 Manager 可以授标' }, { status: 403 });
    }

    const quoteId = parseInt(id, 10);

    // 获取报价单详情
    const { data: quote, error: quoteError } = await client
      .from('quotes')
      .select(`
        *,
        sourcing_tasks!quotes_sourcing_task_id_fkey (
          id,
          task_number,
          pr_id,
          pr_line_id,
          material_id,
          material_snapshot
        )
      `)
      .eq('id', quoteId)
      .single();

    if (quoteError || !quote) {
      return NextResponse.json({ error: '报价单不存在' }, { status: 404 });
    }

    // 检查是否已授标
    if (quote.awarded === 'awarded') {
      return NextResponse.json({ error: '该报价单已授标' }, { status: 400 });
    }

    const sourcingTask = quote.sourcing_tasks;
    if (!sourcingTask) {
      return NextResponse.json({ error: '关联的寻源任务不存在' }, { status: 400 });
    }

    // 1. 更新报价单为已授标
    const { error: updateError } = await client
      .from('quotes')
      .update({ 
        awarded: 'awarded',
        updated_at: new Date().toISOString(),
      })
      .eq('id', quoteId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // 2. 取消同一寻源任务下其他报价单的授标状态
    await client
      .from('quotes')
      .update({ awarded: 'rejected' })
      .eq('sourcing_task_id', sourcingTask.id)
      .neq('id', quoteId);

    // 3. 创建 PO
    const poNumber = await numberGenerators.po();

    // 获取 PR 行的期望交货日期，如果没有则设置默认值（30天后）
    let deliveryDate: string;
    
    if (sourcingTask.pr_line_id) {
      const { data: prLine } = await client
        .from('purchase_request_lines')
        .select('expected_delivery_date')
        .eq('id', sourcingTask.pr_line_id)
        .single();
      
      deliveryDate = prLine?.expected_delivery_date || 
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    } else {
      // 没有关联 PR 行时，设置默认交货日期为30天后
      deliveryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    }

    const { data: po, error: poError } = await client
      .from('purchase_orders')
      .insert({
        po_number: poNumber,
        supplier_id: quote.supplier_id,
        supplier_snapshot: quote.supplier_snapshot,
        delivery_date: deliveryDate,
        status: 'draft',
        created_by: actor,
      })
      .select()
      .single();

    if (poError) {
      return NextResponse.json({ error: poError.message }, { status: 500 });
    }

    // 4. 创建 PO 行
    const { error: poLineError } = await client
      .from('purchase_order_lines')
      .insert({
        order_id: po.id,
        line_number: 1,
        pr_id: sourcingTask.pr_id,
        pr_line_id: sourcingTask.pr_line_id,
        material_id: quote.material_id || sourcingTask.material_id,
        material_snapshot: quote.material_snapshot || sourcingTask.material_snapshot,
        quantity: quote.quantity,
        unit_price: quote.unit_price,
        total_price: quote.total_price,
        received_qty: 0,
        pending_qty: quote.quantity,
        status: 'ordered',
        sourcing_task_id: sourcingTask.id,
      });

    if (poLineError) {
      // 回滚 PO
      await client.from('purchase_orders').delete().eq('id', po.id);
      return NextResponse.json({ error: poLineError.message }, { status: 500 });
    }

    // 5. 更新寻源任务状态
    await client
      .from('sourcing_tasks')
      .update({ 
        status: 'completed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', sourcingTask.id);

    // 6. 更新 PR 行状态
    await client
      .from('purchase_request_lines')
      .update({
        progress: 'ordered',
        purchase_order_id: po.id,
        po_line_number: 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sourcingTask.pr_line_id);

    // 7. 记录审计日志
    await client.from('audit_logs').insert([
      {
        entity_type: 'quote',
        entity_id: quoteId,
        action: 'award',
        actor,
        actor_role: role,
        detail: { quote_number: quote.quote_number, po_number: poNumber },
      },
      {
        entity_type: 'purchase_order',
        entity_id: po.id,
        action: 'create_from_award',
        actor,
        actor_role: role,
        detail: { 
          po_number: poNumber, 
          quote_id: quoteId,
          quote_number: quote.quote_number,
          sourcing_task_id: sourcingTask.id,
        },
      },
    ]);

    // 8. 通知 Requester Agent（PO 已生成）
    notifyRequesters({
      event: 'po_created',
      poId: po.id,
      poNumber: poNumber,
      prId: sourcingTask.pr_id,
      supplierName: quote.supplier_snapshot || '未知供应商',
      createdAt: new Date().toISOString(),
    }).catch(err => {
      console.error('Failed to notify requesters:', err);
    });

    return NextResponse.json({
      success: true,
      message: '授标成功，已自动创建采购订单',
      quote: {
        id: quoteId,
        quote_number: quote.quote_number,
        awarded: 'awarded',
      },
      purchaseOrder: {
        id: po.id,
        po_number: poNumber,
        status: 'draft',
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// 通知所有 Requester Agent（当 PO 生成时通知申请人）
async function notifyRequesters(payload: {
  event: string;
  poId: number;
  poNumber: string;
  prId?: number;
  prNumber?: string;
  supplierName: string;
  createdAt: string;
}): Promise<void> {
  const webhooks = await getRequesterWebhooks();

  if (webhooks.length === 0) {
    console.log('No requester webhooks configured');
    return;
  }

  const results = await Promise.allSettled(
    webhooks.map(async (webhookUrl) => {
      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'ProcurementSystem-Webhook/1.0',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return { url: webhookUrl, success: true };
      } catch (err) {
        return { url: webhookUrl, success: false, error: err instanceof Error ? err.message : 'Unknown error' };
      }
    })
  );

  const succeeded = results.filter(r => r.status === 'fulfilled' && (r as any).value.success).length;
  const failed = results.filter(r => r.status === 'rejected' || !(r as any).value.success).length;

  console.log(`Requester webhook notifications: ${succeeded} succeeded, ${failed} failed`);
}
