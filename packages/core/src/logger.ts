// ──────────────────────────────────────────────────────────────
// SynapseDB — Logger
// Structured logging with level filtering and colored output.
// ──────────────────────────────────────────────────────────────

import type { Logger } from './types.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const COLORS = {
  debug: '\x1b[36m',  // Cyan
  info: '\x1b[32m',   // Green
  warn: '\x1b[33m',   // Yellow
  error: '\x1b[31m',  // Red
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

/**
 * Create a structured logger with a specific context prefix.
 */
export function createLogger(context: string, level: LogLevel = 'info'): Logger {
  const minLevel = LOG_LEVELS[level];
  const prefix = `${COLORS.dim}[SynapseDB]${COLORS.reset} ${COLORS.bold}${context}${COLORS.reset}`;

  function log(msgLevel: LogLevel, message: string, ...args: unknown[]): void {
    if (LOG_LEVELS[msgLevel] < minLevel) {
      return;
    }

    const color = COLORS[msgLevel];
    const timestamp = new Date().toISOString().slice(11, 23);
    const levelTag = `${color}${msgLevel.toUpperCase().padEnd(5)}${COLORS.reset}`;
    const formatted = `${COLORS.dim}${timestamp}${COLORS.reset} ${levelTag} ${prefix} ${message}`;

    if (msgLevel === 'error') {
      console.error(formatted, ...args);
    } else if (msgLevel === 'warn') {
      console.warn(formatted, ...args);
    } else {
      console.log(formatted, ...args);
    }
  }

  return {
    debug: (message: string, ...args: unknown[]) => log('debug', message, ...args),
    info: (message: string, ...args: unknown[]) => log('info', message, ...args),
    warn: (message: string, ...args: unknown[]) => log('warn', message, ...args),
    error: (message: string, ...args: unknown[]) => log('error', message, ...args),
  };
}
