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
import { handleDev } from '../src/commands/dev.js';
import { handleTrace } from '../src/commands/trace.js';
import { handleExplain } from '../src/commands/explain.js';
import { handlePlay } from '../src/commands/play.js';
import { handleMap } from '../src/commands/map.js';
import { handleReplay } from '../src/commands/replay.js';
import { handleFreeze } from '../src/commands/freeze.js';
import { handleHeal } from '../src/commands/heal.js';
import { handleChat } from '../src/commands/chat.js';
import { handleGuard } from '../src/commands/guard.js';
import { handlePulse } from '../src/commands/pulse.js';
import { handleNuke } from '../src/commands/nuke.js';
import { handleGhost } from '../src/commands/ghost.js';
import { handleWarp } from '../src/commands/warp.js';
import { handleLock } from '../src/commands/lock.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJsonPath = fs.existsSync(path.join(__dirname, '../package.json'))
  ? path.join(__dirname, '../package.json')      // When running via tsx (src/bin/)
  : path.join(__dirname, '../../package.json');  // When running via compiled npx (dist/bin/)
const packageJson = fs.readJsonSync(packageJsonPath);
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

// ─── TERMINAL OS COMMANDS ──────────────────────────────────────────────

program
  .command('dev')
  .description('Launch the live Terminal Data OS metrics dashboard')
  .action(() => handleDev());

program
  .command('trace')
  .description('Visualize a query execution path and cache routing rules')
  .action(() => handleTrace());

program
  .command('play <scenario>')
  .description('Launch the cinematic Chaos Engine (e.g. ddos, spike)')
  .action((scenario) => handlePlay(scenario));

program
  .command('explain')
  .argument('[query]', 'The query to explain')
  .description('Visually compare standard manual caching with SynapseDB')
  .action((query) => handleExplain(query));

program
  .command('map')
  .description('Launch the Global Edge Telemetry Routing map')
  .action(() => handleMap());

program
  .command('replay')
  .description('Incident Replay System for forensic analysis')
  .requiredOption('-i, --incident <id>', 'The Incident ID to recount (e.g. ddos-114)')
  .action((options) => handleReplay(options.incident));

program
  .command('freeze')
  .description('Launch the Zero-ETL Data Blackhole Archiver')
  .action(() => handleFreeze());

program
  .command('heal')
  .description('Autonomously diagnose and repair broken database schemas')
  .action(() => handleHeal());

program
  .command('chat')
  .description('Launch the AI Database Whisperer Copilot')
  .action(() => handleChat());

program
  .command('guard')
  .description('Launch the Interactive Web Application Firewall')
  .action(() => handleGuard());

program
  .command('pulse')
  .description('Sweep the VPC and render the Database Topology Sonar')
  .action(() => handlePulse());

program
  .command('nuke')
  .description('Execute the Emergency Red Protocol to Purge Cache Memory')
  .action(() => handleNuke());

program
  .command('ghost')
  .description('Launch the Shadow Traffic Replicator to Staging')
  .action(() => handleGhost());

program
  .command('warp')
  .description('Engage the Zero-Downtime Data Migration Engine')
  .action(() => handleWarp());

program
  .command('lock')
  .description('Sweep the Data Layer with Cryptographic Matrix Encryption')
  .action(() => handleLock());

program.parse(process.argv);
