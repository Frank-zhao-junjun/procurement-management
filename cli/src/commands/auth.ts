import { Command } from 'commander';
import inquirer from 'inquirer';
import { loadConfig, saveConfig, clearConfig } from '../config.js';
import { apiGet, apiPost, resetClient } from '../client.js';
import { printSuccess, printError, printInfo, printWarning, printJSON, printTable } from '../utils.js';

export function registerAuthCommands(program: Command) {
  const auth = program.command('auth').description('Agent authentication and identity');

  // Register new agent
  auth
    .command('register')
    .description('Register a new Agent')
    .option('-i, --id <agentId>', 'Agent ID')
    .option('-r, --role <role>', 'Role: requester | buyer | manager')
    .option('-w, --webhook <url>', 'Webhook URL (for manager)')
    .action(async (options) => {
      try {
        let { id, role, webhook } = options;

        if (!id || !role) {
          const answers = await inquirer.prompt([
            {
              type: 'input',
              name: 'id',
              message: 'Agent ID:',
              when: !id,
              validate: (v) => v.length > 0 || 'Agent ID is required',
            },
            {
              type: 'list',
              name: 'role',
              message: 'Select role:',
              when: !role,
              choices: [
                { name: 'Requester - 创建采购申请、物料、收货', value: 'requester' },
                { name: 'Buyer - 创建供应商、报价、采购订单', value: 'buyer' },
                { name: 'Manager - 审批采购申请、超收', value: 'manager' },
              ],
            },
            {
              type: 'input',
              name: 'webhook',
              message: 'Webhook URL (optional, for manager notifications):',
              when: !webhook,
            },
          ]);
          id = id || answers.id;
          role = role || answers.role;
          webhook = webhook || answers.webhook;
        }

        const body: any = { agentId: id, role };
        if (webhook) body.webhookUrl = webhook;

        const data = await apiPost('/api/agent-bindings', body);
        printSuccess(`Agent "${id}" registered successfully as ${role}`);
        printJSON(data);
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // Login / configure
  auth
    .command('login')
    .description('Configure API endpoint and credentials')
    .option('-u, --url <url>', 'API base URL')
    .option('-k, --key <apiKey>', 'API Key')
    .option('-i, --id <agentId>', 'Agent ID')
    .action(async (options) => {
      try {
        const current = await loadConfig();
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'baseUrl',
            message: 'API Base URL:',
            default: options.url || current.baseUrl || 'http://localhost:5000',
          },
          {
            type: 'input',
            name: 'agentId',
            message: 'Agent ID:',
            default: options.id || current.agentId,
          },
          {
            type: 'password',
            name: 'apiKey',
            message: 'API Key (optional, press Enter to skip):',
            mask: '*',
          },
        ]);

        const config = {
          baseUrl: answers.baseUrl,
          agentId: answers.agentId || undefined,
          apiKey: answers.apiKey || undefined,
        };

        await saveConfig(config);
        resetClient();
        printSuccess('Configuration saved');
        printInfo(`Base URL: ${config.baseUrl}`);
        if (config.agentId) printInfo(`Agent ID: ${config.agentId}`);
        if (config.apiKey) printInfo('API Key: ********');
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // Whoami
  auth
    .command('whoami')
    .alias('profile')
    .description('Show current Agent identity')
    .action(async () => {
      try {
        const config = await loadConfig();
        if (!config.agentId && !config.apiKey) {
          printError('Not logged in. Run: procurement auth login');
          process.exit(1);
        }

        printInfo('Current Configuration:');
        printTable(
          ['Key', 'Value'],
          [
            ['Base URL', config.baseUrl],
            ['Agent ID', config.agentId || '-'],
            ['API Key', config.apiKey ? '********' : '-'],
            ['Role', config.role || '-'],
          ]
        );

        // Try to verify with server
        try {
          const data = await apiGet(`/api/agent-bindings?agentId=${config.agentId}`);
          if (data?.data?.length > 0) {
            const agent = data.data[0];
            printInfo('Server Identity:');
            printTable(
              ['Key', 'Value'],
              [
                ['ID', agent.agent_id],
                ['Role', agent.role],
                ['Created At', agent.created_at],
              ]
            );
          }
        } catch {
          printWarning('Could not verify identity with server');
        }
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // List agents
  auth
    .command('list')
    .description('List registered agents')
    .option('-r, --role <role>', 'Filter by role')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const params = new URLSearchParams();
        if (options.role) params.append('role', options.role);
        const data = await apiGet(`/api/agent-bindings?${params.toString()}`);

        if (options.json) {
          printJSON(data);
          return;
        }

        if (!data.data || data.data.length === 0) {
          printInfo('No agents found');
          return;
        }

        printTable(
          ['ID', 'Role', 'Created At'],
          data.data.map((a: any) => [
            a.agent_id,
            a.role,
            new Date(a.created_at).toLocaleString('zh-CN'),
          ])
        );
        printInfo(`Total: ${data.total || data.data.length}`);
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // Logout
  auth
    .command('logout')
    .description('Clear local configuration')
    .action(async () => {
      await clearConfig();
      resetClient();
      printSuccess('Logged out and configuration cleared');
    });
}
