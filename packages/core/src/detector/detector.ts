// ──────────────────────────────────────────────────────────────
// SynapseDB — Database Detector
// Auto-fingerprints connection URIs to determine database type
// and load the correct driver automatically.
// ──────────────────────────────────────────────────────────────

import type { StorageType, PluginConfig } from '../types.js';

/**
 * Detected database information from a connection URI.
 */
export interface DetectedDatabase {
  /** The type of storage backend */
  type: StorageType;

  /** The driver/plugin name to use */
  driver: string;

  /** The plugin package name */
  package: string;

  /** Extracted configuration from the URI */
  config: PluginConfig;

  /** Human-readable detection reason */
  reason: string;
}

/**
 * Known protocol-to-database mappings.
 */
const PROTOCOL_MAP: Record<string, { type: StorageType; driver: string; package: string }> = {
  'postgresql': { type: 'sql', driver: 'postgres', package: '@synapsedb/plugin-postgres' },
  'postgres':   { type: 'sql', driver: 'postgres', package: '@synapsedb/plugin-postgres' },
  'pg':         { type: 'sql', driver: 'postgres', package: '@synapsedb/plugin-postgres' },
  'mysql':      { type: 'sql', driver: 'mysql', package: '@synapsedb/plugin-mysql' },
  'mariadb':    { type: 'sql', driver: 'mysql', package: '@synapsedb/plugin-mysql' },
  'mongodb':    { type: 'nosql', driver: 'mongodb', package: '@synapsedb/plugin-mongodb' },
  'mongodb+srv':{ type: 'nosql', driver: 'mongodb', package: '@synapsedb/plugin-mongodb' },
  'redis':      { type: 'cache', driver: 'redis', package: '@synapsedb/plugin-redis' },
  'rediss':     { type: 'cache', driver: 'redis', package: '@synapsedb/plugin-redis' },
  'pinecone':   { type: 'vector', driver: 'pinecone', package: '@synapsedb/plugin-pinecone' },
  'milvus':     { type: 'vector', driver: 'milvus', package: '@synapsedb/plugin-milvus' },
};

/**
 * Default port-to-database mappings (fallback heuristic).
 */
const PORT_MAP: Record<number, { type: StorageType; driver: string; package: string }> = {
  5432:  { type: 'sql', driver: 'postgres', package: '@synapsedb/plugin-postgres' },
  5433:  { type: 'sql', driver: 'postgres', package: '@synapsedb/plugin-postgres' },
  3306:  { type: 'sql', driver: 'mysql', package: '@synapsedb/plugin-mysql' },
  27017: { type: 'nosql', driver: 'mongodb', package: '@synapsedb/plugin-mongodb' },
  27018: { type: 'nosql', driver: 'mongodb', package: '@synapsedb/plugin-mongodb' },
  6379:  { type: 'cache', driver: 'redis', package: '@synapsedb/plugin-redis' },
  6380:  { type: 'cache', driver: 'redis', package: '@synapsedb/plugin-redis' },
};

/**
 * Detect the database type and extract configuration from a connection URI.
 *
 * Supports:
 * - `postgresql://user:pass@host:5432/db`
 * - `mongodb://host:27017/db`
 * - `mongodb+srv://user:pass@cluster.example.com/db`
 * - `redis://host:6379`
 * - `mysql://user:pass@host:3306/db`
 *
 * Falls back to port heuristics if protocol is ambiguous.
 *
 * @example
 * ```typescript
 * const result = detectDatabase('postgresql://admin:secret@db.example.com:5432/myapp');
 * // → { type: 'sql', driver: 'postgres', package: '@synapsedb/plugin-postgres', config: { ... } }
 * ```
 */
