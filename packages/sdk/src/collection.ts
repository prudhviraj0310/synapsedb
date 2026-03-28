// ──────────────────────────────────────────────────────────────
// SynapseDB SDK — Collection Proxy
// Provides the fluent `db.users.insert()` style API.
// ──────────────────────────────────────────────────────────────

import type {
  Document,
  FindOptions,
  ApiResponse,
  InsertResult,
  UpdateResult,
  DeleteResult,
} from './types.js';

type RequestFn = (
  method: string,
  path: string,
  body?: unknown,
) => Promise<ApiResponse>;

/**
 * Collection — A proxy for a registered collection.
 *
 * Provides the clean, chainable API that makes SynapseDB feel
 * like a single database:
 *
 * ```typescript
 * await db.users.insert({ email: 'dev@test.com', name: 'Dev' });
 * const user = await db.users.findOne({ email: 'dev@test.com' });
 * await db.users.update({ id: user.id }, { name: 'Updated' });
 * await db.users.delete({ id: user.id });
 * ```
 */
export class Collection {
  private name: string;
  private request: RequestFn;

  constructor(name: string, request: RequestFn) {
    this.name = name;
    this.request = request;
  }

  /**
   * Insert one or more documents.
   */
  async insert(docs: Document | Document[]): Promise<InsertResult> {
    const documents = Array.isArray(docs) ? docs : [docs];
    const response = await this.request('POST', `/${this.name}/insert`, {
      documents,
    });

    if (!response.success) {
      throw new Error(response.error?.message ?? 'Insert failed');
    }

    return response.data as InsertResult;
  }

  /**
   * Find documents matching a query.
   */
  async find(
    query: Record<string, unknown> = {},
    options: FindOptions = {},
  ): Promise<Document[]> {
    const response = await this.request('POST', `/${this.name}/find`, {
      query,
      ...options,
    });

    if (!response.success) {
      throw new Error(response.error?.message ?? 'Find failed');
    }

    return (response.data ?? []) as Document[];
  }

  /**
   * Find a single document.
   */
  async findOne(
    query: Record<string, unknown> = {},
    options: Pick<FindOptions, 'projection'> = {},
  ): Promise<Document | null> {
    const response = await this.request('POST', `/${this.name}/findOne`, {
      query,
      ...options,
    });

    if (!response.success) {
      throw new Error(response.error?.message ?? 'FindOne failed');
    }

    return (response.data ?? null) as Document | null;
  }

  /**
   * Update documents matching a query.
   */
  async update(
    query: Record<string, unknown>,
    updates: Record<string, unknown>,
  ): Promise<UpdateResult> {
    const response = await this.request('PATCH', `/${this.name}/update`, {
      query,
      updates,
    });

    if (!response.success) {
      throw new Error(response.error?.message ?? 'Update failed');
    }

    return response.data as UpdateResult;
  }

  /**
   * Delete documents matching a query.
   */
  async delete(query: Record<string, unknown>): Promise<DeleteResult> {
    const response = await this.request('DELETE', `/${this.name}/delete`, {
      query,
    });

    if (!response.success) {
      throw new Error(response.error?.message ?? 'Delete failed');
    }

    return response.data as DeleteResult;
  }

  /**
   * Full-text search.
   */
  async search(searchQuery: string): Promise<Document[]> {
    const response = await this.request('POST', `/${this.name}/search`, {
      searchQuery,
    });

    if (!response.success) {
      throw new Error(response.error?.message ?? 'Search failed');
    }

    return (response.data ?? []) as Document[];
  }

  /**
   * Vector similarity search.
   */
  async similar(
    field: string,
    vector: number[],
    options: { topK?: number; threshold?: number } = {},
  ): Promise<Document[]> {
    const response = await this.request('POST', `/${this.name}/search`, {
      vectorQuery: {
        field,
        vector,
        topK: options.topK ?? 10,
        threshold: options.threshold,
      },
    });

    if (!response.success) {
      throw new Error(response.error?.message ?? 'Similar search failed');
    }

    return (response.data ?? []) as Document[];
  }
}
