import chalk from 'chalk';
import blessed from 'blessed';
// @ts-ignore
import contrib from 'blessed-contrib';
import { TerminalStateEngine } from './dev.js';

// -----------------------------------------------------
// 🎬 CHAOS SCENARIO: DDOS ATTACK
// -----------------------------------------------------
class DdosChaosEngine {
  private engine: TerminalStateEngine;
  private tick = 0;

  constructor(engine: TerminalStateEngine) {
    this.engine = engine;
  }

  public simulateTick() {
    this.tick += 1; 

    // Base Traffic
    let currentOps = 150 + Math.floor(Math.random() * 20);
    
    // CHAOS SCRIPT
    if (this.tick === 1) {
      this.engine.pushLog(`{cyan-fg}🧠 Synapse Brain:{/} System idle. Edge shield active.`);
    } else if (this.tick === 5) {
      this.engine.pushLog(`{yellow-fg}⚠️ CHAOS EVENT:{/} Unidentified IP swarm detected targeting /api/v1/graphql`);
    } else if (this.tick === 6) {
      currentOps = 450;
      this.engine.state.statusLine = '{yellow-bg}{black-fg} ⚠️ TRAFFIC SURGE {/}';
    } else if (this.tick === 7) {
      currentOps = 2200; // The DDoS
      this.engine.state.statusLine = '{red-bg}{white-fg} 🚨 CRITICAL: L7 DDOS DETECTED 🚨 {/}';
      this.engine.pushLog(`{red-bg}{white-fg} 🚨 L7 ATTACK ON POSTGRES CORE 🚨 {/}`);
      process.stdout.write('\x07'); 
    } else if (this.tick === 8) {
      currentOps = 8500;
      this.engine.state.statusLine = '{red-bg}{white-fg} 🚨 CRITICAL: L7 DDOS DETECTED 🚨 {/}';
      this.engine.pushLog(`{red-fg}👤 Users dynamically impacted: 84,204 sessions dropped{/}`);
      this.engine.pushLog(`{yellow-fg}[SYSTEM]{/} PostgreSQL query queue saturated. Connection limits hit.`);
    } else if (this.tick === 9) {
      currentOps = 14200;
      this.engine.state.statusLine = '{red-bg}{white-fg} 🚨 CRITICAL: L7 DDOS DETECTED 🚨 {/}';
      this.engine.pushLog(`{magenta-fg}⚡ Synapse Engine:{/} Engaging Hardened Edge Caching. Dropping connection pooling...`);
    } else if (this.tick === 10) {
      currentOps = 12000;
      this.engine.state.statusLine = '{yellow-fg}⚠️ Mitigating...{/}';
      this.engine.pushLog(`{cyan-fg}🛡️ Cloudflare Sync:{/} IP ban rules propagating...`);
    } else if (this.tick === 12) {
      currentOps = 1800;
      this.engine.pushLog(`{green-fg}✔ Edge Shield absorbed 99.8% of malicious packets.{/}`);
    } else if (this.tick === 15) {
      currentOps = 180;
      this.engine.state.statusLine = '{green-fg}✔ Attack Mitigated{/}';
      this.engine.pushLog(`{green-fg}✔ PostgreSQL recovered. Zero dropped transactions.{/}`);
      this.engine.triggerRewardFlash();
      process.stdout.write('\x07'); 
    }

    let currentHit = this.engine.state.cacheHitRate;
    if (this.tick > 7 && this.tick < 10) currentHit = 12; // Cache is bypassed by new IPs initially
    else if (this.tick >= 10) currentHit = 99.8; // Edge takes over
    
    let currentMem = this.engine.state.memoryUsage;
    if (this.tick > 7 && this.tick < 11) currentMem += 4.5;
    if (this.tick === 12) currentMem = 28.0; 
    
    this.engine.updateMetrics(currentOps, currentHit, currentMem);
  }
}

