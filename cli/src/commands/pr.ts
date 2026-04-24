import { Command } from 'commander';
import inquirer from 'inquirer';
import { apiGet, apiPost, apiPut } from '../client.js';
import { printSuccess, printError, printInfo, printJSON, printTable, truncate, formatDate, formatStatus } from '../utils.js';

export function registerPrCommands(program: Command) {
  const pr = program.command('pr').description('Purchase Request management');

  // List PRs
  pr
    .command('list')
    .description('List purchase requests')
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
        const data = await apiGet(`/api/purchase-requests?${params.toString()}`);

        if (options.json) {
          printJSON(data);
          return;
        }

        if (!data.data || data.data.length === 0) {
          printInfo('No purchase requests found');
          return;
        }

        printTable(
          ['ID', 'PR Number', 'Reason', 'Status', 'Lines', 'Created'],
          data.data.map((r: any) => [
            r.id,
            r.pr_number || '-',
            truncate(r.reason, 30),
            formatStatus(r.status),
            r.lines_count || 0,
            formatDate(r.created_at),
          ])
        );
        printInfo(`Page ${data.page}/${Math.ceil((data.total || 0) / data.pageSize)} | Total: ${data.total}`);
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // Get PR detail
  pr
    .command('get <id>')
    .description('Get purchase request details')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const data = await apiGet(`/api/purchase-requests/${id}`);

        if (options.json) {
          printJSON(data);
          return;
        }

        const pr = data.data;
        printInfo(`PR #${pr.pr_number || pr.id}`);
        printTable(
          ['Field', 'Value'],
          [
            ['ID', pr.id],
            ['Number', pr.pr_number || '-'],
            ['Status', formatStatus(pr.status)],
            ['Reason', pr.reason || '-'],
            ['Applicant', pr.applicant || '-'],
            ['Created', formatDate(pr.created_at)],
          ]
        );

        if (pr.lines?.length > 0) {
          printInfo('Lines:');
          printTable(
            ['Line ID', 'Requirement', 'Qty', 'Status'],
            pr.lines.map((l: any) => [
              l.id,
              truncate(l.requirement_text || l.material_snapshot || '-', 30),
              l.quantity,
              formatStatus(l.status),
            ])
          );
        }
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // Create PR
  pr
    .command('create')
    .description('Create a new purchase request')
    .option('-r, --reason <reason>', 'Purchase reason')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        let reason = options.reason;
        const lines: any[] = [];

        if (!reason) {
          const answers = await inquirer.prompt([
            { type: 'input', name: 'reason', message: 'Purchase reason:', validate: (v) => v.length > 0 },
          ]);
          reason = answers.reason;
        }

        // Interactive line input
        let addMore = true;
        while (addMore) {
          const lineAns = await inquirer.prompt([
            { type: 'input', name: 'text', message: 'Requirement text / material name:' },
            { type: 'number', name: 'quantity', message: 'Quantity:', default: 1, validate: (v: number | undefined) => (v ?? 0) > 0 },
            { type: 'confirm', name: 'more', message: 'Add another line?', default: false },
          ]);
          lines.push({
            requirementText: lineAns.text,
            quantity: lineAns.quantity,
          });
          addMore = lineAns.more;
        }

        const body = { reason, lines };
        const data = await apiPost('/api/purchase-requests', body);
        printSuccess('Purchase request created');
        if (options.json) {
          printJSON(data);
        } else {
          printTable(
            ['ID', 'PR Number', 'Status', 'Lines'],
            [[data.data.id, data.data.pr_number, data.data.status, data.data.lines_count || lines.length]]
          );
        }
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // Submit PR
  pr
    .command('submit <id>')
    .description('Submit a purchase request for approval')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const data = await apiPost(`/api/purchase-requests/${id}/submit`);
        printSuccess('Purchase request submitted');
        if (options.json) printJSON(data);
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // Withdraw PR
  pr
    .command('withdraw <id>')
    .description('Withdraw a pending purchase request')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const data = await apiPost(`/api/purchase-requests/${id}/withdraw`);
        printSuccess('Purchase request withdrawn');
        if (options.json) printJSON(data);
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // Approve PR line
  pr
    .command('approve <lineId>')
    .description('Approve or reject a purchase request line')
    .option('--reject', 'Reject instead of approve')
    .option('--reason <reason>', 'Rejection reason')
    .option('--json', 'Output as JSON')
    .action(async (lineId, options) => {
      try {
        const body: any = { approved: !options.reject };
        if (options.reject && options.reason) body.reason = options.reason;
        if (options.reject && !options.reason) {
          const ans = await inquirer.prompt([
            { type: 'input', name: 'reason', message: 'Rejection reason:' },
          ]);
          body.reason = ans.reason;
        }

        const data = await apiPost(`/api/purchase-request-lines/${lineId}/approve`, body);
        printSuccess(options.reject ? 'Purchase request line rejected' : 'Purchase request line approved');
        if (options.json) printJSON(data);
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // Check materials before creating PR
  pr
    .command('check-materials')
    .description('Check materials before creating PR')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const lines: any[] = [];
        let addMore = true;
        while (addMore) {
          const ans = await inquirer.prompt([
            { type: 'input', name: 'text', message: 'Requirement text:' },
            { type: 'number', name: 'quantity', message: 'Quantity:', default: 1 },
            { type: 'confirm', name: 'more', message: 'Add another?', default: false },
          ]);
          lines.push({ requirementText: ans.text, quantity: ans.quantity });
          addMore = ans.more;
        }

        const data = await apiPost('/api/purchase-requests/check-materials', { lines });
        printInfo(`Can proceed: ${data.canProceed ? 'Yes' : 'No'}`);
        printInfo(`Next action: ${data.nextAction}`);

        if (data.lines?.length > 0) {
          printTable(
            ['Text', 'Found', 'Action', 'Match'],
            data.lines.map((l: any) => [
              truncate(l.requirementText, 25),
              l.found ? 'Yes' : 'No',
              l.action,
              l.exactMatch?.name || '-',
            ])
          );
        }
        if (options.json) printJSON(data);
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });
}
