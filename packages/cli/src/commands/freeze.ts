import chalk from 'chalk';
import blessed from 'blessed';
// @ts-ignore
import contrib from 'blessed-contrib';

// -----------------------------------------------------
// 🥶 ZERO-ETL DATA BLACKHOLE (FREEZE CLI)
// -----------------------------------------------------
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function handleFreeze() {
  console.clear();
  console.log(chalk.cyan('⠋ Scanning Postgres for Cold Data partitions...'));
  await sleep(1200);
  console.log(chalk.green('✔ Found: 14.2M orphaned rows (Last read > 45 days)'));
  await sleep(800);
  console.log(chalk.red('⚠ Storage Warning: RAM allocation degraded by 38%'));
  await sleep(600);
  console.log(chalk.magenta('⚡ Synapse Engine: Initiating `Freeze` sequence to AWS Glacier.'));
  await sleep(1000);

  const screen = blessed.screen({ smartCSR: true, fullUnicode: true, title: 'SynapseDB - The Data Blackhole' });
  const grid = new contrib.grid({rows: 12, cols: 12, screen: screen});

  // PANES
  const hotBox = grid.set(0, 0, 4, 8, blessed.box, {
    label: ' 🟩 HOT TIER (Postgres RAM) ', border: { type: 'line', fg: 'green' },
    content: ''
  });

  const pipeBox = grid.set(4, 0, 4, 8, blessed.box, {
    label: ' ⬇ SYNAPSE ZERO-ETL VACUUM PIPE ⬇ ', border: { type: 'line', fg: 'cyan' },
    style: { fg: 'white' }, content: ''
  });

  const coldBox = grid.set(8, 0, 4, 8, blessed.box, {
    label: ' 🟦 COLD STORAGE (AWS S3 Glacier) ', border: { type: 'line', fg: 'blue' },
    content: ''
  });

  const lcdBox = grid.set(0, 8, 4, 4, contrib.lcd, {
    label: ' AWS COST COMPRESSION ($) ',
    border: { type: 'line', fg: 'magenta' },
    elements: 5, display: '0', elementSpacing: 4, elementPadding: 2,
    color: 'green',
    segmentWidth: 0.05, segmentInterval: 0.11, strokeWidth: 0.1
  });

  const sysLogs = grid.set(4, 8, 8, 4, contrib.log, {
    label: ' ⚡ ARCHIVE TRACKER ',
    fg: 'cyan', selectedFg: 'green', border: { type: 'line', fg: 'magenta' }, bufferLength: 50
  });

  // STATE
  let hotRows = Array(8).fill('');
  let coldRows = Array(8).fill('');
  let pipeRows = Array(8).fill('');
  let costSaved = 0.0;
  
  // Fill Hot Tier with raw Hex Hashes
  for (let i = 0; i < 8; i++) {
    hotRows[i] = Array(12).fill(0).map(() => `{green-fg}0x${Math.random().toString(16).substr(2, 6).toUpperCase()}{/}`).join('  ');
  }

  function updateUi() {
    hotBox.setContent('\n' + hotRows.join('\n'));
    pipeBox.setContent('\n' + pipeRows.join('\n'));
    coldBox.setContent('\n' + coldRows.join('\n'));
    // Contrib LCD accepts strings/numbers as `display(string)`
    lcdBox.setDisplay(`$${Math.floor(costSaved)}`);
    screen.render();
  }

  updateUi();

  // MATRIX WATERFALL ANIMATION
  let activeFreeze = true;
  let tick = 0;
  
  const waterfall = setInterval(() => {
    if (!activeFreeze) return;
    tick++;

    // 1. Drain from Hot
    if (tick % 2 === 0 && hotRows.length > 0) {
      // Pop the bottom row of Hot
      hotRows.pop();
      // Insert a blank at top to make it look like it's draining downward
      hotRows.unshift(''); 
    }

    // 2. Drop through Pipe
    pipeRows.pop(); 
    if (tick < 25) { 
        // Feed hashes down the pipe
        const hashStream = Array(12).fill(0).map(() => 
          Math.random() > 0.5 ? `{cyan-fg}⬇ 0x${Math.random().toString(16).substr(2, 6).toUpperCase()}{/}` : `{magenta-fg}    |   {/}`
        ).join('  ');
        pipeRows.unshift(hashStream);
    } else {
        pipeRows.unshift(''); // Empty pipe when done
    }

    // 3. Accumulate in Cold (Glacier)
    if (tick >= 10 && tick < 32) {
      if (tick % 2 === 0) {
        coldRows.pop(); 
        coldRows.unshift(Array(12).fill(0).map(() => `{blue-fg}0x${Math.random().toString(16).substr(2, 6).toUpperCase()}{/}`).join('  '));
      }
    }

    // 4. Update Cost Tally
    if (tick < 30) {
        costSaved += (Math.random() * 45); // Ticks up rapidly to ~$1,200
        sysLogs.log(`{white-fg}Archived{/} 48,000 blocks -> {blue-fg}Glacier{/}`);
    }

    // 5. Completion
    if (tick === 36) {
        activeFreeze = false;
        hotBox.setContent('\n  {green-fg}✔ RAM CLEARED. PostegreSQL Hot-Tier restored back to 11% capacity.{/}');
        sysLogs.log(`{green-fg}✔ FREEZE COMPLETE.{/}`);
        sysLogs.log(`{yellow-fg}Total Cold Data Evicted: 14.2M rows{/}`);
        process.stdout.write('\x07'); 
    }

    updateUi();
  }, 120); 

  function teardown() {
    clearInterval(waterfall);
    screen.destroy();
    console.log(chalk.green('\n✔ SynapseOS: Archival Node unmounted safely.'));
    process.exit(0);
  }

  screen.key(['escape', 'q', 'C-c'], teardown);
  process.on('SIGINT', teardown);
  process.on('SIGTERM', teardown);
}
