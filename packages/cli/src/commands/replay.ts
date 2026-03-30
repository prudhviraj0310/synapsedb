import chalk from 'chalk';

// -----------------------------------------------------
// 🎬 INCIDENT REPLAY SYSTEM 
// -----------------------------------------------------
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function handleReplay(incident: string) {
  console.clear();

  if (!incident) {
    console.log(chalk.red('✖ Error: You must specify an incident string. (e.g. `synapse replay --incident ddos-114`)'));
    process.exit(1);
  }

  console.log(chalk.cyan(`⠋ Synchronizing SRE Incident Ledger for [${incident.toUpperCase()}]...`));
  await sleep(800);
  console.log(chalk.gray(`[SYSTEM] Accessing immutable event snapshot... `) + chalk.green('LOCKED'));
  await sleep(400);
  console.log(chalk.magenta(`⚡ Synapse Engine: Initializing Incident Playback Sequence...`));
  console.log('');
  await sleep(800);

  // THE NARRATIVE INCIDENT TIMELINE
  const events = [
    { t: '-12:00', msg: 'System Idle. Edge cache warming...' },
    { t: '-10:45', msg: chalk.yellow('Anomaly Detected: TCP SYN Flood inbound to port 5432') },
    { t: '-08:30', msg: chalk.yellow('Memory spike: Postgres connection pool reached 88% capacity') },
    { t: '-06:12', msg: chalk.red('CRITICAL: L7 DDoS Confirmed. Application routing degraded.') },
    { t: '-06:10', msg: chalk.magenta('Synapse Engine Activating Edge-Shield Ruleset') },
    { t: '-04:00', msg: chalk.cyan('Cloudflare WAF Sync: Banning Malicious IPs dynamically') },
    { t: '-02:15', msg: chalk.green('Synapse Read-Replicas absorbing remaining 14k/sec traffic load') },
    { t: '-00:00', msg: chalk.green('Incident Mitigated. Zero data loss. Zero full-downtime.') },
  ];

  // Animated Playback Slider 
  let slider = Array(40).fill('░');
  
  for (let i = 0; i <= 40; i++) {
    const progress = Math.floor((i / 40) * events.length);
    let event = events[progress];
    if (!event) event = events[events.length - 1]; // cap it

    // Draw progression slider
    let ui = `  [`;
    for (let j = 0; j < 40; j++) {
      if (j < i) ui += chalk.cyan('█');
      else ui += chalk.gray('░'); 
    }
    ui += `]`;

    const remainingText = ` T${event.t}  ${event.msg}`;
    
    process.stdout.write(`\r\x1b[K${ui} ${remainingText}`);
    
    // Pauses dramatically during critical logs
    let pause = 50 + Math.random() * 80;
    if (i % 5 === 0) pause = 600; 

    await sleep(pause); 
  }

  console.log(chalk.green(`\n\n✔ Incident [${incident.toUpperCase()}] full replay complete.\n`));
  
  // Output forensic data
  console.log(chalk.cyan(`  ● Forensic Vector: L7 Amplification Attack`));
  console.log(chalk.cyan(`  ● Max Ops/Sec Mitigated: 14,204`));
  console.log(chalk.cyan(`  ● Autonomous Response Time: 480ms`));
  console.log(chalk.gray(`\nReport archived to /var/log/synapse/incidents/${incident.toLowerCase()}.log\n`));

  process.exit(0);
}
