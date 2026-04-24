import { Command } from 'commander';
import inquirer from 'inquirer';
import { apiGet, apiPost } from '../client.js';
import { printSuccess, printError, printInfo, printJSON, printTable, truncate, formatDate, formatStatus, formatCurrency } from '../utils.js';

export function registerPoCommands(program: Command) {
  const po = program.command('po').description('Purchase Order management');

  // List POs
  po
    .command('list')
    .description('List purchase orders')
    .option('-p, --page <page>', 'Page number', '1')
    .option('-s, --size <size>', 'Page size', '20')
    .option('--status <status>', 'Filter by status')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const params = new URLSearchParams();
        params.append('page', options.page);
        params.append('pageSize', options.size);
        if (options.status) params.append('status', options.status);
        const data = await apiGet(`/api/purchase-orders?${params.toString()}`);

        if (options.json) {
          printJSON(data);
          return;
        }

        if (!data.data || data.data.length === 0) {
          printInfo('No purchase orders found');
          return;
        }

        printTable(
          ['ID', 'PO Number', 'Supplier', 'Status', 'Lines', 'Created'],
          data.data.map((o: any) => [
            o.id,
            o.po_number || '-',
            truncate(o.supplier_snapshot || '-', 20),
            formatStatus(o.status),
            o.lines_count || 0,
            formatDate(o.created_at),
          ])
        );
        printInfo(`Page ${data.page}/${Math.ceil((data.total || 0) / data.pageSize)} | Total: ${data.total}`);
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // Get PO detail
  po
    .command('get <id>')
    .description('Get purchase order details')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const data = await apiGet(`/api/purchase-orders/${id}`);

        if (options.json) {
          printJSON(data);
          return;
        }

        const order = data.data;
        printInfo(`PO #${order.po_number || order.id}`);
        printTable(
          ['Field', 'Value'],
          [
            ['ID', order.id],
            ['Number', order.po_number || '-'],
            ['Status', formatStatus(order.status)],
            ['Supplier', order.supplier_snapshot || '-'],
            ['Created', formatDate(order.created_at)],
          ]
        );

        const linesRes = await apiGet(`/api/purchase-orders/${id}/lines`);
        if (linesRes.data?.length > 0) {
          printInfo('Lines:');
          printTable(
            ['Line ID', 'Material', 'Qty', 'Unit Price', 'Total'],
            linesRes.data.map((l: any) => [
              l.id,
              truncate(l.material_snapshot || '-', 25),
              l.quantity,
              formatCurrency(l.unit_price),
              formatCurrency((l.quantity || 0) * (l.unit_price || 0)),
            ])
          );
        }
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // Create PO
  po
    .command('create')
    .description('Create a purchase order')
    .option('--supplier <id>', 'Supplier ID')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        let supplierId = options.supplier;
        const lines: any[] = [];

        if (!supplierId) {
          const answers = await inquirer.prompt([
            { type: 'number', name: 'supplierId', message: 'Supplier ID:', validate: (v: number | undefined) => (v ?? 0) > 0 },
          ]);
          supplierId = answers.supplierId;
        }

        // Get supplier info
        const supplierRes = await apiGet(`/api/suppliers/${supplierId}`);
        const supplierName = supplierRes.data?.name || '';

        let addMore = true;
        while (addMore) {
          const lineAns = await inquirer.prompt([
            { type: 'number', name: 'prLineId', message: 'PR Line ID (optional, 0 to skip):', default: 0 },
            { type: 'input', name: 'material', message: 'Material snapshot:' },
            { type: 'number', name: 'quantity', message: 'Quantity:', validate: (v: number | undefined) => (v ?? 0) > 0 },
            { type: 'number', name: 'unitPrice', message: 'Unit price:', validate: (v: number | undefined) => (v ?? 0) >= 0 },
            { type: 'confirm', name: 'more', message: 'Add another line?', default: false },
          ]);
          const line: any = {
            materialSnapshot: lineAns.material,
            quantity: lineAns.quantity,
            unitPrice: lineAns.unitPrice,
          };
          if (lineAns.prLineId > 0) line.prLineId = lineAns.prLineId;
          lines.push(line);
          addMore = lineAns.more;
        }

        const body = {
          supplierId: parseInt(supplierId, 10),
          supplierSnapshot: supplierName,
          lines,
        };

        const data = await apiPost('/api/purchase-orders', body);
        printSuccess('Purchase order created');
        if (options.json) {
          printJSON(data);
        } else if (data.data) {
          printTable(
            ['ID', 'PO Number', 'Status'],
            [[data.data.id, data.data.po_number, data.data.status]]
          );
        }
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // Send PO
  po
    .command('send <id>')
    .description('Send a purchase order')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const data = await apiPost(`/api/purchase-orders/${id}/send`);
        printSuccess('Purchase order sent');
        if (options.json) printJSON(data);
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });
}
