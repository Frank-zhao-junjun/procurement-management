import { Command } from 'commander';
import inquirer from 'inquirer';
import { apiGet, apiPost } from '../client.js';
import { printSuccess, printError, printInfo, printJSON, printTable, formatDate, formatStatus } from '../utils.js';

export function registerGrCommands(program: Command) {
  const gr = program.command('gr').description('Goods Receipt management');

  // List GRs
  gr
    .command('list')
    .description('List goods receipts')
    .option('-p, --page <page>', 'Page number', '1')
    .option('-s, --size <size>', 'Page size', '20')
    .option('--type <type>', 'Filter by type (in/out)')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const params = new URLSearchParams();
        params.append('page', options.page);
        params.append('pageSize', options.size);
        if (options.type) params.append('grType', options.type);
        const data = await apiGet(`/api/goods-receipts?${params.toString()}`);

        if (options.json) {
          printJSON(data);
          return;
        }

        if (!data.data || data.data.length === 0) {
          printInfo('No goods receipts found');
          return;
        }

        printTable(
          ['ID', 'GR Number', 'PO ID', 'Type', 'Qty', 'Status', 'Created'],
          data.data.map((g: any) => [
            g.id,
            g.gr_number || '-',
            g.po_id || '-',
            g.gr_type || 'in',
            g.quantity,
            formatStatus(g.status),
            formatDate(g.created_at),
          ])
        );
        printInfo(`Page ${data.page}/${Math.ceil((data.total || 0) / data.pageSize)} | Total: ${data.total}`);
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // Create GR
  gr
    .command('create')
    .description('Create a goods receipt')
    .option('--po-line <id>', 'PO Line ID')
    .option('--qty <qty>', 'Quantity')
    .option('--type <type>', 'Type: in (receive) or out (return)', 'in')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        let { poLine, qty, type } = options;

        if (!poLine || qty == null) {
          const answers = await inquirer.prompt([
            { type: 'number', name: 'poLine', message: 'PO Line ID:', when: !poLine, validate: (v) => v > 0 },
            { type: 'number', name: 'qty', message: 'Quantity:', when: qty == null, validate: (v) => v !== 0 },
            {
              type: 'list',
              name: 'type',
              message: 'Type:',
              when: !type,
              choices: [
                { name: 'Receive (in)', value: 'in' },
                { name: 'Return (out)', value: 'out' },
              ],
            },
          ]);
          poLine = poLine || answers.poLine;
          qty = qty != null ? qty : answers.qty;
          type = type || answers.type;
        }

        const body: any = {
          poLineId: parseInt(poLine, 10),
          quantity: parseInt(qty, 10),
        };
        if (type === 'out') body.grType = 'out';

        const data = await apiPost('/api/goods-receipts', body);
        printSuccess('Goods receipt created');
        if (options.json) {
          printJSON(data);
        } else if (data.data) {
          printTable(
            ['ID', 'GR Number', 'Quantity', 'Type'],
            [[data.data.id, data.data.gr_number, data.data.quantity, data.data.gr_type || 'in']]
          );
        }
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // Approve overdelivery
  gr
    .command('approve-overdelivery <id>')
    .description('Approve an overdelivery')
    .option('--reject', 'Reject instead of approve')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const body = { approved: !options.reject };
        const data = await apiPost(`/api/goods-receipts/${id}/approve-overdelivery`, body);
        printSuccess(options.reject ? 'Overdelivery rejected' : 'Overdelivery approved');
        if (options.json) printJSON(data);
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // Pending returns
  gr
    .command('pending-returns')
    .description('List pending returns for approval')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const data = await apiGet('/api/goods-receipts/returns/pending');

        if (options.json) {
          printJSON(data);
          return;
        }

        if (!data.data || data.data.length === 0) {
          printInfo('No pending returns');
          return;
        }

        printTable(
          ['ID', 'GR Number', 'PO ID', 'Qty', 'Created'],
          data.data.map((g: any) => [
            g.id,
            g.gr_number || '-',
            g.po_id || '-',
            g.quantity,
            formatDate(g.created_at),
          ])
        );
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });
}
