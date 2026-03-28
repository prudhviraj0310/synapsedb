#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';

// Import CLI Handlers
import { handleInit } from '../src/commands/init.js';
import { handleIntrospect } from '../src/commands/introspect.js';
import { handleStudio } from '../src/commands/studio.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson = fs.readJsonSync(path.join(__dirname, '../package.json'));

const program = new Command();

program
  .name('synapsedb')
  .description('The Developer Console to manage your SynapseDB Data OS ecosystem.')
  .version(packageJson.version, '-v, --version', 'output the current version');

// ─── COMMAND: init ─────────────────────────────────────────────────────────
program
  .command('init')
  .description('Interactive setup to bootstrap SynapseDB in the current repository')
  .action(async () => {
    try {
      await handleInit();
    } catch (err: any) {
      console.error(chalk.red('\n✖ Error running init:'), err.message);
      process.exit(1);
    }
  });

// ─── COMMAND: introspect ─────────────────────────────────────────────────────
program
  .command('introspect')
  .description('Scan an existing Postgres/Mongo schema and auto-generate definition manifests')
  .option('-db, --database <uri>', 'The URI string to introspect', '')
  .action(async (options) => {
    try {
      await handleIntrospect(options);
    } catch (err: any) {
      console.error(chalk.red('\n✖ Error running introspect:'), err.message);
      process.exit(1);
    }
  });

// ─── COMMAND: studio ─────────────────────────────────────────────────────────
program
  .command('studio')
  .description('Launch the local GUI Studio monitoring metrics and DB health')
  .option('-p, --port <number>', 'Port to run the studio server on', '4000')
  .action(async (options) => {
    try {
      await handleStudio(options);
    } catch (err: any) {
      console.error(chalk.red('\n✖ Error starting studio:'), err.message);
      process.exit(1);
    }
  });

program.parse(process.argv);
