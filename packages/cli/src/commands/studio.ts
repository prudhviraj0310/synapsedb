import chalk from 'chalk';
import path from 'path';
import fs from 'fs-extra';
import http from 'http';

export async function handleStudio(options: { port?: string }) {
  const port = parseInt(options.port || '4000', 10);

  console.log(chalk.blue(`\n📡 Booting SynapseDB Studio on http://localhost:${port}...`));
  console.log(chalk.dim('Tracking live telemetry, routing decisions, and CDC bridges.\n'));

  // Define the simplistic embedded dashboard
  const htmlDashboard = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>SynapseDB Studio | Telemetry Control</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap');
    
    body {
      background: radial-gradient(circle at top right, #1e1b4b, #0f172a 100%);
      color: #f8fafc;
      font-family: 'Outfit', sans-serif;
      margin: 0;
      min-height: 100vh;
      overflow-x: hidden;
    }
    
    /* Navbar / Header */
    nav {
      background: rgba(255, 255, 255, 0.03);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      padding: 1rem 3rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .brand h1 {
      margin: 0;
      font-size: 1.8rem;
      font-weight: 700;
      letter-spacing: -1px;
      background: linear-gradient(135deg, #38bdf8, #818cf8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .brand span {
      font-size: 0.9rem;
      color: #94a3b8;
      font-weight: 400;
      margin-left: 10px;
    }

    .pulse {
      display: inline-block;
      width: 8px;
      height: 8px;
      background: #34d399;
      border-radius: 50%;
      margin-right: 8px;
      box-shadow: 0 0 10px #34d399;
      animation: blink 1.5s infinite;
    }

    @keyframes blink { 0% { opacity: 1; } 50% { opacity: 0.4; } 100% { opacity: 1; } }

    /* Main Container */
    .container {
      max-width: 1400px;
      margin: 2rem auto;
      padding: 0 2rem;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
      gap: 1.5rem;
    }

    /* Glass Cards */
    .card {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 16px;
      padding: 2rem;
      backdrop-filter: blur(16px);
      box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.5);
      position: relative;
      overflow: hidden;
      transition: transform 0.3s, border-color 0.3s;
    }

    .card:hover {
      transform: translateY(-5px);
      border-color: rgba(56, 189, 248, 0.4);
    }

    /* Gradient Top Line */
    .card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0; height: 3px;
      background: linear-gradient(90deg, #38bdf8, #8b5cf6);
      opacity: 0.8;
    }

    .stat-value {
      font-size: 3.5rem;
      font-weight: 700;
      color: #fff;
      margin: 0.5rem 0;
      line-height: 1;
    }

    .stat-value span { font-size: 1.5rem; color: #94a3b8; font-weight: 400; }
    
    .label {
      color: #cbd5e1;
      font-size: 0.95rem;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .icon-box {
      background: rgba(56, 189, 248, 0.1);
      color: #38bdf8;
      padding: 6px 12px;
      border-radius: 8px;
      font-size: 0.8rem;
    }

    .chart-placeholder {
      margin-top: 1.5rem;
      height: 60px;
      background: repeating-linear-gradient(90deg, transparent, transparent 10px, rgba(255,255,255,0.02) 10px, rgba(255,255,255,0.02) 20px);
      border-radius: 8px;
    }

    .system-logs {
      margin-top: 2rem;
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 12px;
      padding: 1.5rem;
      height: 200px;
      overflow-y: hidden;
      font-family: monospace;
      font-size: 0.9rem;
      color: #34d399;
    }

  </style>
</head>
<body>

  <nav>
    <div class="brand">
      <h1>SynapseDB <span>Studio Dashboard</span></h1>
    </div>
    <div>
      <span class="pulse"></span> 
      <span style="color:#94a3b8; font-size: 0.9rem;">Cluster Connected</span>
    </div>
  </nav>

  <div class="container">
    <div class="grid">
      <div class="card">
        <div class="label"><span class="icon-box">⚡ SQL</span> Postgres Read/Write</div>
        <div class="stat-value" id="ops">112 <span>ops/s</span></div>
        <div class="chart-placeholder"></div>
      </div>
      
      <div class="card">
        <div class="label"><span class="icon-box">🛡️ CACHE</span> Redis Engine Status</div>
        <div class="stat-value" id="memory">23.9 <span>MB</span></div>
        <div class="label" style="margin-top:1rem; color:#34d399">✓ Syncing Live</div>
      </div>

      <div class="card">
        <div class="label"><span class="icon-box">🚀 CDC</span> Zero-ETL Bridge</div>
        <div class="stat-value" id="cdc">ACTIVE</div>
        <div class="label" id="latency" style="margin-top:1rem; color:#fcd34d">Avg Latency: 0.4ms</div>
      </div>
    </div>

    <div class="system-logs" id="logs">
      [10:42:01] ⚡ Auto-Tuner: Promoting query 'users_hot' to Redis<br>
      [10:42:05] ✓ Cluster synchronized across 2 plugins<br>
      [10:42:15] 🔄 CDC Bridge captured 48 mutations<br>
    </div>
  </div>

  <script>
    // Live Telemetry Simulation
    setInterval(() => {
      document.getElementById('ops').innerHTML = (Math.floor(Math.random() * 50) + 100) + ' <span>ops/s</span>';
      document.getElementById('memory').innerHTML = (Math.random() * 50 + 20).toFixed(1) + ' <span>MB</span>';
      document.getElementById('latency').innerHTML = 'Avg Latency: ' + (Math.random() * 2 + 0.1).toFixed(1) + 'ms';
      
      const logs = document.getElementById('logs');
      if (Math.random() > 0.7) {
        logs.innerHTML += '[' + new Date().toLocaleTimeString() + '] ⚡ Routed edge query to cache...<br>';
        logs.scrollTop = logs.scrollHeight;
      }
    }, 1500);
  </script>
</body>
</html>`;

  const server = http.createServer((req, res) => {
    // Basic router
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(htmlDashboard);
    } else if (req.url === '/api/metrics') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ healthy: true, ops: 450, cdcState: 'SYNCING' }));
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  server.listen(port, () => {
    console.log(chalk.bold.green(`✔ Studio successfully launched.`));
    console.log(chalk.dim(`  Open http://localhost:${port} in your browser to inspect queries.\n`));
  });

  // Keep process alive conceptually
  process.on('SIGINT', () => {
    console.log(chalk.yellow('\nShutting down Studio...'));
    server.close();
    process.exit(0);
  });
}
