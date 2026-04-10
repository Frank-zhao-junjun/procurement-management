/**
 * Procurement Statistics API - 采购数据统计分析
 * 
 * 提供采购管理相关的统计和分析功能
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database';
import { getUserIdentityWithLookup } from '@/lib/role-filter';
import { z } from 'zod';

// ============ GET /api/statistics/overview - 获取概览统计 ============

export async function GET(request: NextRequest) {
  try {
    // 权限检查
    const { role } = await getUserIdentityWithLookup(request);
    if (!role) {
      return NextResponse.json({ error: '未认证' }, { status: 401 });
    }

    const client = getSupabaseClient();
    const searchParams = request.nextUrl.searchParams;
    const period = searchParams.get('period') || 'month'; // day, week, month, quarter, year

    // 计算日期范围
    const now = new Date();
    let startDate: Date;
    let endDate = now;

    switch (period) {
      case 'day':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'quarter':
        const quarter = Math.floor(now.getMonth() / 3);
        startDate = new Date(now.getFullYear(), quarter * 3, 1);
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const startDateStr = startDate.toISOString();
    const endDateStr = endDate.toISOString();

    // 并行查询多个统计指标
    const [
      prStats,
      poStats,
      grStats,
      supplierStats,
      materialStats,
    ] = await Promise.all([
      // PR 统计
      getPRStats(client, startDateStr, endDateStr),
      // PO 统计
      getPOStats(client, startDateStr, endDateStr),
      // GR 统计
      getGRStats(client, startDateStr, endDateStr),
      // 供应商统计
      getSupplierStats(client),
      // 物料统计
      getMaterialStats(client),
    ]);

    return NextResponse.json({
      data: {
        period,
        startDate: startDateStr,
        endDate: endDateStr,
        generatedAt: new Date().toISOString(),
        purchaseRequests: prStats,
        purchaseOrders: poStats,
        goodsReceipts: grStats,
        suppliers: supplierStats,
        materials: materialStats,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ============ 获取 PR 统计 ============

async function getPRStats(
  client: any,
  startDate: string,
  endDate: string
): Promise<any> {
  const { data, error } = await client
    .from('purchase_requests')
    .select('status, created_at')
    .gte('created_at', startDate)
    .lte('created_at', endDate);

  if (error) {
    return { total: 0, byStatus: {} };
  }

  const byStatus = new Map<string, number>();
  for (const pr of data || []) {
    byStatus.set(pr.status, (byStatus.get(pr.status) || 0) + 1);
  }

  return {
    total: (data || []).length,
    byStatus: Object.fromEntries(byStatus),
  };
}

// ============ 获取 PO 统计 ============

async function getPOStats(
  client: any,
  startDate: string,
  endDate: string
): Promise<any> {
  // 查询 PO 及其行
  const { data, error } = await client
    .from('purchase_orders')
    .select(`
      id,
      status,
      total_amount,
      created_at,
      supplier_id,
      purchase_order_lines (
        quantity,
        unit_price
      )
    `)
    .gte('created_at', startDate)
    .lte('created_at', endDate);

  if (error) {
    return { total: 0, totalAmount: 0, byStatus: {} };
  }

  const byStatus = new Map<string, number>();
  let totalAmount = 0;

  for (const po of data || []) {
    byStatus.set(po.status, (byStatus.get(po.status) || 0) + 1);
    totalAmount += po.total_amount || 0;
  }

  return {
    total: (data || []).length,
    totalAmount: Math.round(totalAmount * 100) / 100,
    avgAmount: (data || []).length > 0
      ? Math.round((totalAmount / (data || []).length) * 100) / 100
      : 0,
    byStatus: Object.fromEntries(byStatus),
  };
}

// ============ 获取 GR 统计 ============

async function getGRStats(
  client: any,
  startDate: string,
  endDate: string
): Promise<any> {
  const { data, error } = await client
    .from('goods_receipts')
    .select('gr_type, status, quantity')
    .gte('created_at', startDate)
    .lte('created_at', endDate);

  if (error) {
    return { total: 0, received: 0, returned: 0, byStatus: {} };
  }

  const byStatus = new Map<string, number>();
  let received = 0;
  let returned = 0;

  for (const gr of data || []) {
    byStatus.set(gr.status, (byStatus.get(gr.status) || 0) + 1);
    if (gr.gr_type === 'in') {
      received += gr.quantity || 0;
    } else {
      returned += gr.quantity || 0;
    }
  }

  return {
    total: (data || []).length,
    received,
    returned,
    netReceived: received - returned,
    byStatus: Object.fromEntries(byStatus),
  };
}

// ============ 获取供应商统计 ============

async function getSupplierStats(client: any): Promise<any> {
  const { data, error } = await client
    .from('suppliers')
    .select('is_active');

  if (error) {
    return { total: 0, active: 0, inactive: 0 };
  }

  let active = 0;
  let inactive = 0;

  for (const s of data || []) {
    if (s.is_active) {
      active++;
    } else {
      inactive++;
    }
  }

  return {
    total: (data || []).length,
    active,
    inactive,
  };
}

// ============ 获取物料统计 ============

async function getMaterialStats(client: any): Promise<any> {
  const { data, error } = await client
    .from('materials')
    .select('is_active');

  if (error) {
    return { total: 0, active: 0, inactive: 0 };
  }

  let active = 0;
  let inactive = 0;

  for (const m of data || []) {
    if (m.is_active) {
      active++;
    } else {
      inactive++;
    }
  }

  return {
    total: (data || []).length,
    active,
    inactive,
  };
}

// ============ POST /api/statistics/trend - 获取趋势数据 ============

const TrendQuerySchema = z.object({
  metric: z.enum(['pr_count', 'pr_amount', 'po_count', 'po_amount', 'gr_quantity']),
  period: z.enum(['day', 'week', 'month']),
  periods: z.number().min(1).max(52).default(12),
});

export async function POST(request: NextRequest) {
  try {
    // 权限检查
    const { role } = await getUserIdentityWithLookup(request);
    if (!role) {
      return NextResponse.json({ error: '未认证' }, { status: 401 });
    }

    const body = await request.json();

    // 验证请求体
    const validation = TrendQuerySchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          error: '请求参数验证失败',
          details: validation.error.issues.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        },
        { status: 400 }
      );
    }

    const { metric, period, periods } = validation.data;
    const client = getSupabaseClient();

    // 计算每个时间段的数据
    const now = new Date();
    const trend: Array<{ date: string; value: number }> = [];

    for (let i = periods - 1; i >= 0; i--) {
      let startDate: Date;
      let endDate: Date;
      let label: string;

      switch (period) {
        case 'day':
          startDate = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
          endDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);
          label = startDate.toISOString().split('T')[0];
          break;
        case 'week':
          startDate = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
          endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);
          label = `W${getWeekNumber(startDate)}`;
          break;
        case 'month':
          startDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
          endDate = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
          label = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;
          break;
      }

      const value = await getMetricValue(client, metric, startDate.toISOString(), endDate.toISOString());

      trend.push({ date: label, value });
    }

    return NextResponse.json({
      data: {
        metric,
        period,
        periods,
        trend,
        summary: {
          avg: trend.reduce((a, b) => a + b.value, 0) / trend.length,
          min: Math.min(...trend.map((t) => t.value)),
          max: Math.max(...trend.map((t) => t.value)),
          latest: trend[trend.length - 1]?.value || 0,
          change: trend.length >= 2
            ? trend[trend.length - 1].value - trend[trend.length - 2].value
            : 0,
        },
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// 获取某个指标的值
async function getMetricValue(
  client: any,
  metric: string,
  startDate: string,
  endDate: string
): Promise<number> {
  let query;

  switch (metric) {
    case 'pr_count':
      query = client.from('purchase_requests').select('id', { count: 'exact' });
      break;
    case 'po_count':
      query = client.from('purchase_orders').select('id', { count: 'exact' });
      break;
    case 'po_amount':
      const { data: poData } = await client
        .from('purchase_orders')
        .select('total_amount')
        .gte('created_at', startDate)
        .lte('created_at', endDate);
      return (poData || []).reduce((sum: number, po: any) => sum + (po.total_amount || 0), 0);
    case 'gr_quantity':
      const { data: grData } = await client
        .from('goods_receipts')
        .select('quantity, gr_type')
        .gte('created_at', startDate)
        .lte('created_at', endDate);
      return (grData || [])
        .filter((gr: any) => gr.gr_type === 'in')
        .reduce((sum: number, gr: any) => sum + (gr.quantity || 0), 0);
    default:
      return 0;
  }

  if (query) {
    query = query.gte('created_at', startDate).lte('created_at', endDate);
    const { count } = await query;
    return count || 0;
  }

  return 0;
}

// 获取周数
function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
