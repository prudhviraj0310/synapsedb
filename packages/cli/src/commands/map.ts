import chalk from 'chalk';
import blessed from 'blessed';
// @ts-ignore
import contrib from 'blessed-contrib';

// -----------------------------------------------------
// 🌍 SYNAPSE GLOBAL EDGE FABRIC
// -----------------------------------------------------
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function handleMap() {
  console.clear();
  console.log(chalk.cyan('⠋ Connecting to Synapse Global Edge Fabric...'));
  await sleep(600);

  const screen = blessed.screen({
    smartCSR: true,
    fullUnicode: true,
    title: 'SynapseDB Terminal OS - Global Fabric'
  });

  const grid = new contrib.grid({rows: 12, cols: 12, screen: screen});

  const mapBox = grid.set(0, 0, 10, 9, contrib.map, {
    label: ' 🌍 SYNAPSE GLOBAL EDGE FABRIC ',
    border: { type: 'line', fg: 'cyan' },
    style: { shapeColor: 'green' } 
  });

  const statusBox = grid.set(0, 9, 10, 3, blessed.box, {
    label: ' ⚡ REGION HEALTH ',
    border: { type: 'line', fg: 'cyan' },
    tags: true,
    padding: { top: 1, left: 1 }
  });

  const routingLogs = grid.set(10, 0, 2, 12, contrib.log, {
    label: ' ⚡ ACTIVE PACKET ROUTING LOGS ',
    fg: 'cyan',
    selectedFg: 'green',
    border: { type: 'line', fg: 'magenta' }
  });

  type Region = { name: string, lon: number, lat: number, color: string, offline?: boolean, latency: number };

  const regions: Region[] = [
    { name: 'US-EAST', lon: -74.00, lat: 40.71, color: 'cyan', latency: 4 },
    { name: 'US-WEST', lon: -122.41, lat: 37.77, color: 'magenta', latency: 12 },
    { name: 'EU-WEST', lon: -0.12, lat: 51.50, color: 'yellow', latency: 8 },
    { name: 'AP-SOUTH', lon: 72.87, lat: 19.07, color: 'green', latency: 18 }
  ];

  let pulseState = false;

  function updateStatusPanel() {
    let content = '';
    for (const r of regions) {
      if (r.offline) {
        content += `${r.name}\n{red-fg}✖ OFFLINE{/}\n\n`;
      } else {
        content += `${r.name}\n{green-fg}✔ ${r.latency}ms{/}\n\n`;
      }
    }
    statusBox.setContent(content);
    screen.render();
  }

  function drawStaticNodes(dimOverride = false, excludeNames: string[] = []) {
    for (const r of regions) {
      if (r.offline) {
        mapBox.addMarker({ lon: String(r.lon), lat: String(r.lat), color: 'red', char: '✖' });
      } else {
        // If dimmed, turn dark gray unless it is excluded from dimming
        const isActive = excludeNames.includes(r.name);
        const color = dimOverride && !isActive ? 'black' : r.color;
        const char = isActive ? '●' : (pulseState ? '●' : '◎');
        mapBox.addMarker({ lon: String(r.lon), lat: String(r.lat), color: color, char });
      }
    }
  }

  // The Heartbeat Idle Loop (Makes nodes breathe)
  setInterval(() => {
    pulseState = !pulseState;
    if (!incidentActive) {
       mapBox.clearMarkers();
       drawStaticNodes();
       screen.render();
    }
  }, 1000);

  updateStatusPanel();

  // Packet Interpolation Math
  async function animatePacket(src: Region, dest: Region, isFailure = false) {
    const steps = Math.abs(src.lon - dest.lon) > 100 ? 8 : 4; // Longer distance = more steps
    const packetDelay = isFailure ? 90 : 45; // Slower animation = visual latency drag
    
    for (let i = 1; i < steps; i++) {
        const lat = src.lat + ((dest.lat - src.lat) * (i / steps));
        const lon = src.lon + ((dest.lon - src.lon) * (i / steps));
        
        mapBox.clearMarkers();
        drawStaticNodes(isFailure, [src.name, dest.name]); // Dim others if failure
        
        // Highlight explicitly
        if (isFailure) {
          mapBox.addMarker({ lon: String(src.lon), lat: String(src.lat), color: 'red', char: '●' });
          mapBox.addMarker({ lon: String(dest.lon), lat: String(dest.lat), color: 'green', char: '◎' });
        }
        
        mapBox.addMarker({ lon: String(lon), lat: String(lat), color: 'white', char: '•' });
        screen.render();
        await sleep(packetDelay); 
    }

    // Impact / Arrival
    mapBox.clearMarkers();
    drawStaticNodes(isFailure, [dest.name]);
    mapBox.addMarker({ lon: String(dest.lon), lat: String(dest.lat), color: 'green', char: '⚡' });
    screen.render();
  }

  let tick = 0;
  let incidentActive = false;

  const loop = async () => {
    tick++;

    if (tick === 8) {
       routingLogs.log(`{yellow-fg}[SYSTEM]{/} Telemetry interference detected in EU-WEST backbone...`);
       screen.render();
    } 
    else if (tick === 10) {
       incidentActive = true;
       const euNode = regions.find(r => r.name === 'EU-WEST')!;
       const usNode = regions.find(r => r.name === 'US-EAST')!;
       
       euNode.offline = true;
       updateStatusPanel();
       process.stdout.write('\x07'); 
       
       routingLogs.log(`{red-bg}{white-fg} ⚠ EU-WEST DATACENTER FAILURE {/}`);
       mapBox.clearMarkers(); drawStaticNodes(true, ['EU-WEST', 'US-EAST']); screen.render();
       await sleep(400);
       
       routingLogs.log(`{yellow-fg}→ Synapse Engine:{/} Rerouting active Continental traffic (High Latency)...`);
       await animatePacket(euNode, usNode, true);
       
       routingLogs.log(`{green-fg}→ ✔ Traffic stabilized. Primary Edge shifted to US-EAST.{/}`);
       screen.render();
       
       setTimeout(() => { incidentActive = false; }, 800);
    }
    else if (!incidentActive) {
      const healthy = regions.filter(r => !r.offline);
      if (healthy.length < 2) return;
      
      const simulateEvent = async () => {
        const source = healthy[Math.floor(Math.random() * healthy.length)];
        let target = healthy[Math.floor(Math.random() * healthy.length)];
        
        if (source.name !== target.name && Math.random() > 0.5) {
          routingLogs.log(`{red-fg}Miss{/} in ${source.name}. Rerouting query to ${target.name} {yellow-fg}(124ms hop){/}`);
          await animatePacket(source, target);
        } else {
          target = source; 
          mapBox.clearMarkers();
          drawStaticNodes();
          mapBox.addMarker({ lon: String(target.lon), lat: String(target.lat), color: target.color, char: '⚡' });
          if (Math.random() > 0.6) {
             routingLogs.log(`{cyan-fg}Hit{/} at Edge: ${target.name} {magenta-fg}(${target.latency}ms){/}`);
          }
          screen.render();
        }

        // Stick the packet log for 700ms so the user can read it before clearing
        setTimeout(() => {
          if (!incidentActive) {
            mapBox.clearMarkers(); drawStaticNodes(); screen.render();
          }
        }, 700);
      };

      // Global Scale Array (Spawn 2 concurrent packets occasionally)
      if (Math.random() > 0.7) {
        Promise.all([simulateEvent(), simulateEvent()]);
      } else {
        simulateEvent();
      }
    }

    setTimeout(loop, 1200);
  };

  setTimeout(loop, 1000); 

  function teardown() {
    screen.destroy();
    console.log(chalk.green('\n✔ SynapseOS: Satellite Link disconnected.'));
    process.exit(0);
  }

  screen.key(['escape', 'q', 'C-c'], teardown);
  process.on('SIGINT', teardown);
  process.on('SIGTERM', teardown);
}
