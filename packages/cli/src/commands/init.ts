import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

export async function handleInit() {
  console.log(chalk.bold.blue('\nWelcome to SynapseDB Data OS 🚀\n'));

  const answers = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'databases',
      message: 'What databases do you have? (select all that apply)',
      choices: [
        { name: 'PostgreSQL', value: 'postgres' },
        { name: 'MongoDB', value: 'mongodb' },
        { name: 'Redis', value: 'redis' },
        { name: "I don't have any yet — set them up for me", value: 'none' },
      ],
      validate: (ans: string[]) => {
        if (ans.length === 0) return 'Please select at least one option.';
        if (ans.includes('none') && ans.length > 1) return 'Select only "None" if you do not have any.';
        return true;
      },
    },
    {
      type: 'list',
      name: 'useCase',
      message: "What's your primary use case?",
      choices: [
        { name: 'Web app backend', value: 'web' },
        { name: 'Analytics dashboard', value: 'analytics' },
        { name: 'AI / embeddings', value: 'ai' },
      ],
    },
    {
      type: 'list',
      name: 'language',
      message: 'TypeScript or JavaScript?',
      choices: [
        { name: 'TypeScript', value: 'ts' },
        { name: 'JavaScript', value: 'js' },
      ],
    },
  ]);

  const ext = answers.language === 'ts' ? 'ts' : 'js';
  const configContent = generateConfig(answers.databases, ext);

  const cwd = process.cwd();
  const configPath = path.join(cwd, `synapse.config.${ext}`);

  if (fs.existsSync(configPath)) {
    console.log(chalk.yellow(`\n⚠️  Configuration file synapse.config.${ext} already exists. Skipping creation.`));
  } else {
    fs.writeFileSync(configPath, configContent);
    console.log(chalk.green(`\n✔ Created ${chalk.bold(`synapse.config.${ext}`)}`));
  }

  // Generate mock db file to match User Request: "creates src/db.ts"
  const srcDir = path.join(cwd, 'src');
  if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir);

  const dbPath = path.join(srcDir, `db.${ext}`);
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, generateDbStub());
    console.log(chalk.green(`✔ Created ${chalk.bold(`src/db.${ext}`)}`));
  }

  const envExamplePath = path.join(cwd, '.env.example');
  if (!fs.existsSync(envExamplePath)) {
    fs.writeFileSync(envExamplePath, generateEnvExample(answers.databases));
    console.log(chalk.green(`✔ Created ${chalk.bold('.env.example')}`));
  }

  console.log(chalk.blue('\nDependencies needed:'));
  console.log(chalk.dim(`  npm install @synapsedb/core`));
  for (const db of answers.databases) {
    if (db !== 'none') {
      console.log(chalk.dim(`  npm install @synapsedb/plugin-${db}`));
    }
  }

  console.log(chalk.bold.green('\nYou are ready to go! 🎉'));
  console.log(chalk.dim('Run `npx synapsedb introspect` to generate your first schema.\n'));
}

function generateConfig(dbs: string[], ext: string): string {
  const pluginEntries = dbs.map(db => {
    switch (db) {
      case 'postgres':
        return `    postgres: {
      type: 'sql',
      package: '@synapsedb/plugin-postgres',
      config: { connectionUri: process.env.DATABASE_URL }
    }`;
      case 'redis':
        return `    redis: {
      type: 'cache',
      package: '@synapsedb/plugin-redis',
      config: { connectionUri: process.env.REDIS_URL }
    }`;
      case 'mongodb':
        return `    mongodb: {
      type: 'document',
      package: '@synapsedb/plugin-mongodb',
      config: { connectionUri: process.env.MONGO_URL }
    }`;
      default:
        return '';
    }
  }).filter(Boolean).join(',\n');

  return `import type { SynapseConfig } from '@synapsedb/core';

const config: SynapseConfig = {
  plugins: {
${pluginEntries}
  },
  topology: {
    consistency: 'EVENTUAL',
    retries: { maxAttempts: 3, initialDelayMs: 50 },
    circuitBreaker: { failureThreshold: 3, resetTimeoutMs: 1000 },
    requestTimeoutMs: 5000
  },
  intelligence: { enabled: true }
};

export default config;
`;
}

function generateDbStub(): string {
  return `import { SynapseEngine } from '@synapsedb/core';
import config from '../synapse.config';

const db = new SynapseEngine(config);

export async function initDB() {
  await db.initialize();
  return db;
}

export default db;
`;
}

function generateEnvExample(selectedDatabases: string[]): string {
  const lines = ['# SynapseDB — copy this to .env and fill in your values'];
  if (selectedDatabases.includes('postgres')) {
    lines.push('DATABASE_URL=postgresql://user:password@localhost:5432/mydb');
  }
  if (selectedDatabases.includes('redis')) {
    lines.push('REDIS_URL=redis://localhost:6379');
  }
  if (selectedDatabases.includes('mongodb')) {
    lines.push('MONGO_URL=mongodb://localhost:27017/mydb');
  }
  return lines.join('\n') + '\n';
}
