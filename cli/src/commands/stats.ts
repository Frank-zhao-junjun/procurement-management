import { Command } from 'commander';
import inquirer from 'inquirer';
import { apiGet, apiPost } from '../client.js';
import { printSuccess, printError, printInfo, printJSON, printTable } from '../utils.js';

export function registerStatsCommands(program: Command) {
  const stats = program.command('stats').description('Statistics and analytics');

  // Overview
  stats
    .command('overview')
    .description('Get system overview statistics')
    .option('--period <period>', 'Period: day | week | month | year', 'month')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const data = await apiGet(`/api/statistics?period=${options.period}`);

        if (options.json) {
          printJSON(data);
          return;
        }

        const d = data.data;
        printInfo(`Overview (${d.period}): ${d.startDate?.slice(0, 10)} ~ ${d.endDate?.slice(0, 10)}`);

        if (d.purchaseRequests) {
          printInfo('Purchase Requests:');
          printTable(
            ['Metric', 'Value'],
            [
              ['Total', d.purchaseRequests.total],
              ...Object.entries(d.purchaseRequests.byStatus || {}).map(([k, v]) => [`  ${k}`, String(v)]),
            ]
          );
        }

        if (d.purchaseOrders) {
          printInfo('Purchase Orders:');
          printTable(
            ['Metric', 'Value'],
            [
              ['Total', d.purchaseOrders.total],
              ['Total Amount', `¥${d.purchaseOrders.totalAmount?.toLocaleString()}`],
              ['Avg Amount', d.purchaseOrders.avgAmount != null ? `¥${d.purchaseOrders.avgAmount.toLocaleString()}` : '-'],
            ]
          );
        }

        if (d.goodsReceipts) {
          printInfo('Goods Receipts:');
          printTable(
            ['Metric', 'Value'],
            [
              ['Total', d.goodsReceipts.total],
              ['Received', d.goodsReceipts.received],
              ['Returned', d.goodsReceipts.returned],
              ['Net', d.goodsReceipts.netReceived],
            ]
          );
        }

        if (d.suppliers) {
          printInfo('Suppliers:');
          printTable(
            ['Metric', 'Value'],
            [
              ['Total', d.suppliers.total],
              ['Active', d.suppliers.active],
              ['Inactive', d.suppliers.inactive],
            ]
          );
        }
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // Trend
  stats
    .command('trend')
    .description('Get trend data')
    .option('--metric <metric>', 'Metric: pr_count | po_count | po_amount | gr_count', 'po_amount')
    .option('--period <period>', 'Period: day | week | month', 'month')
    .option('--periods <n>', 'Number of periods', '6')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const body = {
          metric: options.metric,
          period: options.period,
          periods: parseInt(options.periods, 10),
        };
        const data = await apiPost('/api/statistics/trend', body);

        if (options.json) {
          printJSON(data);
          return;
        }

        const d = data.data;
        printInfo(`Trend: ${d.metric} by ${d.period} (${d.periods} periods)`);

        if (d.trend?.length > 0) {
          printTable(
            ['Period', 'Value'],
            d.trend.map((t: any) => [t.date || t.period, t.value?.toLocaleString()])
          );
        }

        if (d.summary) {
          printInfo('Summary:');
          printTable(
            ['Metric', 'Value'],
            [
              ['Average', d.summary.avg?.toLocaleString()],
              ['Min', d.summary.min?.toLocaleString()],
              ['Max', d.summary.max?.toLocaleString()],
              ['Latest', d.summary.latest?.toLocaleString()],
              ['Change', d.summary.change?.toLocaleString()],
            ]
          );
        }
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });
}