export function detectDatabase(uri: string): DetectedDatabase {
  // Parse the URI
  const parsed = parseConnectionURI(uri);

  // 1. Try protocol-based detection
  const protocolMatch = PROTOCOL_MAP[parsed.protocol];
  if (protocolMatch) {
    return {
      ...protocolMatch,
      config: buildConfig(parsed),
      reason: `Protocol "${parsed.protocol}" → ${protocolMatch.driver}`,
    };
  }

  // 2. Try port-based detection (heuristic fallback)
  if (parsed.port) {
    const portMatch = PORT_MAP[parsed.port];
    if (portMatch) {
      return {
        ...portMatch,
        config: { ...buildConfig(parsed), connectionUri: uri },
        reason: `Port ${parsed.port} → ${portMatch.driver} (heuristic)`,
      };
    }
  }

  throw new Error(
    `Cannot detect database type from URI: "${uri}". ` +
    `Supported protocols: ${Object.keys(PROTOCOL_MAP).join(', ')}`,
  );
}

/**
 * Detect multiple databases from an array of URIs.
 * Returns a map of driver name → DetectedDatabase.
 */
export function detectDatabases(uris: string[]): Map<string, DetectedDatabase> {
  const results = new Map<string, DetectedDatabase>();

  for (const uri of uris) {
    const detected = detectDatabase(uri);
    const key = detected.driver;

    // If we already have this driver, use a numbered suffix
    if (results.has(key)) {
      let i = 2;
      while (results.has(`${key}_${i}`)) i++;
      results.set(`${key}_${i}`, detected);
    } else {
      results.set(key, detected);
    }
  }

  return results;
}

// ─── Internal Helpers ──────────────────────────────────────────

interface ParsedURI {
  protocol: string;
  username?: string;
  password?: string;
  host: string;
  port?: number;
  database?: string;
  params: Record<string, string>;
  raw: string;
}

function parseConnectionURI(uri: string): ParsedURI {
  const raw = uri;

  // Extract protocol
  const protocolMatch = uri.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/{2}/);
  if (!protocolMatch) {
    throw new Error(`Invalid connection URI format: "${uri}"`);
  }

  const protocol = protocolMatch[1]!.toLowerCase();
  let remainder = uri.slice(protocolMatch[0].length);

  // Extract query params
  const params: Record<string, string> = {};
  const qIndex = remainder.indexOf('?');
  if (qIndex !== -1) {
    const queryString = remainder.slice(qIndex + 1);
    remainder = remainder.slice(0, qIndex);
    for (const pair of queryString.split('&')) {
      const [k, v] = pair.split('=');
      if (k) params[k] = v ?? '';
    }
  }

  // Extract auth (user:pass@)
  let username: string | undefined;
  let password: string | undefined;
  const atIndex = remainder.lastIndexOf('@');
  if (atIndex !== -1) {
    const auth = remainder.slice(0, atIndex);
    remainder = remainder.slice(atIndex + 1);
    const colonIndex = auth.indexOf(':');
    if (colonIndex !== -1) {
      username = decodeURIComponent(auth.slice(0, colonIndex));
      password = decodeURIComponent(auth.slice(colonIndex + 1));
    } else {
      username = decodeURIComponent(auth);
    }
  }

  // Extract host:port/database
  const pathIndex = remainder.indexOf('/');
  let hostPart: string;
  let database: string | undefined;

  if (pathIndex !== -1) {
    hostPart = remainder.slice(0, pathIndex);
    database = remainder.slice(pathIndex + 1) || undefined;
  } else {
    hostPart = remainder;
  }

  let host = hostPart;
  let port: number | undefined;
  const portMatch = hostPart.match(/:(\d+)$/);
  if (portMatch) {
    host = hostPart.slice(0, -portMatch[0].length);
    port = parseInt(portMatch[1]!, 10);
  }

  return { protocol, username, password, host, port, database, params, raw };
}

function buildConfig(parsed: ParsedURI): PluginConfig {
  return {
    connectionUri: parsed.raw,
    host: parsed.host,
    port: parsed.port,
    database: parsed.database,
    username: parsed.username,
    password: parsed.password,
  };
}
