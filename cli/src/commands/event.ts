import { Command } from 'commander';
import inquirer from 'inquirer';
import { apiGet, apiPost } from '../client.js';
import { printSuccess, printError, printInfo, printJSON, printTable, truncate, formatDate } from '../utils.js';

export function registerEventCommands(program: Command) {
  const event = program.command('event').description('Event management');

  // List events
  event
    .command('list')
    .description('List events')
    .option('-t, --type <type>', 'Filter by event type')
    .option('--from <date>', 'From date (YYYY-MM-DD)')
    .option('-p, --page <page>', 'Page number', '1')
    .option('-s, --size <size>', 'Page size', '20')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const params = new URLSearchParams();
        params.append('page', options.page);
        params.append('pageSize', options.size);
        if (options.type) params.append('type', options.type);
        if (options.from) params.append('from', options.from);
        const data = await apiGet(`/api/events?${params.toString()}`);

        if (options.json) {
          printJSON(data);
          return;
        }

        if (!data.data || data.data.length === 0) {
          printInfo('No events found');
          return;
        }

        printTable(
          ['Event ID', 'Type', 'Source', 'Notified', 'Success', 'Time'],
          data.data.map((e: any) => [
            truncate(e.event_id, 20),
            e.event_type,
            truncate(e.source, 20),
            e.subscribers_notified,
            e.success ? 'Yes' : 'No',
            formatDate(e.created_at),
          ])
        );
        printInfo(`Page ${data.page}/${Math.ceil((data.total || 0) / data.pageSize)} | Total: ${data.total}`);
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // Publish event
  event
    .command('publish')
    .description('Publish an event')
    .option('--type <type>', 'Event type')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        let type = options.type;
        const payload: any = {};

        if (!type) {
          const answers = await inquirer.prompt([
            {
              type: 'list',
              name: 'type',
              message: 'Event type:',
              choices: [
                'pr.submitted',
                'pr.approved',
                'pr.rejected',
                'po.created',
                'gr.completed',
                'gr.overdelivered',
                'price.high',
                'price.abnormal',
              ],
            },
          ]);
          type = answers.type;
        }

        const dataAns = await inquirer.prompt([
          { type: 'input', name: 'key', message: 'Data key (e.g. prId, poId):' },
          { type: 'input', name: 'value', message: 'Data value:' },
        ]);
        payload[dataAns.key] = dataAns.value;

        const body = {
          type,
          data: payload,
          routing: { targetRoles: ['buyer', 'manager'] },
        };

        const data = await apiPost('/api/events', body);
        printSuccess('Event published');
        if (options.json) printJSON(data);
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // Get subscriptions
  event
    .command('subscriptions')
    .description('Get event subscriptions')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const data = await apiGet('/api/agent-bindings');

        if (options.json) {
          printJSON(data);
          return;
        }

        if (!data.data || data.data.length === 0) {
          printInfo('No agents found');
          return;
        }

        printTable(
          ['Agent ID', 'Role', 'Webhook'],
          data.data.map((a: any) => [
            a.agent_id,
            a.role,
            a.webhook_url ? truncate(a.webhook_url, 30) : '-',
          ])
        );
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });
}
