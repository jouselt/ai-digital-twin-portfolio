import { Inject, Injectable } from '@nestjs/common';

import { EMBEDDING_PROVIDER, type EmbeddingProvider } from '../providers/provider';
import { CHUNK_STORE, type ChunkStore, type ChunkWrite } from './chunk-store';
import { CHUNK_TARGET_TOKENS, chunkDocument } from './chunker';
import { contentHash } from './content-hash';
import { parseCorpusFrontmatter } from './frontmatter';
import { normalizeDocument } from './normalize';

export interface CorpusSource {
  /** Repository-relative path or public URL, recorded on the project row. */
  readonly sourceUri: string;
  readonly markdown: string;
}

export interface IngestReport {
  readonly projectId: string;
  readonly chunks: number;
  readonly embedded: number;
  readonly unchanged: number;
  readonly deleted: number;
  readonly forcedSplits: number;
}

@Injectable()
export class IngestService {
  constructor(
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    @Inject(CHUNK_STORE) private readonly store: ChunkStore,
  ) {}

  /**
   * Normalises, chunks, and embeds only what changed.
   *
   * The hash is taken over the text the embedder actually sees, not over the
   * stored content. Stored content carries the previous chunk as a context
   * prefix, so hashing it would make one edited chunk re-embed its neighbour:
   * the exact cost this step exists to avoid.
   */
  async ingest(source: CorpusSource): Promise<IngestReport> {
    const { metadata, body } = parseCorpusFrontmatter(source.markdown, source.sourceUri);
    const chunks = chunkDocument(normalizeDocument(body), CHUNK_TARGET_TOKENS);

    const hashes = new Map(
      chunks.map((chunk) => [chunk.ord, contentHash(metadata.id, chunk.ord, chunk.embedText)]),
    );
    const existing = new Map(
      (await this.store.loadHashes(metadata.id)).map((row) => [row.ord, row.contentHash]),
    );
    const changed = chunks.filter((chunk) => existing.get(chunk.ord) !== hashes.get(chunk.ord));

    const vectors =
      changed.length === 0 ? [] : await this.embeddings.embedDocuments(changed.map((c) => c.embedText));
    const vectorByOrd = new Map(changed.map((chunk, index) => [chunk.ord, vectors[index]]));

    const rows: ChunkWrite[] = chunks.map((chunk) => ({
      ord: chunk.ord,
      section: chunk.section,
      content: chunk.content,
      contentHash: hashes.get(chunk.ord) as string,
      tokenEst: chunk.tokenEst,
      embedding: vectorByOrd.get(chunk.ord) ?? null,
    }));

    await this.store.write(metadata.id, metadata, source.sourceUri, rows);
    const deleted = await this.store.deleteOrphans(
      metadata.id,
      chunks.map((chunk) => chunk.ord),
    );

    return {
      projectId: metadata.id,
      chunks: chunks.length,
      embedded: changed.length,
      unchanged: chunks.length - changed.length,
      deleted,
      forcedSplits: chunks.filter((chunk) => chunk.forcedSplit).length,
    };
  }
}
