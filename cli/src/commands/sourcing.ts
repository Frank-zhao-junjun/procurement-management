import { Command } from 'commander';
import inquirer from 'inquirer';
import { apiGet, apiPost, apiPut } from '../client.js';
import { printSuccess, printError, printInfo, printJSON, printTable, truncate, formatDate, formatStatus } from '../utils.js';

export function registerSourcingCommands(program: Command) {
  const sourcing = program.command('sourcing').alias('sc').description('Sourcing task management');

  // List sourcing tasks
  sourcing
    .command('list')
    .description('List sourcing tasks')
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
        const data = await apiGet(`/api/sourcing-tasks?${params.toString()}`);

        if (options.json) {
          printJSON(data);
          return;
        }

        if (!data.data || data.data.length === 0) {
          printInfo('No sourcing tasks found');
          return;
        }

        printTable(
          ['ID', 'Task No', 'PR ID', 'Status', 'Supplier', 'Created'],
          data.data.map((t: any) => [
            t.id,
            t.task_number || '-',
            t.pr_id || '-',
            formatStatus(t.status),
            truncate(t.supplier_name || '-', 20),
            formatDate(t.created_at),
          ])
        );
        printInfo(`Page ${data.page}/${Math.ceil((data.total || 0) / data.pageSize)} | Total: ${data.total}`);
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // Pending sourcing tasks
  sourcing
    .command('pending')
    .description('List pending sourcing tasks')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const data = await apiGet('/api/sourcing-tasks/pending');

        if (options.json) {
          printJSON(data);
          return;
        }

        if (!data.data || data.data.length === 0) {
          printInfo('No pending sourcing tasks');
          return;
        }

        printTable(
          ['ID', 'Task No', 'PR ID', 'Material', 'Requirement', 'Qty'],
          data.data.map((t: any) => [
            t.id,
            t.task_number || '-',
            t.pr_id || '-',
            truncate(t.material_name || '-', 20),
            truncate(t.requirement_text || '-', 25),
            t.quantity || '-',
          ])
        );
        printInfo(`Total: ${data.total || data.data.length}`);
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // Get sourcing task detail
  sourcing
    .command('get <id>')
    .description('Get sourcing task details')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const data = await apiGet(`/api/sourcing-tasks/${id}`);

        if (options.json) {
          printJSON(data);
          return;
        }

        const task = data.data;
        printInfo(`Sourcing Task #${task.task_number || task.id}`);
        printTable(
          ['Field', 'Value'],
          [
            ['ID', task.id],
            ['Number', task.task_number || '-'],
            ['Status', formatStatus(task.status)],
            ['PR ID', task.pr_id || '-'],
            ['Material', task.material_name || task.material_snapshot || '-'],
            ['Supplier', task.supplier_name || '-'],
            ['Result', task.result || '-'],
            ['Created', formatDate(task.created_at)],
          ]
        );
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // Update sourcing task
  sourcing
    .command('update <id>')
    .description('Update a sourcing task')
    .option('--supplier <id>', 'Supplier ID')
    .option('--result <text>', 'Sourcing result')
    .option('--complete', 'Mark as completed')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const body: any = {};

        if (options.supplier) body.supplierId = parseInt(options.supplier, 10);
        if (options.result) body.result = options.result;
        if (options.complete) body.complete = true;

        if (!options.supplier && !options.result && !options.complete) {
          const answers = await inquirer.prompt([
            { type: 'input', name: 'supplierId', message: 'Supplier ID (optional):', filter: (v: string) => v ? parseInt(v, 10) : undefined },
            { type: 'input', name: 'result', message: 'Sourcing result:' },
            { type: 'confirm', name: 'complete', message: 'Mark as completed?', default: false },
          ]);
          if (answers.supplierId) body.supplierId = answers.supplierId;
          if (answers.result) body.result = answers.result;
          if (answers.complete) body.complete = true;
        }

        const data = await apiPut(`/api/sourcing-tasks/${id}`, body);
        printSuccess('Sourcing task updated');
        if (options.json) printJSON(data);
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // Create sourcing task
  sourcing
    .command('create')
    .description('Create a sourcing task')
    .option('--pr-line <id>', 'Purchase request line ID')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        let prLineId = options.prLine;
        if (!prLineId) {
          const answers = await inquirer.prompt([
            { type: 'number', name: 'prLineId', message: 'Purchase request line ID:', validate: (v: number | undefined) => (v ?? 0) > 0 },
          ]);
          prLineId = answers.prLineId;
        }

        const data = await apiPost('/api/sourcing-tasks', { prLineId: parseInt(prLineId, 10) });
        printSuccess('Sourcing task created');
        if (options.json) {
          printJSON(data);
        } else if (data.data) {
          printTable(
            ['ID', 'Task Number', 'Status'],
            [[data.data.id, data.data.task_number, data.data.status]]
          );
        }
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });
}
