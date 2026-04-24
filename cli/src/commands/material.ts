import { Command } from 'commander';
import inquirer from 'inquirer';
import { apiGet, apiPost } from '../client.js';
import { printSuccess, printError, printInfo, printJSON, printTable, truncate, formatDate } from '../utils.js';

export function registerMaterialCommands(program: Command) {
  const material = program.command('material').alias('m').description('Material management');

  // List materials
  material
    .command('list')
    .description('List materials')
    .option('-p, --page <page>', 'Page number', '1')
    .option('-s, --size <size>', 'Page size', '20')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const data = await apiGet(`/api/materials?page=${options.page}&pageSize=${options.size}`);

        if (options.json) {
          printJSON(data);
          return;
        }

        if (!data.data || data.data.length === 0) {
          printInfo('No materials found');
          return;
        }

        printTable(
          ['ID', 'Code', 'Name', 'Unit', 'Status', 'Created'],
          data.data.map((m: any) => [
            m.id,
            m.code || '-',
            truncate(m.name, 30),
            m.unit || '-',
            m.status || '-',
            formatDate(m.created_at),
          ])
        );
        printInfo(`Page ${data.page}/${Math.ceil(data.total / data.pageSize)} | Total: ${data.total}`);
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // Match material
  material
    .command('match <text>')
    .description('Check if a material exists by text')
    .option('--json', 'Output as JSON')
    .action(async (text, options) => {
      try {
        const data = await apiGet(`/api/materials/match?text=${encodeURIComponent(text)}`);

        if (options.json) {
          printJSON(data);
          return;
        }

        if (data.found) {
          printSuccess(`Found: ${data.exactMatch?.name || text}`);
          printInfo(`Action: ${data.action}`);
          if (data.exactMatch) {
            printTable(
              ['ID', 'Code', 'Name', 'Unit'],
              [[data.exactMatch.id, data.exactMatch.code || '-', data.exactMatch.name, data.exactMatch.unit || '-']]
            );
          }
        } else {
          printInfo(`Not found: ${text}`);
          printInfo(`Action: ${data.action}`);
        }
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // Create material
  material
    .command('create')
    .description('Create a new material')
    .option('-n, --name <name>', 'Material name')
    .option('-c, --code <code>', 'Material code')
    .option('-u, --unit <unit>', 'Unit of measure')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        let { name, code, unit } = options;

        if (!name) {
          const answers = await inquirer.prompt([
            { type: 'input', name: 'name', message: 'Material name:', validate: (v) => v.length > 0 },
            { type: 'input', name: 'code', message: 'Material code (optional):' },
            { type: 'input', name: 'unit', message: 'Unit (e.g. 个, kg, m):', default: '个' },
          ]);
          name = answers.name;
          code = answers.code || undefined;
          unit = answers.unit;
        }

        const body: any = { name, unit };
        if (code) body.code = code;

        const data = await apiPost('/api/materials', body);
        printSuccess('Material created');
        if (options.json) {
          printJSON(data);
        } else if (data.data) {
          printTable(
            ['ID', 'Name', 'Unit'],
            [[data.data.id, data.data.name, data.data.unit]]
          );
        }
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // Price history
  material
    .command('history <id>')
    .description('Get price history for a material')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const data = await apiGet(`/api/materials/${id}/price-history`);

        if (options.json) {
          printJSON(data);
          return;
        }

        const stats = data.data?.statistics;
        if (stats) {
          printInfo('Price Statistics:');
          printTable(
            ['Avg', 'Min', 'Max', 'Latest', 'Count'],
            [[
              stats.avgPrice?.toFixed(2) || '-',
              stats.minPrice?.toFixed(2) || '-',
              stats.maxPrice?.toFixed(2) || '-',
              stats.latestPrice?.toFixed(2) || '-',
              stats.count,
            ]]
          );
        }

        const history = data.data?.history || [];
        if (history.length > 0) {
          printInfo('History:');
          printTable(
            ['Date', 'Price', 'Supplier'],
            history.map((h: any) => [
              formatDate(h.date || h.created_at),
              h.unit_price?.toFixed(2) || h.price?.toFixed(2) || '-',
              truncate(h.supplier_name || h.supplierSnapshot || '-', 30),
            ])
          );
        }
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // Compare price
  material
    .command('compare <name>')
    .description('Compare prices across suppliers')
    .option('--json', 'Output as JSON')
    .action(async (name, options) => {
      try {
        const data = await apiGet(`/api/materials/compare-price?materialName=${encodeURIComponent(name)}`);

        if (options.json) {
          printJSON(data);
          return;
        }

        const result = data.data;
        printInfo(`Market average: ¥${result.marketAvgPrice?.toFixed(2)} | Total suppliers: ${result.totalSuppliers}`);

        if (result.lowestPriceSupplier) {
          printSuccess(`Lowest: ${result.lowestPriceSupplier.name} @ ¥${result.lowestPriceSupplier.avgPrice.toFixed(2)} (${result.lowestPriceSupplier.diffPercent}%)`);
        }

        if (result.suppliers?.length > 0) {
          printTable(
            ['Supplier', 'Avg Price', 'Quotes', 'Diff'],
            result.suppliers.map((s: any) => [
              s.supplierName,
              s.avgPrice?.toFixed(2),
              s.quoteCount,
              `${s.diffPercent > 0 ? '+' : ''}${s.diffPercent}%`,
            ])
          );
        }
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });
}
