// ──────────────────────────────────────────────────────────────
// SynapseDB — Natural Language Query (NLQ) Engine
// Converts human language questions into SynapseDB Query ASTs.
// ──────────────────────────────────────────────────────────────

import type { QueryAST, CollectionManifest, Logger } from '../types.js';
import { buildQueryAST } from '../compiler/index.js';

/**
 * Result of parsing a natural language query.
 */
export interface NLQResult {
  /** The original question */
  question: string;
  /** Detected collection name */
  collection: string;
  /** Generated SynapseDB query */
  query: Record<string, unknown>;
  /** Generated options (sort, limit, etc.) */
  options: {
    projection?: string[];
    sort?: Record<string, number>;
    limit?: number;
    offset?: number;
  };
  /** The operation type detected */
  operation: 'find' | 'findOne' | 'search' | 'count' | 'aggregate';
  /** Confidence score (0.0 - 1.0) */
  confidence: number;
  /** Explanation of how the query was interpreted */
  explanation: string;
  /** The compiled AST */
  ast: QueryAST;
}

/**
 * Pattern matcher rule for NLQ parsing.
 */
interface ParseRule {
  patterns: RegExp[];
  extract: (match: RegExpMatchArray, manifests: Map<string, CollectionManifest>) => Partial<NLQResult> | null;
}

/**
 * NaturalLanguageQuery — GenAI Query Interface
 *
 * Provides a `db.ask("...")` style API that converts natural
 * language questions into SynapseDB Query ASTs.
 *
 * This is a rule-based parser (no external AI API required).
 * It handles common query patterns:
 *
 * - "Find all users where email is alice@test.com"
 * - "Show me products cheaper than $50 sorted by price"
 * - "Search users for 'distributed systems'"
 * - "How many products are in stock?"
 * - "Get the latest 5 users"
 *
 * For production, this can be extended with an LLM adapter
 * that sends the question + manifest schema to GPT-4/Claude
 * for more sophisticated parsing.
 */
export class NaturalLanguageQuery {
  private manifests: Map<string, CollectionManifest>;
  private logger: Logger;
  private rules: ParseRule[];

  constructor(manifests: Map<string, CollectionManifest>, logger: Logger) {
    this.manifests = manifests;
    this.logger = logger;
    this.rules = this.buildRules();
  }

  /**
   * Update the manifest registry (call after registerManifest).
   */
  updateManifests(manifests: Map<string, CollectionManifest>): void {
    this.manifests = manifests;
    this.rules = this.buildRules();
  }

  /**
   * Parse a natural language question into a SynapseDB query.
   */
  ask(question: string): NLQResult {
    this.logger.info(`NLQ: Parsing "${question}"`);

    const normalized = question.toLowerCase().trim();

    // Try each parse rule
    for (const rule of this.rules) {
      for (const pattern of rule.patterns) {
        const match = normalized.match(pattern);
        if (match) {
          const partial = rule.extract(match, this.manifests);
          if (partial && partial.collection) {
            const result = this.buildResult(question, partial);
            this.logger.info(`NLQ: Matched → ${result.operation} on "${result.collection}" (confidence: ${result.confidence})`);
            return result;
          }
        }
      }
    }

    // Fallback: try to detect collection name and do a broad search
    const fallback = this.fallbackParse(question, normalized);
    if (fallback) return fallback;

    throw new Error(
      `NLQ: Could not parse "${question}". ` +
      `Available collections: ${[...this.manifests.keys()].join(', ')}`,
    );
  }

  // ─── Rule Builder ───────────────────────────────────────

