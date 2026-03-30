import chalk from 'chalk';
import blessed from 'blessed';
// @ts-ignore
import contrib from 'blessed-contrib';

// -----------------------------------------------------
// 🎬 1. CINEMATIC BOOT SEQUENCE
// -----------------------------------------------------
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function bootSequence() {
  console.clear();
  console.log(chalk.gray('[0.0s]') + chalk.cyan(' ⠋ Initializing Synapse Kernel...'));
  await sleep(800);
  console.log(chalk.gray('[0.8s]') + chalk.cyan(' ⠙ Connecting to PostgreSQL Cloud ') + chalk.green('[OK]'));
  await sleep(400);
  console.log(chalk.gray('[1.2s]') + chalk.cyan(' ⠹ Connecting to Redis Edge ') + chalk.green('[OK]'));
  await sleep(300);
  console.log(chalk.gray('[1.5s]') + chalk.cyan(' ⠸ Booting Intelligence Layer...'));
  await sleep(500);
  console.log(chalk.gray('[2.0s]') + chalk.cyan(' 🧠 Synapse Brain: Online. Handing over control to OS.'));
  await sleep(800);
}

// -----------------------------------------------------
// 🧠 2. STATE MANAGEMENT KERNEL 
// -----------------------------------------------------
export class TerminalStateEngine {
  public isDirty = true;
  
  public state = {
    opsPerSec: 120,
    cacheHitRate: 15,
    memoryUsage: 22.5,
    tpsHistory: Array(8).fill(150) as number[], 
    statusLine: '{green-fg}✔ All systems nominal{/}',
    mode: 'BALANCED ⚖️' as 'BALANCED ⚖️' | 'AGGRESSIVE ⚡' | 'SAFE 🛡️' | 'COST SAVER 💰',
    rewardFlash: false
  };

  public queuedLogs: string[] = [];

  public pushLog(msg: string) {
    this.queuedLogs.push(`{gray-fg}[${new Date().toLocaleTimeString()}]{/} ${msg}`);
    this.isDirty = true;
  }

  public setMode(newMode: 'BALANCED ⚖️' | 'AGGRESSIVE ⚡' | 'SAFE 🛡️' | 'COST SAVER 💰') {
    this.state.mode = newMode;
    this.pushLog(`{white-bg}{black-fg} SYSTEM OVERRIDE: Shifted to ${newMode} MODE {/}`);
    this.isDirty = true;
  }

  public triggerRewardFlash() {
    this.state.rewardFlash = true;
    this.isDirty = true;
    setTimeout(() => {
      this.state.rewardFlash = false;
      this.isDirty = true;
    }, 150); // 150ms screen invert flash
  }

  public updateMetrics(ops: number, hitRate: number, mem: number) {
    this.state.opsPerSec = ops;
    this.state.cacheHitRate = hitRate;
    this.state.memoryUsage = mem;
    
    this.state.tpsHistory.shift();
    this.state.tpsHistory.push(ops);
    
    this.isDirty = true;
  }
}

// -----------------------------------------------------
// 🌊 3. NARRATIVE STORY ENGINE (THE MOVIE)
// -----------------------------------------------------
class NarrativeStoryEngine {
  private engine: TerminalStateEngine;
  private tick = 0;

  constructor(engine: TerminalStateEngine) {
    this.engine = engine;
  }

