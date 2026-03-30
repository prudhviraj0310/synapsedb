import chalk from 'chalk';
import blessed from 'blessed';
// @ts-ignore
import contrib from 'blessed-contrib';

// -----------------------------------------------------
// 🛡️ SYNAPSE GUARD (WEB APPLICATION FIREWALL)
// -----------------------------------------------------
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function handleGuard() {
  console.clear();
  console.log(chalk.cyan('⠋ Hooking into pg_stat_activity connection stream...'));
  await sleep(600);
  console.log(chalk.green('✔ Initializing Synapse WAF Packet Inspector'));
  await sleep(400);

  const screen = blessed.screen({ smartCSR: true, fullUnicode: true, title: 'SynapseDB Guard Firewall' });
  const grid = new contrib.grid({rows: 12, cols: 12, screen: screen});

  // 1. LEFT PANE (LIVE SQL STREAM)
  const sqlStream = grid.set(0, 0, 12, 6, contrib.log, {
    label: ' ⚡ LIVE AST SQL INGESTION ', fg: 'green',
    border: { type: 'line', fg: 'cyan' }, bufferLength: 100
  });

  // 2. MIDDLE PANE (WAF ENGINE)
  const wafStatus = grid.set(0, 6, 4, 6, blessed.box, {
    label: ' 🛡️ WAF ENGINE ', fg: 'white',
    border: { type: 'line', fg: 'magenta' }, tags: true,
    content: '\n  {green-bg}{black-fg} STATUS: ACTIVE & SECURE {/}\n\n  Scanning 1,420 queries/sec\n  Threats blocked: 0\n  Ruleset: OWASP Core + Synapse AI'
  });

  // 3. BOTTOM RIGHT PANE (QUARANTINE)
  const quarantineLog = grid.set(4, 6, 8, 6, contrib.log, {
    label: ' ☠️ THREAT QUARANTINE ZONE ', fg: 'red', selectedFg: 'white',
    border: { type: 'line', fg: 'red' }, bufferLength: 50
  });

  // BACKGROUND SQL GENERATOR
  const goodQueries = [
    'SELECT id, username, email FROM users WHERE active=1;',
    'UPDATE sessions SET updated_at = NOW() WHERE token = ?;',
    'SELECT COUNT(*) FROM feed_posts WHERE user_id = ?;',
    'INSERT INTO logs (level, message) VALUES (?, ?);',
    'SELECT avatar_url FROM profiles WHERE user_id = ?;'
  ];

  const badQueries = [
    'SELECT * FROM users WHERE email=' + "''" + ' OR 1=1;--',
    'DROP TABLE users CASCADE;',
    'UNION SELECT username, password FROM admin_users--',
    '; EXEC xp_cmdshell(' + "'whoami'" + ');',
    'DELETE FROM orders WHERE 1=1;'
  ];

  const ips = ['192.168.1.14', '10.0.0.98', '172.16.0.4', '45.22.19.1', '104.28.3.111'];

  let threatsBlocked = 0;

  const telemetryLoop = setInterval(() => {
    // Generate valid traffic fast
    const q = goodQueries[Math.floor(Math.random() * goodQueries.length)];
    const ip = ips[Math.floor(Math.random() * ips.length)];
    sqlStream.log(`{gray-fg}[${ip}]{/} {green-fg}${q}{/}`);
    screen.render();

    // Generate Malicious SQL sometimes (10% chance per tick)
    if (Math.random() > 0.9) {
      const badQ = badQueries[Math.floor(Math.random() * badQueries.length)];
      const badIp = '185.11.' + Math.floor(Math.random() * 255) + '.' + Math.floor(Math.random() * 255);
      
      // Flash red on the stream
      sqlStream.log(`{red-bg}{white-fg} ⚠ MALICIOUS AST DETECTED: ${badIp} {/}`);
      sqlStream.log(`{red-fg}${badQ}{/}`);
      
      // Quarantine it
      threatsBlocked++;
      process.stdout.write('\x07'); // alarm
      quarantineLog.log(`{white-bg}{red-fg}BLOCKED{/} [${badIp}] SQli Signature Matched`);
      quarantineLog.log(`{yellow-fg}> ${badQ}{/}`);
      quarantineLog.log(`{gray-fg}-----------------------------{/}`);

      // Update WAF Status
      wafStatus.setContent(`\n  {red-bg}{white-fg} ⚠ THREAT INTERCEPTED {/}\n\n  Scanning 1,420 queries/sec\n  Threats blocked: {red-fg}${threatsBlocked}{/}\n  Ruleset: OWASP Core + Synapse AI\n  {cyan-fg}Cloudflare IP Ban: Executing...{/}`);
      
      setTimeout(() => {
        wafStatus.setContent(`\n  {green-bg}{black-fg} STATUS: ACTIVE & SECURE {/}\n\n  Scanning 1,420 queries/sec\n  Threats blocked: {red-fg}${threatsBlocked}{/}\n  Ruleset: OWASP Core + Synapse AI\n  {green-fg}Cloudflare IP Ban: Propagated.{/}`);
        screen.render();
      }, 700);
    }

  }, 100);

  screen.key(['escape', 'q', 'C-c'], () => {
    clearInterval(telemetryLoop);
    screen.destroy();
    console.log(chalk.green('\n✔ SynapseOS: Firewall telemetry disconnected.'));
    process.exit(0);
  });
}
