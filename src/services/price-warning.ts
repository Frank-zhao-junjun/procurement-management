/**
 * Price Warning Service - 价格预警服务
 * 
 * 检查报价是否高于历史均价，触发预警事件
 */

// 价格预警阈值（超出历史均价的百分比）
const PRICE_HIGH_THRESHOLD = 0.1; // 10%

// 价格异常波动阈值
const PRICE_ABNORMAL_THRESHOLD = 0.5; // 50%

interface PriceCheckResult {
  isWarning: boolean;
  warningType?: 'high' | 'abnormal';
  materialId?: number;
  materialName: string;
  quotedPrice: number;
  historicalAvgPrice: number;
  priceIncreaseRatio?: number;
  priceChangeRatio?: number;
  previousPrice?: number;
  message?: string;
}

/**
 * 检查报价价格是否异常
 */
export async function checkQuotePrice(
  unitPrice: number,
  materialSnapshot: string,
  supplierId?: number
): Promise<PriceCheckResult> {
  const { getSupabaseClient } = await import('@/storage/database');

  const client = getSupabaseClient();

  // 查询历史成交价
  let query = client
    .from('purchase_order_lines')
    .select(`
      unit_price,
      created_at
    `)
    .ilike('material_snapshot', `%${materialSnapshot}%`)
    .not('unit_price', 'is', null)
    .order('created_at', { ascending: false })
    .limit(100);

  const { data, error } = await query;

  if (error || !data || data.length === 0) {
    // 没有历史数据，不触发预警
    return {
      isWarning: false,
      materialName: materialSnapshot,
      quotedPrice: unitPrice,
      historicalAvgPrice: 0,
    };
  }

  // 计算历史平均价
  const prices = data.map((d: any) => d.unit_price).filter((p: number) => p > 0);
  const historicalAvgPrice = prices.reduce((a: number, b: number) => a + b, 0) / prices.length;
  const latestPrice = prices[0]; // 最近的成交价

  // 检查是否高于历史均价
  if (historicalAvgPrice > 0) {
    const increaseRatio = (unitPrice - historicalAvgPrice) / historicalAvgPrice;

    if (increaseRatio > PRICE_HIGH_THRESHOLD) {
      // 高于历史均价超过阈值
      return {
        isWarning: true,
        warningType: 'high',
        materialName: materialSnapshot,
        quotedPrice: unitPrice,
        historicalAvgPrice: Math.round(historicalAvgPrice * 100) / 100,
        priceIncreaseRatio: Math.round(increaseRatio * 100) / 100,
        message: `报价 ¥${unitPrice} 高于历史均价 ¥${historicalAvgPrice.toFixed(2)} ${(increaseRatio * 100).toFixed(0)}%`,
      };
    }

    // 检查价格异常波动（与最近一次成交价相比）
    if (latestPrice > 0) {
      const changeRatio = Math.abs(unitPrice - latestPrice) / latestPrice;

      if (changeRatio > PRICE_ABNORMAL_THRESHOLD) {
        return {
          isWarning: true,
          warningType: 'abnormal',
          materialName: materialSnapshot,
          quotedPrice: unitPrice,
          historicalAvgPrice: Math.round(historicalAvgPrice * 100) / 100,
          previousPrice: latestPrice,
          priceChangeRatio: Math.round(changeRatio * 100) / 100,
          message: `报价 ¥${unitPrice} 与最近成交价 ¥${latestPrice} 差异 ${(changeRatio * 100).toFixed(0)}%`,
        };
      }
    }
  }

  return {
    isWarning: false,
    materialName: materialSnapshot,
    quotedPrice: unitPrice,
    historicalAvgPrice: Math.round(historicalAvgPrice * 100) / 100,
  };
}

/**
 * 批量检查报价价格
 */
export async function checkBatchQuotePrices(
  quotes: Array<{
    unitPrice: number;
    materialSnapshot: string;
    supplierId?: number;
  }>
): Promise<PriceCheckResult[]> {
  const results: PriceCheckResult[] = [];

  for (const quote of quotes) {
    const result = await checkQuotePrice(
      quote.unitPrice,
      quote.materialSnapshot,
      quote.supplierId
    );
    if (result.isWarning) {
      results.push(result);
    }
  }

  return results;
}

/**
 * 获取物料的价格统计
 */
export async function getMaterialPriceStats(
  materialName: string
): Promise<{
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  latestPrice: number;
  count: number;
}> {
  const { getSupabaseClient } = await import('@/storage/database');

  const client = getSupabaseClient();

  const { data, error } = await client
    .from('purchase_order_lines')
    .select('unit_price')
    .ilike('material_snapshot', `%${materialName}%`)
    .not('unit_price', 'is', null)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error || !data || data.length === 0) {
    return {
      avgPrice: 0,
      minPrice: 0,
      maxPrice: 0,
      latestPrice: 0,
      count: 0,
    };
  }

  const prices = data.map((d: any) => d.unit_price).filter((p: number) => p > 0);

  return {
    avgPrice: Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100,
    minPrice: Math.min(...prices),
    maxPrice: Math.max(...prices),
    latestPrice: prices[0],
    count: prices.length,
  };
}
