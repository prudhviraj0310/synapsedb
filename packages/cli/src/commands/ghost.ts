import chalk from 'chalk';
import blessed from 'blessed';
// @ts-ignore
import contrib from 'blessed-contrib';

// -----------------------------------------------------
// 👻 SYNAPSE GHOST (SHADOW TRAFFIC REPLICATOR)
// -----------------------------------------------------
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function handleGhost() {
  console.clear();
  console.log(chalk.cyan('⠋ Establishing Zero-Downtime AST Splitter...'));
  await sleep(600);
  console.log(chalk.green('✔ Initializing Synapse Shadow Mirror Protocol'));
  await sleep(400);

  const screen = blessed.screen({ smartCSR: true, fullUnicode: true, title: 'SynapseDB - Shadow Traffic' });
  const grid = new contrib.grid({rows: 12, cols: 12, screen: screen});

  // 1. TOP PANE (FIREHOSE)
  const firehosePane = grid.set(0, 0, 4, 12, contrib.log, {
    label: ' ⚡ INCOMING PROD TRAFFIC (API GATEWAY) ', fg: 'cyan',
    border: { type: 'line', fg: 'magenta' }, bufferLength: 50
  });

  // 2. BOTTOM LEFT PANE (PROD DB)
  const prodPane = grid.set(4, 0, 8, 6, contrib.log, {
    label: ' 🟩 PRIMARY (US-EAST-1) ', fg: 'green',
    border: { type: 'line', fg: 'green' }, tags: true, bufferLength: 50
  });

  // 3. BOTTOM RIGHT PANE (STAGING DB)
  const stagingPane = grid.set(4, 6, 8, 6, contrib.log, {
    label: ' 👻 SHADOW BRANCH (LOCAL-SANDBOX) ', fg: 'gray',
    border: { type: 'line', fg: 'gray' }, tags: true, bufferLength: 50
  });

  const routes = ['POST /users', 'GET /auth', 'PUT /settings', 'POST /checkout'];

  let requestCount = 0;

  const loop = setInterval(() => {
    requestCount++;
    const route = routes[Math.floor(Math.random() * routes.length)];
    const reqId = Math.random().toString(16).substr(2, 6).toUpperCase();
    
    // Top Firehose shows the incoming payload
    firehosePane.log(`[REQ-${reqId}] {white-fg}${route}{/} -> Routing to AST Splitter...`);

    // Splitting Logic visually
    // 100% hits Prod
    prodPane.log(`{white-bg}{black-fg} EXECUTE {/} ${route} [AST-${reqId}] {green-fg}HTTP 200{/}`);
    
    // 50% randomly hits shadow branch to simulate load testing or shadow deploying
    if (Math.random() > 0.4) {
      stagingPane.log(`{gray-bg}{black-fg} GHOSTED {/} ${route} [AST-${reqId}] {gray-fg}(Dry Run){/}`);
    } else {
      stagingPane.log(''); // empty line to simulate staggered traffic
    }

    screen.render();
  }, 180); // Fast stream

  screen.key(['escape', 'q', 'C-c'], () => {
    clearInterval(loop);
    screen.destroy();
    console.log(chalk.green('\n✔ SynapseOS: Shadow Replication disconnected.'));
    process.exit(0);
  });
}
