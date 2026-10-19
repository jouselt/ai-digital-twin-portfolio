import { RETRIEVAL_MIN_SCORE, type SourceRef } from '@twin/contracts';

/** A corpus chunk with its vector, as shipped to the browser or held in memory. */
export interface EmbeddedChunk {
  readonly chunkId: string;
  readonly projectId: string;
  readonly title: string;
  readonly section: string | null;
  readonly content: string;
  readonly embedding: Float32Array;
}

/**
 * Cosine similarity, computed rather than assumed.
 *
 * The embedding model does not guarantee unit-length vectors, and a dot product
 * over unnormalised vectors would rank by magnitude, which silently changes the
 * order once a document's text length changes.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < length; index += 1) {
    const left = a[index] as number;
    const right = b[index] as number;
    dot += left * right;
    normA += left * left;
    normB += right * right;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Dense retrieval over the whole corpus.
 *
 * The corpus is small enough (tens of chunks) that a linear scan through every
 * vector is the right implementation: a browser-side ANN index would add
 * approximation error and a build step to save microseconds.
 */
export function retrieve(
  query: Float32Array,
  chunks: readonly EmbeddedChunk[],
  k: number,
  minScore: number = RETRIEVAL_MIN_SCORE,
): SourceRef[] {
  return chunks
    .map((chunk) => ({
      chunkId: chunk.chunkId,
      projectId: chunk.projectId,
      title: chunk.title,
      section: chunk.section,
      content: chunk.content,
      score: cosineSimilarity(query, chunk.embedding),
    }))
    .filter((source) => source.score >= minScore)
    .sort((left, right) => right.score - left.score)
    .slice(0, k);
}

/** Real project titles, offered to the visitor when the corpus cannot answer. */
export function suggestionsFrom(chunks: readonly EmbeddedChunk[], limit: number): string[] {
  const seen = new Set<string>();
  for (const chunk of chunks) {
    if (seen.size >= limit) break;
    seen.add(chunk.title);
  }
  return [...seen];
}
