import type { CorpusMetadata } from './frontmatter';

export interface StoredChunk {
  readonly ord: number;
  readonly contentHash: string;
}

export interface ChunkWrite {
  readonly ord: number;
  readonly section: string | null;
  readonly content: string;
  readonly contentHash: string;
  readonly tokenEst: number;
  /** Null means "unchanged, keep the stored vector". */
  readonly embedding: Float32Array | null;
}

/**
 * The persistence seam for ingest.
 *
 * Keeping it a port means the incremental behaviour (embed only what changed) is
 * testable without Postgres, which is where the interesting bugs live.
 */
export interface ChunkStore {
  loadHashes(projectId: string): Promise<readonly StoredChunk[]>;
  write(
    projectId: string,
    metadata: CorpusMetadata,
    sourceUri: string,
    rows: readonly ChunkWrite[],
  ): Promise<void>;
  /** Deletes chunks whose ord is no longer produced. Returns how many rows went away. */
  deleteOrphans(projectId: string, keepOrds: readonly number[]): Promise<number>;
}

export const CHUNK_STORE = Symbol('CHUNK_STORE');

export class InMemoryChunkStore implements ChunkStore {
  private readonly rows = new Map<string, Map<number, ChunkWrite>>();
  writeCalls = 0;

  async loadHashes(projectId: string): Promise<readonly StoredChunk[]> {
    const project = this.rows.get(projectId);
    if (project === undefined) return [];
    return [...project.values()].map((row) => ({ ord: row.ord, contentHash: row.contentHash }));
  }

  async write(
    projectId: string,
    _metadata: CorpusMetadata,
    _sourceUri: string,
    rows: readonly ChunkWrite[],
  ): Promise<void> {
    this.writeCalls += 1;
    const project = this.rows.get(projectId) ?? new Map<number, ChunkWrite>();
    for (const row of rows) {
      const previous = project.get(row.ord);
      project.set(row.ord, {
        ...row,
        embedding: row.embedding ?? previous?.embedding ?? null,
      });
    }
    this.rows.set(projectId, project);
  }

  async deleteOrphans(projectId: string, keepOrds: readonly number[]): Promise<number> {
    const project = this.rows.get(projectId);
    if (project === undefined) return 0;
    const keep = new Set(keepOrds);
    let deleted = 0;
    for (const ord of [...project.keys()]) {
      if (keep.has(ord)) continue;
      project.delete(ord);
      deleted += 1;
    }
    return deleted;
  }

  /** Test helper: the stored rows for a project, in ord order. */
  snapshot(projectId: string): ChunkWrite[] {
    const project = this.rows.get(projectId);
    if (project === undefined) return [];
    return [...project.values()].sort((a, b) => a.ord - b.ord);
  }
}