  private buildRules(): ParseRule[] {
    const collectionNames = [...this.manifests.keys()];
    const collectionPattern = collectionNames.length > 0
      ? collectionNames.join('|')
      : '[a-z_]+';

    return [
      // --- "Find/Get/Show all X where Y is Z" ---
      {
        patterns: [
          new RegExp(`(?:find|get|show|fetch|list)\\s+(?:all\\s+)?(${collectionPattern})\\s+(?:where|with|having)\\s+(\\w+)\\s+(?:is|=|equals?)\\s+['"]?([^'"]+?)['"]?$`, 'i'),
          new RegExp(`(?:find|get|show)\\s+(?:all\\s+)?(${collectionPattern})\\s+(?:where|with)\\s+(\\w+)\\s*=\\s*['"]?([^'"]+?)['"]?$`, 'i'),
        ],
        extract: (match) => ({
          collection: match[1]!,
          query: { [match[2]!]: this.castValue(match[3]!) },
          operation: 'find',
          confidence: 0.9,
          explanation: `Find ${match[1]} where ${match[2]} = "${match[3]}"`,
        }),
      },

      // --- "Find X by Y" ---
      {
        patterns: [
          new RegExp(`(?:find|get|show|fetch)\\s+(?:a\\s+)?(${collectionPattern.replace(/s$/, '')})\\s+(?:by|with)\\s+(\\w+)\\s+['"]?([^'"]+?)['"]?$`, 'i'),
        ],
        extract: (match) => ({
          collection: this.pluralize(match[1]!),
          query: { [match[2]!]: this.castValue(match[3]!) },
          operation: 'findOne',
          confidence: 0.85,
          explanation: `Find one ${match[1]} by ${match[2]} = "${match[3]}"`,
        }),
      },

      // --- "X cheaper/greater/less than Y" (numeric comparison) ---
      {
        patterns: [
          new RegExp(`(${collectionPattern})\\s+(?:with\\s+)?(\\w+)\\s+(?:less|lower|cheaper|under|below|smaller)\\s+than\\s+\\$?(\\d+(?:\\.\\d+)?)`, 'i'),
          new RegExp(`(${collectionPattern})\\s+(?:where\\s+)?(\\w+)\\s*<\\s*\\$?(\\d+(?:\\.\\d+)?)`, 'i'),
        ],
        extract: (match) => ({
          collection: match[1]!,
          query: { [match[2]!]: { $lt: Number(match[3]) } },
          operation: 'find',
          confidence: 0.85,
          explanation: `Find ${match[1]} where ${match[2]} < ${match[3]}`,
        }),
      },
      {
        patterns: [
          new RegExp(`(${collectionPattern})\\s+(?:with\\s+)?(\\w+)\\s+(?:greater|higher|more|over|above|expensive)\\s+than\\s+\\$?(\\d+(?:\\.\\d+)?)`, 'i'),
          new RegExp(`(${collectionPattern})\\s+(?:where\\s+)?(\\w+)\\s*>\\s*\\$?(\\d+(?:\\.\\d+)?)`, 'i'),
        ],
        extract: (match) => ({
          collection: match[1]!,
          query: { [match[2]!]: { $gt: Number(match[3]) } },
          operation: 'find',
          confidence: 0.85,
          explanation: `Find ${match[1]} where ${match[2]} > ${match[3]}`,
        }),
      },

      // --- "Latest/newest/recent N X" ---
      {
        patterns: [
          new RegExp(`(?:latest|newest|recent|last)\\s+(\\d+)\\s+(${collectionPattern})`, 'i'),
          new RegExp(`(?:get|show|find)\\s+(?:the\\s+)?(?:latest|newest|recent|last)\\s+(\\d+)\\s+(${collectionPattern})`, 'i'),
        ],
        extract: (match) => ({
          collection: match[2]!,
          query: {},
          options: {
            sort: { createdAt: -1 },
            limit: Number(match[1]),
          },
          operation: 'find',
          confidence: 0.8,
          explanation: `Find latest ${match[1]} ${match[2]} sorted by createdAt descending`,
        }),
      },

      // --- "How many X" (count) ---
      {
        patterns: [
          new RegExp(`how\\s+many\\s+(${collectionPattern})`, 'i'),
          new RegExp(`count\\s+(?:all\\s+)?(${collectionPattern})`, 'i'),
        ],
        extract: (match) => ({
          collection: match[1]!,
          query: {},
          operation: 'count',
          confidence: 0.9,
          explanation: `Count all ${match[1]}`,
        }),
      },

      // --- "Search X for 'Y'" (full-text) ---
      {
        patterns: [
          new RegExp(`search\\s+(${collectionPattern})\\s+(?:for\\s+)?['"]([^'"]+)['"]`, 'i'),
          new RegExp(`(?:find|search)\\s+(?:in\\s+)?(${collectionPattern})\\s+(?:matching|containing|about)\\s+['"]([^'"]+)['"]`, 'i'),
        ],
        extract: (match) => ({
          collection: match[1]!,
          query: {},
          operation: 'search',
          confidence: 0.9,
          explanation: `Full-text search in ${match[1]} for "${match[2]}"`,
          options: { projection: undefined },
        }),
      },

      // --- "Show all X sorted by Y" ---
      {
        patterns: [
          new RegExp(`(?:show|list|get|find)\\s+(?:all\\s+)?(${collectionPattern})\\s+(?:sorted|ordered)\\s+by\\s+(\\w+)(?:\\s+(asc|desc))?`, 'i'),
        ],
        extract: (match) => ({
          collection: match[1]!,
          query: {},
          options: {
            sort: { [match[2]!]: match[3]?.toLowerCase() === 'desc' ? -1 : 1 },
          },
          operation: 'find',
          confidence: 0.85,
          explanation: `Find all ${match[1]} sorted by ${match[2]} ${match[3] ?? 'asc'}`,
        }),
      },

      // --- Simple "Show/List/Get all X" ---
      {
        patterns: [
          new RegExp(`(?:show|list|get|find|fetch)\\s+(?:all\\s+)?(${collectionPattern})$`, 'i'),
        ],
        extract: (match) => ({
          collection: match[1]!,
          query: {},
          operation: 'find',
          confidence: 0.7,
          explanation: `Find all ${match[1]}`,
        }),
      },
    ];
  }

