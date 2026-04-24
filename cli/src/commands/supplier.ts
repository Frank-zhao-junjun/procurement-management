import { Command } from 'commander';
import inquirer from 'inquirer';
import { apiGet, apiPost } from '../client.js';
import { printSuccess, printError, printInfo, printJSON, printTable, truncate, formatDate } from '../utils.js';

export function registerSupplierCommands(program: Command) {
  const supplier = program.command('supplier').alias('s').description('Supplier management');

  // List suppliers
  supplier
    .command('list')
    .description('List suppliers')
    .option('-p, --page <page>', 'Page number', '1')
    .option('-s, --size <size>', 'Page size', '20')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const data = await apiGet(`/api/suppliers?page=${options.page}&pageSize=${options.size}`);

        if (options.json) {
          printJSON(data);
          return;
        }

        if (!data.data || data.data.length === 0) {
          printInfo('No suppliers found');
          return;
        }

        printTable(
          ['ID', 'Name', 'Contact', 'Status', 'Created'],
          data.data.map((s: any) => [
            s.id,
            truncate(s.name, 25),
            truncate(s.contact_person || s.contact || '-', 20),
            s.status || '-',
            formatDate(s.created_at),
          ])
        );
        printInfo(`Page ${data.page}/${Math.ceil(data.total / data.pageSize)} | Total: ${data.total}`);
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // Create supplier
  supplier
    .command('create')
    .description('Create a new supplier')
    .option('-n, --name <name>', 'Supplier name')
    .option('-c, --contact <contact>', 'Contact person')
    .option('-p, --phone <phone>', 'Phone')
    .option('-e, --email <email>', 'Email')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        let { name, contact, phone, email } = options;

        if (!name) {
          const answers = await inquirer.prompt([
            { type: 'input', name: 'name', message: 'Supplier name:', validate: (v) => v.length > 0 },
            { type: 'input', name: 'contact', message: 'Contact person:' },
            { type: 'input', name: 'phone', message: 'Phone:' },
            { type: 'input', name: 'email', message: 'Email:' },
          ]);
          name = answers.name;
          contact = answers.contact || undefined;
          phone = answers.phone || undefined;
          email = answers.email || undefined;
        }

        const body: any = { name };
        if (contact) body.contactPerson = contact;
        if (phone) body.phone = phone;
        if (email) body.email = email;

        const data = await apiPost('/api/suppliers', body);
        printSuccess('Supplier created');
        if (options.json) {
          printJSON(data);
        } else if (data.data) {
          printTable(
            ['ID', 'Name', 'Contact'],
            [[data.data.id, data.data.name, data.data.contact_person || '-']]
          );
        }
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });
}
