import inquirer from 'inquirer';
import chalk from 'chalk';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const asciiArt = `
${chalk.cyan('   _____                             ')}
${chalk.cyan('  / ___/__  ______  ____ _____  ___  ')}
${chalk.bold.cyan('  \\__ \\/ / / / __ \\/ __ `/ __ \\/ _ \\ ')}
${chalk.bold.blue(' ___/ / /_/ / / / / /_/ / /_/ /  __/ ')}
${chalk.blue('/____/\\__, /_/ /_/\\__,_/ .___/\\___/  ')}
${chalk.dim('     /____/           /_/            ')}
${chalk.bold.white('          DATA ORCHESTRATION OS      ')}
`;

const byline = chalk.dim('Built with ❤️  by ') + chalk.bold.magenta('Prudhviraj (@prudhviraj0310)');

async function launch() {
  console.clear();
  console.log(asciiArt);
  console.log(byline);
  console.log('\n');

  while (true) {
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to run?',
        choices: [
          new inquirer.Separator(),
          { name: '📖 The SynapseDB Story (Why we built this)', value: 'story' },
          { name: '🧪 Run Platform E2E Tests (Full Stack)', value: 'test' },
          { name: '📊 Launch Studio (GUI Dashboard)', value: 'studio' },
          { name: '🌐 Setup Database Infra (Postgres+Redis via Homebrew)', value: 'infra' },
          new inquirer.Separator(),
          { name: '🚪 Exit', value: 'exit' }
        ]
      }
    ]);

    if (action === 'exit') {
      console.log(chalk.gray('\nGoodbye!\n'));
      process.exit(0);
    }

    try {
      if (action === 'story') {
        renderStory();
      }
      else if (action === 'test') {
        console.log(chalk.cyan('\n▶ Running comprehensive test suite...\n'));
        execSync('npx tsx apps/demo/src/test-platform.ts', { 
          stdio: 'inherit',
          cwd: path.resolve(__dirname, '../../..')
        });
      } 
      else if (action === 'studio') {
        console.log(chalk.cyan('\n▶ Booting SynapseDB Studio on :4000\n'));
        execSync('npx tsx packages/cli/bin/synapsedb.ts studio', { 
          stdio: 'inherit',
          cwd: path.resolve(__dirname, '../../..') 
        });
      }
      else if (action === 'infra') {
        console.log(chalk.magenta('\n▶ Installing architecture on macOS (Homebrew required)...\n'));
        try {
          execSync('createdb synapsetest || echo "DB already exists"', { stdio: 'inherit' });
          execSync('brew install redis && brew services start redis', { stdio: 'inherit' });
          console.log(chalk.green('\n✔ Databases are running globally.\n'));
        } catch (e: any) {
          console.log(chalk.red('\n✖ Infra setup failed. Ensure PostgreSQL and Homebrew are installed.\n'));
        }
      }
    } catch (error: any) {
      console.log(chalk.red('\n✖ Process exited with errors.\n'));
    }

    // Wait for user before showing menu again
    await inquirer.prompt([
      { type: 'input', name: 'continue', message: 'Press Enter to return to the menu...' }
    ]);
    console.clear();
    console.log(asciiArt);
    console.log(byline);
    console.log('\n');
  }
}

function renderStory() {
  console.clear();
  console.log(chalk.bold.magenta('\n=== Stop writing Redis caching manually. SynapseDB does it for you. ===\n'));
  
  console.log(chalk.cyan('🚀 Meet Prudhvi (Every Backend Dev Ever)'));
  console.log('Prudhvi is building a fast Express backend.');
  console.log('He knows what’s coming: Postgres for data, Redis for caching, messy sync logic, race conditions, and debugging at 2AM.\n');

  console.log(chalk.red('❌ The Normal Way (Pain)'));
  console.log(chalk.dim(`const cached = await redis.get(\`user:\${id}\`);
if (cached) return JSON.parse(cached);

const user = await db.query('SELECT * FROM users WHERE id=$1', [id]);
await redis.set(\`user:\${id}\`, JSON.stringify(user));
return user;`));
  console.log(chalk.red.italic('👉 Multiply this across your app = pain.\n'));

  console.log(chalk.green('⚡ With SynapseDB (Prudhvi’s Experience)'));
  console.log(chalk.bold('1. Setup — 30 seconds'));
  console.log(chalk.dim('npx synapsedb init (Select Postgres & Redis. Done. No config headaches.)\n'));

  console.log(chalk.bold('2. Write API — 2 minutes'));
  console.log(chalk.dim(`import db from './db.js';
// Create user
await db.insert('users', [req.body]);
// Get user
const user = await db.findOne('users', { id: req.params.id });`));
  console.log(chalk.green.italic('👉 That’s it. No SQL. No Redis. No caching logic.\n'));

  console.log(chalk.yellow('🔥 What Actually Happens (The Magic)'));
  console.log('⚡ ' + chalk.bold('Automatic Caching:') + ' First request → Postgres. Next requests → Redis (sub-ms).');
  console.log(chalk.yellow.italic('👉 You wrote zero caching code\n'));

  console.log('🛡️ ' + chalk.bold('Built-in Resilience:') + ' DB goes down? Synapse returns safe errors & auto-recovers.');
  console.log(chalk.yellow.italic('👉 No crashes. No chaos.\n'));

  console.log('🔄 ' + chalk.bold('Future-Proof:') + ' Want Mongo later? type: "postgres" → "mongodb"');
  console.log(chalk.yellow.italic('👉 Your API code stays untouched.\n'));

  console.log(chalk.bold.magenta('🧠 What Prudhvi Realizes'));
  console.log(chalk.italic('"Wait… I didn’t write caching… but it’s working?"'));
  console.log('That’s when it clicks.\n');

  console.log(chalk.bgMagenta.white.bold(' SYNAPSEDB IS NOT JUST A DB TOOL '));
  console.log(chalk.bold('It’s a system that handles data complexity for you.\n'));
  
  console.log('Prudhvi came for an "easy database setup". He got:');
  console.log('  ⚡ automatic Redis caching');
  console.log('  🛡️ fault tolerance');
  console.log('  🔄 multi-database flexibility');
  console.log('  📊 real-time analytics\n');
}

launch().catch((err) => {
  console.error(chalk.red('\nFatal crash:'), err);
  process.exit(1);
});
