import { Command } from 'commander';
import { apiGet, apiPut } from '../client.js';
import { printSuccess, printError, printInfo, printJSON, printTable, truncate, formatDate } from '../utils.js';

export function registerFaCommands(program: Command) {
  const fa = program.command('fa').description('Framework Agreement management');

  // List FAs
  fa
    .command('list')
    .description('List framework agreements')
    .option('-p, --page <page>', 'Page number', '1')
    .option('-s, --size <size>', 'Page size', '20')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const data = await apiGet(`/api/framework-agreements?page=${options.page}&pageSize=${options.size}`);

        if (options.json) {
          printJSON(data);
          return;
        }

        if (!data.data || data.data.length === 0) {
          printInfo('No framework agreements found');
          return;
        }

        printTable(
          ['ID', 'FA Number', 'Title', 'Supplier', 'Status', 'Created'],
          data.data.map((f: any) => [
            f.id,
            f.fa_number || '-',
            truncate(f.title || '-', 25),
            truncate(f.supplier_name || '-', 20),
            f.status || '-',
            formatDate(f.created_at),
          ])
        );
        printInfo(`Page ${data.page}/${Math.ceil((data.total || 0) / data.pageSize)} | Total: ${data.total}`);
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // Match FA for PR line
  fa
    .command('match <prLineId>')
    .description('Match framework agreements for a PR line')
    .option('-n, --top <n>', 'Number of top results', '3')
    .option('--json', 'Output as JSON')
    .action(async (prLineId, options) => {
      try {
        const data = await apiGet(`/api/purchase-request-lines/${prLineId}/match?topN=${options.top}`);

        if (options.json) {
          printJSON(data);
          return;
        }

        if (!data.data || data.data.length === 0) {
          printInfo('No matching framework agreements found');
          return;
        }

        printInfo(`Found ${data.data.length} matching framework agreement(s):`);
        printTable(
          ['ID', 'FA Number', 'Title', 'Supplier', 'Price', 'Valid Until'],
          data.data.map((f: any) => [
            f.id,
            f.fa_number || '-',
            truncate(f.title || '-', 25),
            truncate(f.supplier_name || '-', 20),
            f.unit_price != null ? `¥${f.unit_price}` : '-',
            formatDate(f.valid_until),
          ])
        );
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // Confirm FA
  fa
    .command('confirm <prLineId>')
    .description('Confirm or reject FA match for a PR line')
    .option('--fa <id>', 'Framework Agreement ID to use')
    .option('--reject', 'Reject FA match and create sourcing task')
    .option('--auto-po', 'Auto create PO after confirmation')
    .option('--json', 'Output as JSON')
    .action(async (prLineId, options) => {
      try {
        const body: any = { confirmed: !options.reject };
        if (options.fa) body.faId = parseInt(options.fa, 10);
        if (options.autoPo) body.autoCreatePO = true;

        const data = await apiPut(`/api/purchase-request-lines/${prLineId}/confirm-fa`, body);
        printSuccess(options.reject ? 'FA match rejected' : 'FA match confirmed');
        if (options.json) printJSON(data);
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });
}
