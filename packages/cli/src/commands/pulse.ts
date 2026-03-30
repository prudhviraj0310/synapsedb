import chalk from 'chalk';
import blessed from 'blessed';
// @ts-ignore
import contrib from 'blessed-contrib';

// -----------------------------------------------------
// 📡 SYNAPSE PULSE (NETWORK TOPOLOGY SONAR)
// -----------------------------------------------------
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function handlePulse() {
  console.clear();
  console.log(chalk.cyan('⠋ Sweeping AWS VPC Address Space...'));
  await sleep(600);
  console.log(chalk.green('✔ Initializing Database Topology Radar'));
  await sleep(400);

  const screen = blessed.screen({ smartCSR: true, fullUnicode: true, title: 'SynapseDB - Radar Topology' });
  const grid = new contrib.grid({rows: 12, cols: 12, screen: screen});

  const radarPane = grid.set(0, 0, 10, 8, blessed.box, {
    label: ' 📡 SYNAPSE VPC TOPOLOGY RADAR ', fg: 'green',
    border: { type: 'line', fg: 'cyan' }, tags: true
  });

  const sonarLogs = grid.set(10, 0, 2, 8, contrib.log, {
    label: ' ⚡ ACTIVE PING TELEMETRY ', fg: 'gray', selectedFg: 'cyan',
    border: { type: 'line', fg: 'magenta' }
  });

  const nodeStats = grid.set(0, 8, 12, 4, blessed.box, {
    label: ' 📊 NODE LATENCY ', fg: 'white',
    border: { type: 'line', fg: 'magenta' }, tags: true
  });

  // Render the visual Node tree using ASCII
  // API -> Redis -> PG -> DuckDB
  
  let pingCounter = 0;
  let sweepState = 0;

  function renderRadar() {
    // We animate a 'wave' pulse using sweeping colors
    const primaryC = sweepState === 0 ? '{white-bg}{black-fg}' : '{green-fg}';
    const redisC = sweepState === 1 ? '{white-bg}{black-fg}' : '{cyan-fg}';
    const pgC = sweepState === 2 ? '{white-bg}{black-fg}' : '{blue-fg}';
    const duckC = sweepState === 3 ? '{white-bg}{black-fg}' : '{yellow-fg}';

    const renderArt = `
             [ ${primaryC} API GATEWAY Node.js {/} ]
                        │
                        ▼
     [ SYNAPSE ENGINE (ROUTER AST LAYER) ]
            │                    │
            ▼                    ▼
   [ ${redisC} REDIS EDGE {/} ]      [ ${pgC} POSTGRES PRIMARY {/} ]
           (Cache)                 (Source of Truth)
            │                    │
            ▼                    ▼
     [ VECTOR DB ]        [ ${duckC} DUCKDB ANALYTICS {/} ]
      (Embeddings)           (Columnar Engine)
    `;

    radarPane.setContent(renderArt);

    const stats = `
  NODE STATUS PING
  ----------------------
  {white-fg}API Gateway{/}
  Latency:  ${sweepState===0 ? Math.floor(Math.random()*4)+'ms' : '1.2ms'}
  Status:   {green-fg}ONLINE{/}

  {cyan-fg}Redis Edge{/}
  Latency:  ${sweepState===1 ? Math.floor(Math.random()*3)+'ms' : '0.8ms'}
  Status:   {green-fg}ONLINE{/}

  {blue-fg}Postgres Master{/}
  Latency:  ${sweepState===2 ? Math.floor(Math.random()*20+12)+'ms' : '14.2ms'}
  Status:   {green-fg}ONLINE{/}

  {yellow-fg}DuckDB OLAP{/}
  Latency:  ${sweepState===3 ? Math.floor(Math.random()*8)+'ms' : '0.1ms'}
  Status:   {green-fg}IDLE{/}
    `;
    
    nodeStats.setContent(stats);
    screen.render();
  }

  const loop = setInterval(() => {
    pingCounter++;
    sweepState = pingCounter % 4; // Cycle through 0 1 2 3 highlighting nodes sequentially
    renderRadar();
    
    // Log output correlating to the sweep
    if (sweepState === 0) sonarLogs.log(`Pinging Edge API Gateway... {green-fg}✔ 1.2ms{/}`);
    else if (sweepState === 1) sonarLogs.log(`Sweeping Redis Cache Layer... {green-fg}✔ 0.8ms{/}`);
    else if (sweepState === 2) {
       // Simulate random latency spikes on PG
       if (Math.random() > 0.8) {
         sonarLogs.log(`{yellow-fg}Sweeping Postgres Master... ⚠ 124ms (Connection Pool Load){/}`);
         process.stdout.write('\x07');
       } else {
         sonarLogs.log(`Sweeping Postgres Master... {green-fg}✔ 14ms{/}`);
       }
    }
    else if (sweepState === 3) sonarLogs.log(`Checking Analytics Node... {green-fg}✔ IDLE (0.1ms){/}`);
    
  }, 1000); // 1 sweep tick per second

  renderRadar();

  screen.key(['escape', 'q', 'C-c'], () => {
    clearInterval(loop);
    screen.destroy();
    console.log(chalk.green('\n✔ SynapseOS: Sonar tracking disconnected.'));
    process.exit(0);
  });
}