  // ─── Helpers ────────────────────────────────────────────

  private buildResult(question: string, partial: Partial<NLQResult>): NLQResult {
    const collection = partial.collection!;
    const query = partial.query ?? {};
    const options = partial.options ?? {};

    const ast = buildQueryAST({
      type: partial.operation === 'search' ? 'SEARCH' : 'FIND',
      collection,
      query: Object.keys(query).length > 0 ? query : undefined,
      projection: options.projection,
      sort: options.sort,
      limit: options.limit,
      offset: options.offset,
      searchQuery: partial.operation === 'search' ? partial.explanation?.split('"')[1] : undefined,
    });

    return {
      question,
      collection,
      query,
      options,
      operation: partial.operation ?? 'find',
      confidence: partial.confidence ?? 0.5,
      explanation: partial.explanation ?? `Parsed "${question}"`,
      ast,
    };
  }

  private fallbackParse(question: string, normalized: string): NLQResult | null {
    // Try to find a collection name anywhere in the question
    for (const [name] of this.manifests) {
      if (normalized.includes(name) || normalized.includes(name.slice(0, -1))) {
        return this.buildResult(question, {
          collection: name,
          query: {},
          operation: 'find',
          confidence: 0.4,
          explanation: `Detected collection "${name}" — returning all documents (low confidence)`,
        });
      }
    }
    return null;
  }

  private castValue(value: string): unknown {
    // Boolean
    if (value === 'true') return true;
    if (value === 'false') return false;
    // Number
    const num = Number(value);
    if (!isNaN(num) && value.trim() !== '') return num;
    // String
    return value.trim();
  }

  private pluralize(word: string): string {
    // Simple pluralization — check if manifest exists
    if (this.manifests.has(word)) return word;
    if (this.manifests.has(word + 's')) return word + 's';
    if (this.manifests.has(word + 'es')) return word + 'es';
    return word;
  }
}