  public simulateTick() {
    this.tick += 1; 
    
    // Dynamic Mode Multipliers
    let baseTraffic = 150;
    if (this.engine.state.mode === 'AGGRESSIVE ⚡') baseTraffic = 280;
    if (this.engine.state.mode === 'SAFE 🛡️') baseTraffic = 90;
    if (this.engine.state.mode === 'COST SAVER 💰') baseTraffic = 110;

    const wave = Math.sin(this.tick * 0.5) * (this.engine.state.mode === 'AGGRESSIVE ⚡' ? 80 : 15); 
    let currentOps = Math.floor(baseTraffic + wave);
    
    if (this.tick < 8 || this.tick > 15) {
      this.engine.state.statusLine = '{green-fg}✔ All systems nominal{/}';
    }

    // THE CINEMATIC SCRIPT 🎬
    if (this.tick === 1) {
      this.engine.pushLog(`{cyan-fg}🧠 Synapse Brain:{/} monitoring baseline telemetry...`);
    } else if (this.tick === 4) {
      this.engine.pushLog(`{yellow-fg}⚠️ System Imperfection:{/} Partial cache miss detected on /auth. Resolving.`);
    } else if (this.tick === 5) {
      this.engine.pushLog(`{cyan-fg}🧠 Synapse Brain:{/} Observing traffic anomaly on /feed... (Analyzing)`);
    } else if (this.tick === 8) {
      this.engine.pushLog(`{yellow-fg}[SYSTEM]{/} ⚠️ Warning: Traffic vector shifting. Potential spike inbound.`);
      this.engine.state.statusLine = '{yellow-fg}⚠️ Traffic shift detected{/}';
    } else if (this.tick === 10) {
      currentOps = 380; // Spike!
      this.engine.state.statusLine = '{white-bg}{black-fg} ⚠️ DEGRADED PERFORMANCE DETECTED {/}';
      this.engine.pushLog(`{red-bg}{white-fg} ⚠️ SPIKE DETECTED on /feed ⚠️ {/}`);
      this.engine.pushLog(`{red-fg}👤 Users dynamically impacted: 1,402 sessions degraded{/}`);
      process.stdout.write('\x07'); 
    } else if (this.tick === 11) {
      currentOps = 430;
      this.engine.state.statusLine = '{white-bg}{black-fg} ⚠️ DEGRADED PERFORMANCE DETECTED {/}';
      this.engine.pushLog(`{yellow-fg}⚠️ Redis replica sync delayed by 12ms. Forcing hard limit.{/}`);
    } else if (this.tick === 12) {
      currentOps = 450;
      this.engine.state.statusLine = '{white-bg}{black-fg} ⚠️ DEGRADED PERFORMANCE DETECTED {/}';
      this.engine.pushLog(`{magenta-fg}⚡ Synapse Engine:{/} Rapid scaling initiated. Rerouting 62% traffic to Edge...`);
    } else if (this.tick === 13) {
      currentOps = 220; 
      this.engine.state.statusLine = '{yellow-fg}⚠️ Recovering load...{/}';
    } else if (this.tick === 14) {
      currentOps = 160; 
    } else if (this.tick === 15) {
      this.engine.pushLog(`{green-fg}✔ Load stabilized. Traffic pattern normalized.{/}`);
    } else if (this.tick === 17) {
      this.engine.triggerRewardFlash();
      this.engine.pushLog(`{white-bg}{black-fg} 🔥 SYSTEM STABILIZED: +28% PERFORMANCE GAIN ACHIEVED {/}`);
      this.engine.pushLog(`{green-fg}💰 Cloud cost saved: $14.20 (Bypassed 84K Postgres reads in last 5s){/}`);
      process.stdout.write('\x07'); 
    } else if (this.tick === 20) {
      this.engine.pushLog(`{cyan-fg}🧠 Synapse Brain:{/} monitoring...`);
    } else if (this.tick > 25 && this.tick % 15 === 0) {
      this.engine.pushLog(`{cyan-fg}🧠 Synapse Brain:{/} monitoring...`);
    }

    let currentHit = this.engine.state.cacheHitRate;
    let targetHit = 96;
    if (this.engine.state.mode === 'SAFE 🛡️') targetHit = 99.9;
    if (this.engine.state.mode === 'COST SAVER 💰') targetHit = 82;
    if (this.engine.state.mode === 'AGGRESSIVE ⚡') targetHit = 88; // Lower hit rate because of heavy mem swapping

    if (this.tick < 10) currentHit += (targetHit - currentHit) * 0.2;
    else if (this.tick >= 12) currentHit += (targetHit - currentHit) * 0.4;
    
    let currentMem = this.engine.state.memoryUsage + 0.1;
    if (this.engine.state.mode === 'COST SAVER 💰') currentMem = 12.0; // Artificial compression
    if (this.engine.state.mode === 'AGGRESSIVE ⚡') currentMem += 1.5;
    if (this.tick === 15) currentMem = 22.1; 
    
    this.engine.updateMetrics(currentOps, currentHit, currentMem);
  }
}

// -----------------------------------------------------
// 🖥️ 4. DASHBOARD RENDER & LIFECYCLE
// -----------------------------------------------------