export async function handlePlay(scenario: string) {
  if (scenario !== 'ddos') {
    console.log(chalk.red(`Error: Scenario '${scenario}' not found. Try: 'synapse play ddos'`));
    process.exit(1);
  }

  console.clear();
  console.log(chalk.magenta(' 🎲 INITIALIZING CHAOS ENGINE: ') + chalk.white.bold(scenario.toUpperCase()));
  await new Promise(r => setTimeout(r, 1500));

  const stateEngine = new TerminalStateEngine();
  const storyEngine = new DdosChaosEngine(stateEngine);

  stateEngine.setMode('AGGRESSIVE ⚡'); // Force mode for chaos
  stateEngine.state.tpsHistory = Array(8).fill(200);

  const screen = blessed.screen({
    smartCSR: true,
    fullUnicode: true,
    title: `SynapseDB Terminal OS - PLAY: ${scenario}`
  });

  const grid = new contrib.grid({rows: 12, cols: 12, screen: screen});

  const infraBox = grid.set(0, 0, 4, 3, blessed.box, { label: ' ⚙️  INFRASTRUCTURE ', tags: true, border: { type: 'line', fg: 'magenta' } });
  const trustBox = grid.set(0, 3, 4, 3, blessed.box, { label: ' 🛡️  CONFIDENCE LAYER ', tags: true, border: { type: 'line', fg: 'magenta' } });
  const cacheBox = grid.set(0, 6, 4, 3, blessed.box, { label: ' ⚡ CACHE POWER LEVEL ', tags: true, border: { type: 'line', fg: 'magenta' } });
  
  const tpsLine = grid.set(0, 9, 4, 3, contrib.line, {
    label: ' 📈 CHAOS HEARTBEAT ',
    style: { line: 'red', text: 'white', baseline: 'black' },
    xLabelPadding: 3, xPadding: 1, border: { type: 'line', fg: 'magenta' }, showLegend: true,
  });

  const brainLogs = grid.set(4, 0, 8, 12, contrib.log, {
    fg: 'red', selectedFg: 'green',
    label: ` 🧠 ${scenario.toUpperCase()} CHAOS SCENARIO  |  (Hit 'q' to abort) `,
    border: { type: 'line', fg: 'magenta' }, bufferLength: 50
  });

  const dataInterval = setInterval(() => storyEngine.simulateTick(), 1000);
  storyEngine.simulateTick(); 

  const renderInterval = setInterval(() => {
    if (!stateEngine.isDirty) return;
    const state = stateEngine.state;

    if (state.rewardFlash) {
      infraBox.style.bg = 'white'; trustBox.style.bg = 'white'; cacheBox.style.bg = 'white';
    } else {
      infraBox.style.bg = 'black'; trustBox.style.bg = 'black'; cacheBox.style.bg = 'black';
    }

    infraBox.setContent(`\n  {green-fg}🟢{/} PostgreSQL   {cyan-fg}[ 4.2ms]{/}\n  {green-fg}🟢{/} Redis        {cyan-fg}[ 0.8ms]{/}\n\n  {gray-fg}Mem Engine:{/}  {magenta-fg}${state.memoryUsage.toFixed(1)} MB{/}`);
    trustBox.setContent(`\n  Consistency: {yellow-fg}STRESSED{/}\n  Failover:    {yellow-fg}ENGAGING{/}\n\n  S-STATUS:    ${state.statusLine}`);

    const filledBars = Math.min(20, Math.max(0, Math.floor((state.cacheHitRate / 100) * 20)));
    const barStr = '█'.repeat(filledBars) + '░'.repeat(20 - filledBars);
    let powerColor = state.cacheHitRate > 80 ? '{green-fg}' : (state.cacheHitRate > 50 ? '{yellow-fg}' : '{red-fg}');

    cacheBox.setContent(`\n  ${powerColor}${barStr}{/}\n\n  {bold}HIT RATE:{/} ${powerColor}${state.cacheHitRate.toFixed(1)}%{/}`);
    tpsLine.setData([
      { title: 'Attack Ops', x: ['1','2','3','4','5','6','7','8'], y: state.tpsHistory, style: { line: 'red' } },
      { title: 'Baseline', x: ['1','2','3','4','5','6','7','8'], y: Array(8).fill(200), style: { line: 'magenta' } }
    ]);

    while (stateEngine.queuedLogs.length > 0) brainLogs.log(stateEngine.queuedLogs.shift()!);

    screen.render();
    stateEngine.isDirty = false;
  }, 66); 

  function teardown() { clearInterval(dataInterval); clearInterval(renderInterval); screen.destroy(); process.exit(0); }
  screen.key(['escape', 'q', 'C-c'], teardown);
}
