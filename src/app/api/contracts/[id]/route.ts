import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { getUserIdentityWithLookup } from '@/lib/role-filter';
import { onContractPending } from '@/lib/agent-notify';

/**
 * GET /api/contracts/[id] - 获取单个框架协议
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();

    const { data, error } = await client
      .from('contracts')
      .select('*')
      .eq('id', parseInt(id, 10))
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PUT /api/contracts/[id] - 更新框架协议
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const body = await request.json();
    const { actor, role } = await getUserIdentityWithLookup(request);

    // 检查当前状态
    const { data: existing, error: findError } = await client
      .from('contracts')
      .select('id, status')
      .eq('id', parseInt(id, 10))
      .single();

    if (findError) {
      return NextResponse.json({ error: findError.message }, { status: 500 });
    }

    if (!existing) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
    }

    // 构建更新数据
    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (body.title !== undefined) updateData.title = body.title;
    if (body.validFrom !== undefined) updateData.valid_from = body.validFrom;
    if (body.valid_until !== undefined) updateData.valid_until = body.valid_until;
    if (body.paymentTerms !== undefined) updateData.payment_terms = body.paymentTerms;
    if (body.deliveryTerms !== undefined) updateData.delivery_terms = body.deliveryTerms;
    if (body.description !== undefined) updateData.description = body.description;

    // 状态变更
    if (body.status !== undefined) {
      updateData.status = body.status;
    }

    const { data, error } = await client
      .from('contracts')
      .update(updateData)
      .eq('id', parseInt(id, 10))
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 记录审计日志
    await client.from('audit_logs').insert({
      entity_type: 'contract',
      entity_id: parseInt(id, 10),
      action: 'update',
      actor,
      actor_role: role,
      detail: body,
    });

    return NextResponse.json({ data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/contracts/[id] - 删除框架协议
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const { actor, role } = await getUserIdentityWithLookup(request);

    // 检查状态
    const { data: existing } = await client
      .from('contracts')
      .select('id, status')
      .eq('id', parseInt(id, 10))
      .single();

    if (existing && existing.status !== 'draft') {
      return NextResponse.json(
        { error: 'Only draft contracts can be deleted' },
        { status: 400 }
      );
    }

    await client
      .from('contracts')
      .delete()
      .eq('id', parseInt(id, 10));

    // 记录审计日志
    await client.from('audit_logs').insert({
      entity_type: 'contract',
      entity_id: parseInt(id, 10),
      action: 'delete',
      actor,
      actor_role: role,
      detail: {},
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
