import chalk from 'chalk';
import blessed from 'blessed';
// @ts-ignore
import contrib from 'blessed-contrib';
import http from 'http';

// -----------------------------------------------------
// 🗣️ SYNAPSE AI WHISPERER (THE COMMAND LINE COPILOT)
// -----------------------------------------------------
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Attempt to stream a response from a local Ollama instance.
 * Returns null if Ollama is not running (graceful fallback).
 */
async function queryOllama(prompt: string): Promise<string | null> {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      model: 'llama3',
      prompt: `You are Synapse AI, a database telemetry expert embedded inside SynapseDB — a polyglot data engine routing queries across PostgreSQL, Redis, MongoDB, and Vector DBs. Answer concisely and technically.\n\nUser: ${prompt}`,
      stream: false,
    });

    const req = http.request(
      { hostname: '127.0.0.1', port: 11434, path: '/api/generate', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: 10000 },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json.response || null);
          } catch { resolve(null); }
        });
      }
    );

    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(payload);
    req.end();
  });
}

/**
 * Fallback simulated AI response when Ollama is not available.
 */
function simulatedResponse(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('slow') || lower.includes('spike')) {
    return "I traced the latency spike to an N+1 query fetching `user.avatars` without a Cache wrapper. Append `.cache(ttl: 30)` to your ORM call on line 42 of `/controllers/auth.ts` to route this to the Redis Edge. This will drop your latency by 280ms instantly.";
  } else if (lower.includes('memory') || lower.includes('oom')) {
    return "Postgres connection pools are saturated at 92%. I recommend executing the `synapse freeze` protocol to vacuum out 14M rows of cold data into S3 Glacier. This will restore normal memory parameters.";
  } else if (lower.includes('ddos') || lower.includes('attack')) {
    return "L7 Attack Traffic detected from 4 distinct IPs. Run `synapse play ddos` to practice this mitigation. The Synapse Engine automatically routes malicious packets to Cloudflare WAF layers during production spikes.";
  }
  return `I've analyzed the raw AST vector for "${text}". There are no critical schema anomalies executing on the current Postgres primary node. The system is operating at 99.9% cache efficiency. Next question?`;
}

export async function handleChat() {
  console.clear();
  console.log(chalk.cyan('⠋ Booting Local AI Protocol...'));
  await sleep(600);

  // Detect Ollama
  let ollamaAvailable = false;
  const testResponse = await queryOllama('ping');
  if (testResponse !== null) {
    ollamaAvailable = true;
    console.log(chalk.green('✔ Connected to Ollama LLM (llama3) — LIVE AI Mode'));
  } else {
    console.log(chalk.yellow('⚠ Ollama not detected. Using simulated AI (run `ollama serve` for real AI).'));
  }
  await sleep(400);

  const screen = blessed.screen({ smartCSR: true, fullUnicode: true, title: 'Synapse AI Whisperer' });
  const grid = new contrib.grid({rows: 12, cols: 12, screen: screen});

  const telemetryStream = grid.set(0, 0, 12, 5, contrib.log, {
    label: ' ⚡ LIVE TELEMETRY STREAM ', fg: 'gray', selectedFg: 'cyan', 
    border: { type: 'line', fg: 'magenta' }, bufferLength: 100
  });

  const aiConsole = grid.set(0, 5, 10, 7, blessed.box, {
    label: ollamaAvailable ? ' 🧠 SYNAPSE AI (LIVE — Ollama) ' : ' 🧠 SYNAPSE AI DIAGNOSTICS ',
    fg: 'green', border: { type: 'line', fg: 'cyan' }, content: '', tags: true, scrollable: true
  });

  const promptBox = grid.set(10, 5, 2, 7, blessed.textbox, {
    label: ' ASK SYNAPSE (Type & press Enter) ', border: { type: 'line', fg: 'yellow' },
    fg: 'white', bg: 'black', inputOnFocus: true
  });

  let isAnalyzing = false;
  let chatHistory = ollamaAvailable
    ? `{green-fg}Synapse AI is online. Connected to Ollama LLM (llama3).{/}\n{gray-fg}Ask me anything about your database infrastructure.{/}\n\n`
    : `{green-fg}Synapse AI is online. I am hooked directly into your routing AST.{/}\n{gray-fg}Monitoring 1,420 queries/second... What would you like to debug?{/}\n\n`;

  aiConsole.setContent(chatHistory);

  const routes = ['/auth', '/users', '/feed/videos', '/feed/images', '/payment/webhook'];
  const telemetryLoop = setInterval(() => {
    if (isAnalyzing) return; 
    const route = routes[Math.floor(Math.random() * routes.length)];
    const ms = Math.floor(Math.random() * 800) + 12;
    if (Math.random() > 0.8) {
      telemetryStream.log(`{red-fg}[${new Date().toLocaleTimeString()}] Postgres Miss | ${route} | ${ms}ms{/}`);
    } else {
      telemetryStream.log(`{cyan-fg}[${new Date().toLocaleTimeString()}] Redis Hit | ${route} | 1.2ms{/}`);
    }
    screen.render();
  }, 250);

  screen.render();
  promptBox.focus();

  promptBox.on('submit', async (text: string) => {
    if (!text || text.trim() === '') {
       promptBox.clearValue(); promptBox.focus(); return;
    }
    
    chatHistory += `{white-fg}[You]: ${text}{/}\n`;
    aiConsole.setContent(chatHistory);
    promptBox.clearValue();
    screen.render();

    isAnalyzing = true; 
    
    chatHistory += `{yellow-fg}[Synapse AI is analyzing...]{/}\n`;
    aiConsole.setContent(chatHistory);
    screen.render();

    let responseText: string;

    if (ollamaAvailable) {
      // Real LLM call
      const llmResponse = await queryOllama(text);
      responseText = llmResponse || simulatedResponse(text);
    } else {
      // Simulated delay + fallback
      await sleep(2000);
      responseText = simulatedResponse(text);
    }

    chatHistory = chatHistory.replace('{yellow-fg}[Synapse AI is analyzing...]{/}\n', '');
    chatHistory += `{green-fg}[Synapse AI]: `;
    
    const words = responseText.split(' ');
    for (let word of words) {
        chatHistory += word + ' ';
        aiConsole.setContent(chatHistory);
        screen.render();
        await sleep(ollamaAvailable ? 15 : 30 + Math.random() * 40); 
    }
    
    chatHistory += `{/}\n{gray-fg}---------------------------------{/}\n`;
    aiConsole.setContent(chatHistory);
    
    if (chatHistory.length > 5000) {
        chatHistory = chatHistory.slice(-5000);
    }
    
    isAnalyzing = false;
    promptBox.focus();
  });

  screen.on('resize', () => screen.render());

  screen.key(['escape', 'C-c'], () => {
    clearInterval(telemetryLoop);
    screen.destroy();
    console.log(chalk.green('\n✔ SynapseOS: AI Whisperer terminated.'));
    process.exit(0);
  });
}
