import { RETRIEVAL_K, type SourceRef } from '@twin/contracts';

/**
 * The retrieval seam.
 *
 * ChatService depends on this port rather than on pgvector, so the streaming,
 * citation and abstention logic is testable without a database. The pgvector
 * implementation lands with the ingest work.
 */
export interface RetrievalPort {
  /** Returns only sources at or above RETRIEVAL_MIN_SCORE, best first. */
  search(question: string, k: number): Promise<SourceRef[]>;
  /** Real project titles, used to tell the visitor what the corpus does cover. */
  suggestions(limit: number): Promise<string[]>;
}

export const RETRIEVAL_PORT = Symbol('RETRIEVAL_PORT');

export class FakeRetrievalPort implements RetrievalPort {
  searchCalls = 0;
  readonly queries: string[] = [];
  private readonly results: SourceRef[];
  private readonly titles: string[];

  constructor(results: readonly SourceRef[] = [], titles: readonly string[] = []) {
    this.results = [...results];
    this.titles = [...titles];
  }

  async search(question: string, k: number = RETRIEVAL_K): Promise<SourceRef[]> {
    this.searchCalls += 1;
    this.queries.push(question);
    return this.results.slice(0, k);
  }

  async suggestions(limit: number): Promise<string[]> {
    return this.titles.slice(0, limit);
  }
}
