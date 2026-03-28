// ──────────────────────────────────────────────────────────────
// SynapseDB — Virtual Join Engine
// ──────────────────────────────────────────────────────────────

export { parallelFetch } from './fetcher.js';
export type { FetchResult } from './fetcher.js';
export { mergeResults } from './merger.js';
export {
  projectFields,
  normalizeDocuments,
  applyPagination,
  sortDocuments,
} from './projector.js';