export async function handleDev() {
  await bootSequence();

  const stateEngine = new TerminalStateEngine();
  const storyEngine = new NarrativeStoryEngine(stateEngine);

  const screen = blessed.screen({
    smartCSR: true,
    fullUnicode: true,
    title: 'SynapseDB Terminal OS'
  });

  const grid = new contrib.grid({rows: 12, cols: 12, screen: screen});

  const infraBox = grid.set(0, 0, 4, 3, blessed.box, {
    label: ' ⚙️  INFRASTRUCTURE ',
    tags: true,
    border: { type: 'line', fg: 'cyan' },
  });

  const trustBox = grid.set(0, 3, 4, 3, blessed.box, {
    label: ' 🛡️  CONFIDENCE LAYER ',
    tags: true,
    border: { type: 'line', fg: 'cyan' },
  });

  const cacheBox = grid.set(0, 6, 4, 3, blessed.box, {
    label: ' ⚡ CACHE POWER LEVEL ',
    tags: true,
    border: { type: 'line', fg: 'cyan' },
  });

  const tpsLine = grid.set(0, 9, 4, 3, contrib.line, {
    label: ' 📈 SYSTEM HEARTBEAT ',
    style: { line: 'yellow', text: 'white', baseline: 'black' },
    xLabelPadding: 3,
    xPadding: 1,
    border: { type: 'line', fg: 'cyan' },
    showLegend: true,
  });

  const brainLogs = grid.set(4, 0, 8, 12, contrib.log, {
    fg: 'green',
    selectedFg: 'green',
    label: ' 🧠 AUTO-TUNER INFERENCE LOGS (LIVE)  |  MODE: BALANCED ⚖️ ',
    border: { type: 'line', fg: 'cyan' },
    bufferLength: 50
  });

  // Mode Control Keys
  screen.key(['a'], () => stateEngine.setMode('AGGRESSIVE ⚡'));
  screen.key(['s'], () => stateEngine.setMode('SAFE 🛡️'));
  screen.key(['c'], () => stateEngine.setMode('COST SAVER 💰'));
  screen.key(['b'], () => stateEngine.setMode('BALANCED ⚖️'));

  const dataInterval = setInterval(() => {
    storyEngine.simulateTick();
  }, 1000);

  storyEngine.simulateTick(); 

  const renderInterval = setInterval(() => {
    if (!stateEngine.isDirty) return;
    const state = stateEngine.state;

    // The Flash Screen cinematic reward
    if (state.rewardFlash) {
      infraBox.style.bg = 'white';
      trustBox.style.bg = 'white';
      cacheBox.style.bg = 'white';
      // Logs are hard to background color flash using contrib natively, but we flash borders:
      brainLogs.style.border.fg = 'white';
    } else {
      infraBox.style.bg = 'black';
      trustBox.style.bg = 'black';
      cacheBox.style.bg = 'black';
      brainLogs.style.border.fg = 'cyan';
    }

    brainLogs.setLabel(` 🧠 AUTO-TUNER INFERENCE LOGS  |  MODE: ${state.mode}  |  (Controls: [A]ggressive [S]afe [C]ost-Saver [B]alanced) `);

    infraBox.setContent(
      `\n` +
      `  {green-fg}🟢{/} PostgreSQL   {cyan-fg}[ 4.2ms]{/}\n` +
      `  {green-fg}🟢{/} Redis        {cyan-fg}[ 0.8ms]{/}\n` +
      `  {green-fg}🟢{/} DuckDB       {cyan-fg}[ 0.1ms]{/}\n\n` +
      `  {gray-fg}Mem Engine:{/}  {magenta-fg}${state.memoryUsage.toFixed(1)} MB{/}`
    );

    trustBox.setContent(
      `\n` +
      `  Consistency: {green-fg}STRONG{/}\n` +
      `  Failover:    {green-fg}READY{/}\n` +
      `  Sync Status: {green-fg}HEALTHY{/}\n\n` +
      `  S-STATUS:    ${state.statusLine}`
    );

    const totalBars = 20;
    let filledBars = Math.floor((state.cacheHitRate / 100) * totalBars);
    if (filledBars < 0) filledBars = 0;
    if (filledBars > totalBars) filledBars = totalBars;
    
    const barStr = '█'.repeat(filledBars) + '░'.repeat(totalBars - filledBars);
    let powerColor = '{red-fg}';
    if (state.cacheHitRate > 80) powerColor = '{green-fg}';
    else if (state.cacheHitRate > 50) powerColor = '{yellow-fg}';

    cacheBox.setContent(
      `\n` +
      `  ${powerColor}${barStr}{/}\n\n` +
      `  {bold}HIT RATE:{/} ${powerColor}${state.cacheHitRate.toFixed(1)}%{/}\n` +
      `  {gray-fg}Routing ~${Math.floor(state.opsPerSec * (state.cacheHitRate/100))} ops to Edge{/}`
    );

    let baseline = 150;
    if (state.mode === 'AGGRESSIVE ⚡') baseline = 280;
    if (state.mode === 'SAFE 🛡️') baseline = 90;
    if (state.mode === 'COST SAVER 💰') baseline = 110;

    tpsLine.setData([
      { title: 'Live Ops', x: ['1', '2', '3', '4', '5', '6', '7', '8'], y: state.tpsHistory, style: { line: 'yellow' } },
      { title: 'Baseline', x: ['1', '2', '3', '4', '5', '6', '7', '8'], y: Array(8).fill(baseline), style: { line: 'cyan' } }
    ]);

    while (stateEngine.queuedLogs.length > 0) {
      brainLogs.log(stateEngine.queuedLogs.shift()!);
    }

    screen.render();
    stateEngine.isDirty = false;
  }, 66); 

  function teardown() {
    clearInterval(dataInterval);
    clearInterval(renderInterval);
    screen.destroy();
    console.log(chalk.green('\n✔ SynapseOS: Session cleanly unmounted. Terminating.'));
    process.exit(0);
  }

  screen.key(['escape', 'q', 'C-c'], teardown);
  process.on('SIGINT', teardown);
  process.on('SIGTERM', teardown);
  process.on('uncaughtException', (err) => {
    teardown();
    console.error(chalk.red('\nFatal Process Error:'), err);
    process.exit(1);
  });

  screen.render();
}
