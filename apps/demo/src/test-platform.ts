// ══════════════════════════════════════════════════════════════
// SynapseDB Platform — STEP 6: Master Test Runner
// ══════════════════════════════════════════════════════════════

import { execSync } from 'node:child_process';

interface TestResult {
  name: string;
  file: string;
  passed: boolean;
  ms: number;
  output?: string;
}

const tests = [
  { name: 'Plugins',    file: 'test-plugins.ts'    },
  { name: 'CLI',        file: 'test-cli.ts'         },
  { name: 'Frameworks', file: 'test-frameworks.ts'  },
  { name: 'Examples',   file: 'test-examples.ts'    },
  { name: 'E2E',        file: 'test-e2e.ts'         },
];

const results: TestResult[] = [];

console.log('\n══════════════════════════════════════════════');
console.log('  SynapseDB Platform — Master Test Runner');
console.log('══════════════════════════════════════════════\n');

for (const test of tests) {
  console.log(`\x1b[90m▶ Running ${test.name}...\x1b[0m`);
  const start = performance.now();
  try {
    const output = execSync(`npx tsx apps/demo/src/${test.file}`, {
      cwd: process.cwd(),
      encoding: 'utf-8',
      timeout: 60000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const ms = performance.now() - start;
    results.push({ ...test, passed: true, ms, output });
    // Print the test output
    console.log(output);
  } catch (err: any) {
    const ms = performance.now() - start;
    results.push({ ...test, passed: false, ms, output: err.stdout || err.message });
    // Print the test output even on failure
    if (err.stdout) console.log(err.stdout);
    if (err.stderr) console.error(err.stderr);
  }
}

// ─── FINAL REPORT ────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════');
console.log('  SynapseDB Platform — Test Report');
console.log('══════════════════════════════════════════════');

for (const r of results) {
  const icon = r.passed ? '✓' : '✗';
  const color = r.passed ? '\x1b[32m' : '\x1b[31m';
  console.log(`  ${color}${icon}\x1b[0m  ${r.name.padEnd(14)} ${Math.round(r.ms)}ms`);
}

const passedCount = results.filter(r => r.passed).length;
const failedCount = results.filter(r => !r.passed).length;

console.log('──────────────────────────────────────────────');
console.log(`  Passed: ${passedCount}/${results.length}`);

if (failedCount > 0) {
  console.log(`  \x1b[31mFailed: ${failedCount}\x1b[0m`);

  // Show failure details
  for (const r of results.filter(f => !f.passed)) {
    console.log(`\n  \x1b[31m▸ ${r.name} FAILURE DETAIL:\x1b[0m`);
    const lastLines = (r.output || '').split('\n').slice(-10).join('\n');
    console.log(`    ${lastLines}`);
  }

  process.exit(1);
} else {
  console.log(`  \x1b[32mAll platform tests passing.\x1b[0m`);
}
console.log('══════════════════════════════════════════════\n');
