import { Command } from 'commander';
import inquirer from 'inquirer';
import { apiGet, apiPost, apiPut } from '../client.js';
import { printSuccess, printError, printInfo, printJSON, printTable, formatDate, formatCurrency } from '../utils.js';

export function registerQuoteCommands(program: Command) {
  const quote = program.command('quote').alias('q').description('Quote management');

  // List quotes
  quote
    .command('list')
    .description('List quotes')
    .option('-p, --page <page>', 'Page number', '1')
    .option('-s, --size <size>', 'Page size', '20')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const data = await apiGet(`/api/quotes?page=${options.page}&pageSize=${options.size}`);

        if (options.json) {
          printJSON(data);
          return;
        }

        if (!data.data || data.data.length === 0) {
          printInfo('No quotes found');
          return;
        }

        printTable(
          ['ID', 'Quote No', 'Supplier', 'Unit Price', 'Qty', 'Awarded', 'Created'],
          data.data.map((q: any) => [
            q.id,
            q.quote_number || '-',
            q.supplier_snapshot || '-',
            formatCurrency(q.unit_price),
            q.quantity,
            q.awarded || '-',
            formatDate(q.created_at),
          ])
        );
        printInfo(`Page ${data.page}/${Math.ceil((data.total || 0) / data.pageSize)} | Total: ${data.total}`);
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // Create quote
  quote
    .command('create')
    .description('Create a quote')
    .option('--task <id>', 'Sourcing task ID')
    .option('--supplier <id>', 'Supplier ID')
    .option('--price <price>', 'Unit price')
    .option('--qty <qty>', 'Quantity')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        let { task, supplier, price, qty } = options;

        if (!task || !supplier || price == null || qty == null) {
          const answers = await inquirer.prompt([
            { type: 'number', name: 'task', message: 'Sourcing task ID:', when: !task },
            { type: 'number', name: 'supplier', message: 'Supplier ID:', when: !supplier },
            { type: 'number', name: 'price', message: 'Unit price:', when: price == null },
            { type: 'number', name: 'qty', message: 'Quantity:', when: qty == null },
          ]);
          task = task || answers.task;
          supplier = supplier || answers.supplier;
          price = price != null ? price : answers.price;
          qty = qty != null ? qty : answers.qty;
        }

        const body = {
          sourcingTaskId: parseInt(task, 10),
          supplierId: parseInt(supplier, 10),
          unitPrice: parseFloat(price),
          quantity: parseInt(qty, 10),
        };

        const data = await apiPost('/api/quotes', body);
        printSuccess('Quote created');
        if (options.json) printJSON(data);
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // Award quote
  quote
    .command('award <id>')
    .description('Award a quote')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const data = await apiPut(`/api/quotes/${id}/award`, { awarded: 'winner' });
        printSuccess('Quote awarded');
        if (options.json) printJSON(data);
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });
}
