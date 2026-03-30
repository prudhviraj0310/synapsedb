// ──────────────────────────────────────────────────────────────
// Synapse Studio — Web Application
// Consumes real-time telemetry from the SynapseDB engine
// ──────────────────────────────────────────────────────────────

const elOps = document.getElementById('val-ops')!;
const elTotal = document.getElementById('val-total-ops')!;
const elError = document.getElementById('val-error-rate')!;
const elMem = document.getElementById('val-memory')!;
const statusDot = document.getElementById('status-dot')!;
const statusMsg = document.getElementById('status-msg')!;

function connect() {
  // Connect to the telemetry WebSocket exposed by the Synapse engine
  const wsUrl = `ws://localhost:9876/ws/telemetry`;
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    statusDot.className = 'status-indicator connected';
    statusMsg.innerText = 'Connected to Engine (localhost:9876)';
    console.log('[Synapse] Connected to telemetry feed');
  };

  ws.onmessage = (event) => {
    try {
      const frame = JSON.parse(event.data);
      if (frame.type === 'metrics' && frame.data) {
        updateDashboard(frame.data);
      }
    } catch (e) {
      console.error('[Synapse] Error parsing telemetry frame', e);
    }
  };

  ws.onclose = () => {
    statusDot.className = 'status-indicator disconnected';
    statusMsg.innerText = 'Disconnected (Retrying in 2s)';
    console.warn('[Synapse] Disconnected from engine. Retrying...');
    setTimeout(connect, 2000);
  };

  ws.onerror = () => {
    ws.close();
  };
}

function updateDashboard(metrics: any) {
  // Update UI with real metrics
  elOps.innerText = formatNumber(metrics.operationsPerSecond || 0);
  elTotal.innerText = formatNumber(metrics.totalOperations || 0);

  const errorRate = metrics.totalOperations > 0 
    ? (metrics.totalErrors / metrics.totalOperations) * 100 
    : 0;
  
  elError.innerText = errorRate.toFixed(1) + '%';
  elError.style.color = errorRate > 5 ? '#FF3B30' : 'inherit';

  // We don't have direct memory from systemMetrics(), but we can add logic to estimate or use performance.memory
  // For demo, we just parse the generic memory footprint from the client side or window
  const mem = (performance as any).memory;
  if (mem) {
    elMem.innerText = (mem.usedJSHeapSize / 1024 / 1024).toFixed(1) + ' MB';
  } else {
    elMem.innerText = 'N/A';
  }
}

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
  return Math.floor(num).toString();
}

// Boot
connect();
