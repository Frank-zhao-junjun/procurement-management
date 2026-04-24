import { Command } from 'commander';
import inquirer from 'inquirer';
import { apiGet, apiPost, apiPut } from '../client.js';
import { printSuccess, printError, printInfo, printJSON, printTable, formatStatus } from '../utils.js';

export function registerWorkflowCommands(program: Command) {
  const wf = program.command('workflow').alias('wf').description('End-to-end business workflows');

  // Full PR workflow: create -> check materials -> submit
  wf
    .command('create-pr')
    .description('Interactive workflow: create PR with material checking')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const answers = await inquirer.prompt([
          { type: 'input', name: 'reason', message: 'Purchase reason:', validate: (v) => v.length > 0 },
        ]);

        const lines: any[] = [];
        let addMore = true;
        while (addMore) {
          const line = await inquirer.prompt([
            { type: 'input', name: 'text', message: 'Requirement / material name:' },
            { type: 'number', name: 'quantity', message: 'Quantity:', default: 1 },
            { type: 'confirm', name: 'more', message: 'Add another line?', default: false },
          ]);
          lines.push({ requirementText: line.text, quantity: line.quantity });
          addMore = line.more;
        }

        // Step 1: Check materials
        printInfo('Checking materials...');
        const checkRes = await apiPost('/api/purchase-requests/check-materials', { lines });
        if (!checkRes.canProceed) {
          printInfo('Material check results:');
          printTable(
            ['Text', 'Found', 'Action'],
            checkRes.lines.map((l: any) => [l.requirementText, l.found ? 'Yes' : 'No', l.action])
          );
          const confirm = await inquirer.prompt([
            { type: 'confirm', name: 'proceed', message: 'Proceed with confirmation?', default: true },
          ]);
          if (!confirm.proceed) {
            printInfo('Cancelled');
            return;
          }
        }

        // Step 2: Create PR
        printInfo('Creating purchase request...');
        const prRes = await apiPost('/api/purchase-requests', { reason: answers.reason, lines });
        printSuccess(`PR created: ${prRes.data.pr_number || prRes.data.id}`);

        // Step 3: Ask to submit
        const submitAns = await inquirer.prompt([
          { type: 'confirm', name: 'submit', message: 'Submit for approval now?', default: true },
        ]);
        if (submitAns.submit) {
          await apiPost(`/api/purchase-requests/${prRes.data.id}/submit`);
          printSuccess('PR submitted for approval');
        }

        if (options.json) printJSON(prRes);
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // Buyer workflow: pending sourcing -> update -> create quote -> award -> create PO
  wf
    .command('source-to-po')
    .description('Interactive workflow: sourcing task to PO')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        // Step 1: List pending sourcing
        printInfo('Fetching pending sourcing tasks...');
        const pendingRes = await apiGet('/api/sourcing-tasks/pending');
        if (!pendingRes.data || pendingRes.data.length === 0) {
          printInfo('No pending sourcing tasks');
          return;
        }

        const choices = pendingRes.data.map((t: any) => ({
          name: `[${t.task_number}] ${t.requirement_text || t.material_name || '-'} (Qty: ${t.quantity})`,
          value: t.id,
        }));

        const taskAns = await inquirer.prompt([
          { type: 'list', name: 'taskId', message: 'Select sourcing task:', choices },
        ]);

        // Step 2: Select supplier
        printInfo('Fetching suppliers...');
        const suppliersRes = await apiGet('/api/suppliers?page=1&pageSize=50');
        const supplierChoices = (suppliersRes.data || []).map((s: any) => ({
          name: `${s.name} (ID: ${s.id})`,
          value: s.id,
        }));
        supplierChoices.unshift({ name: 'Skip (use existing)', value: 0 });

        const supAns = await inquirer.prompt([
          { type: 'list', name: 'supplierId', message: 'Select supplier:', choices: supplierChoices },
          { type: 'input', name: 'result', message: 'Sourcing result notes:' },
        ]);

        if (supAns.supplierId > 0) {
          await apiPut(`/api/sourcing-tasks/${taskAns.taskId}`, {
            supplierId: supAns.supplierId,
            result: supAns.result,
            complete: true,
          });
          printSuccess('Sourcing task updated');
        }

        // Step 3: Create quote
        const quoteAns = await inquirer.prompt([
          { type: 'confirm', name: 'createQuote', message: 'Create quote?', default: true },
        ]);

        let quoteId: number | null = null;
        if (quoteAns.createQuote && supAns.supplierId > 0) {
          const priceAns = await inquirer.prompt([
            { type: 'number', name: 'price', message: 'Unit price:', validate: (v: number | undefined) => (v ?? 0) >= 0 },
            { type: 'number', name: 'qty', message: 'Quantity:', validate: (v: number | undefined) => (v ?? 0) > 0 },
          ]);
          const quoteRes = await apiPost('/api/quotes', {
            sourcingTaskId: taskAns.taskId,
            supplierId: supAns.supplierId,
            unitPrice: priceAns.price,
            quantity: priceAns.qty,
          });
          quoteId = quoteRes.data?.id;
          printSuccess(`Quote created: ${quoteRes.data?.quote_number || quoteId}`);
        }

        // Step 4: Award quote
        if (quoteId) {
          const awardAns = await inquirer.prompt([
            { type: 'confirm', name: 'award', message: 'Award this quote?', default: true },
          ]);
          if (awardAns.award) {
            await apiPut(`/api/quotes/${quoteId}/award`, { awarded: 'winner' });
            printSuccess('Quote awarded');
          }
        }

        // Step 5: Create PO
        const poAns = await inquirer.prompt([
          { type: 'confirm', name: 'createPo', message: 'Create purchase order?', default: true },
        ]);
        if (poAns.createPo && supAns.supplierId > 0) {
          const supInfo = suppliersRes.data?.find((s: any) => s.id === supAns.supplierId);
          const poRes = await apiPost('/api/purchase-orders', {
            supplierId: supAns.supplierId,
            supplierSnapshot: supInfo?.name || '',
            lines: [{ materialSnapshot: 'Sourced item', quantity: 1, unitPrice: 0 }],
          });
          printSuccess(`PO created: ${poRes.data?.po_number || poRes.data?.id}`);

          const sendAns = await inquirer.prompt([
            { type: 'confirm', name: 'send', message: 'Send PO now?', default: false },
          ]);
          if (sendAns.send && poRes.data?.id) {
            await apiPost(`/api/purchase-orders/${poRes.data.id}/send`);
            printSuccess('PO sent');
          }
        }
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // Manager workflow: list pending PRs -> approve/reject
  wf
    .command('approve-prs')
    .description('Interactive workflow: review and approve pending PRs')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        printInfo('Fetching pending purchase requests...');
        const prRes = await apiGet('/api/purchase-requests?status=pending&page=1&pageSize=50');
        if (!prRes.data || prRes.data.length === 0) {
          printInfo('No pending PRs');
          return;
        }

        for (const pr of prRes.data) {
          printInfo(`\nPR #${pr.pr_number || pr.id} - ${pr.reason || '-'}`);
          const detail = await apiGet(`/api/purchase-requests/${pr.id}`);
          if (detail.data?.lines?.length > 0) {
            printTable(
              ['Line ID', 'Requirement', 'Qty'],
              detail.data.lines.map((l: any) => [
                l.id,
                l.requirement_text || l.material_snapshot || '-',
                l.quantity,
              ])
            );
          }

          const action = await inquirer.prompt([
            {
              type: 'list',
              name: 'choice',
              message: 'Action:',
              choices: [
                { name: 'Approve', value: 'approve' },
                { name: 'Reject', value: 'reject' },
                { name: 'Skip', value: 'skip' },
                { name: 'Exit', value: 'exit' },
              ],
            },
          ]);

          if (action.choice === 'exit') break;
          if (action.choice === 'skip') continue;

          for (const line of detail.data?.lines || []) {
            if (line.status === 'pending') {
              const body: any = { approved: action.choice === 'approve' };
              if (action.choice === 'reject') {
                const reasonAns = await inquirer.prompt([
                  { type: 'input', name: 'reason', message: 'Rejection reason:' },
                ]);
                body.reason = reasonAns.reason;
              }
              await apiPost(`/api/purchase-request-lines/${line.id}/approve`, body);
              printSuccess(`Line ${line.id} ${action.choice}d`);
            }
          }
        }
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });
}
