// ──────────────────────────────────────────────────────────────
// SynapseDB — Telemetry WebSocket Bridge
// Real-time metric streaming from Engine → CLI / Studio
// ──────────────────────────────────────────────────────────────

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { SynapseEngine } from '../engine.js';
import { createLogger } from '../logger.js';

const logger = createLogger('Telemetry');

export interface TelemetryFrame {
  type: 'metrics' | 'event' | 'health';
  timestamp: number;
  data: unknown;
}

/**
 * TelemetryBridge — WebSocket Server
 * 
 * Attaches to the existing HTTP server and broadcasts
 * engine metrics every 500ms to all connected clients.
 * 
 * Clients (CLI, Studio) connect to ws://host:port/ws/telemetry
 */
export class TelemetryBridge {
  private wss: WebSocketServer | null = null;
  private broadcastInterval: ReturnType<typeof setInterval> | null = null;
  private engine: SynapseEngine;

  constructor(engine: SynapseEngine) {
    this.engine = engine;
  }

  /**
   * Attach to an existing HTTP server.
   */
  attach(server: Server): void {
    this.wss = new WebSocketServer({ server, path: '/ws/telemetry' });

    this.wss.on('connection', (ws: WebSocket) => {
      logger.info('Telemetry client connected');

      ws.on('close', () => {
        logger.info('Telemetry client disconnected');
      });

      ws.on('error', (err) => {
        logger.error(`WebSocket error: ${err.message}`);
      });

      // Send an initial snapshot immediately
      const frame: TelemetryFrame = {
        type: 'metrics',
        timestamp: Date.now(),
        data: this.engine.systemMetrics(),
      };
      ws.send(JSON.stringify(frame));
    });

    // Broadcast metrics to all clients every 500ms
    this.broadcastInterval = setInterval(() => {
      if (!this.wss || this.wss.clients.size === 0) return;

      const frame: TelemetryFrame = {
        type: 'metrics',
        timestamp: Date.now(),
        data: this.engine.systemMetrics(),
      };
      const payload = JSON.stringify(frame);

      for (const client of this.wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      }
    }, 500);

    logger.info('Telemetry WebSocket bridge active on /ws/telemetry');
  }

  /**
   * Broadcast a custom event (e.g., CDC change, incident alert).
   */
  broadcast(event: TelemetryFrame): void {
    if (!this.wss) return;
    const payload = JSON.stringify(event);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  /**
   * Shut down the telemetry bridge.
   */
  shutdown(): void {
    if (this.broadcastInterval) clearInterval(this.broadcastInterval);
    if (this.wss) this.wss.close();
    logger.info('Telemetry bridge shut down');
  }
}
