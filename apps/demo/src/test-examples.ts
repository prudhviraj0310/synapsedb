// ══════════════════════════════════════════════════════════════
// SynapseDB Platform — STEP 4: Example App Smoke Tests
// ══════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';

const pass = (msg: string) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const fail = (msg: string) => console.log(`  \x1b[31m✗\x1b[0m ${msg}`);
const section = (msg: string) => console.log(`\n\x1b[36m━━ ${msg} ━━\x1b[0m`);

let passed = 0, failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) { pass(msg); passed++; }
  else { fail(msg); failed++; }
}

interface ExampleApp {
  name: string;
  dir: string;
  requiredPlugins: string[];
}

const apps: ExampleApp[] = [
  {
    name: 'example-blog',
    dir: 'apps/example-blog',
    requiredPlugins: ['@synapsedb/plugin-postgres', '@synapsedb/plugin-redis'],
  },
  {
    name: 'example-ecommerce',
    dir: 'apps/example-ecommerce',
    requiredPlugins: ['@synapsedb/plugin-postgres', '@synapsedb/plugin-mongodb'],
  },
  {
    name: 'example-realtime',
    dir: 'apps/example-realtime',
    requiredPlugins: ['@synapsedb/plugin-redis'],
  },
];

function testExampleApp(app: ExampleApp) {
  section(`${app.name} — Structure Check`);

  const root = path.resolve(app.dir);

  // 1. package.json exists
  const pkgPath = path.join(root, 'package.json');
  assert(fs.existsSync(pkgPath), `${app.name} — package.json exists`);

  if (!fs.existsSync(pkgPath)) return;

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

  // 2. Has a start script
  assert(
    !!(pkg.scripts?.start || pkg.scripts?.dev),
    `${app.name} — has start/dev script`,
  );

  // 3. src/ directory exists with at least one file
  const srcDir = path.join(root, 'src');
  assert(fs.existsSync(srcDir), `${app.name} — src/ directory exists`);

  if (fs.existsSync(srcDir)) {
    const srcFiles = fs.readdirSync(srcDir);
    assert(srcFiles.length >= 1, `${app.name} — src/ has ${srcFiles.length} file(s)`);
  }

  // 4. @synapsedb/core is listed in dependencies
  const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.peerDependencies ?? {}) };
  assert(
    '@synapsedb/core' in allDeps,
    `${app.name} — depends on @synapsedb/core`,
  );

  // 5. Required plugins are listed
  for (const plugin of app.requiredPlugins) {
    assert(
      plugin in allDeps,
      `${app.name} — depends on ${plugin}`,
    );
  }

  // 6. Main entry file content check
  const mainFile = path.join(srcDir, 'index.js');
  if (fs.existsSync(mainFile)) {
    const content = fs.readFileSync(mainFile, 'utf-8');
    assert(
      content.includes('SynapseEngine') || content.includes('@synapsedb/core'),
      `${app.name} — main file imports SynapseDB`,
    );
    assert(
      content.includes('initialize'),
      `${app.name} — main file calls initialize()`,
    );
  }
}

// ─── MAIN ────────────────────────────────────────────────────

function main() {
  console.log('\n══════════════════════════════════════════════');
  console.log('  SynapseDB — Example App Smoke Tests');
  console.log('══════════════════════════════════════════════');

  for (const app of apps) {
    testExampleApp(app);
  }

  console.log('\n──────────────────────────────────────────────');
  console.log(`  Passed: ${passed}  Failed: ${failed}`);
  console.log('──────────────────────────────────────────────\n');

  if (failed > 0) process.exit(1);
}

main();
