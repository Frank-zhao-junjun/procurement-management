#!/usr/bin/env node

import { Command } from 'commander';
import { loadConfig } from './config.js';
import { printInfo } from './utils.js';
import { registerAuthCommands } from './commands/auth.js';
import { registerMaterialCommands } from './commands/material.js';
import { registerSupplierCommands } from './commands/supplier.js';
import { registerPrCommands } from './commands/pr.js';
import { registerSourcingCommands } from './commands/sourcing.js';
import { registerQuoteCommands } from './commands/quote.js';
import { registerPoCommands } from './commands/po.js';
import { registerGrCommands } from './commands/gr.js';
import { registerFaCommands } from './commands/fa.js';
import { registerStatsCommands } from './commands/stats.js';
import { registerEventCommands } from './commands/event.js';
import { registerWorkflowCommands } from './commands/workflow.js';

const program = new Command();

async function main() {
  const config = await loadConfig();

  program
    .name('procurement')
    .description('Procurement Management System CLI for Agents')
    .version('1.0.0')
    .option('-u, --url <url>', 'API base URL', config.baseUrl)
    .option('-k, --api-key <key>', 'API Key')
    .option('-a, --actor <id>', 'Agent ID')
    .hook('preAction', async (thisCommand) => {
      const opts = thisCommand.opts();
      if (opts.url) config.baseUrl = opts.url;
      if (opts.apiKey) config.apiKey = opts.apiKey;
      if (opts.actor) config.agentId = opts.actor;
    });

  // Register all command modules
  registerAuthCommands(program);
  registerMaterialCommands(program);
  registerSupplierCommands(program);
  registerPrCommands(program);
  registerSourcingCommands(program);
  registerQuoteCommands(program);
  registerPoCommands(program);
  registerGrCommands(program);
  registerFaCommands(program);
  registerStatsCommands(program);
  registerEventCommands(program);
  registerWorkflowCommands(program);

  // Default action: show help
  program.action(() => {
    program.help();
  });

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
