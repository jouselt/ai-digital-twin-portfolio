import { EMBEDDING_DIMENSIONS, type ChatTurn } from '@twin/contracts';

import type { EmbeddingProvider, LlmProvider, LlmStreamOptions } from './provider';

/**
 * Deterministic stand-ins so no test needs Ollama running.
 *
 * The embedding fake returns the same vector for the same text on every run,
 * which is what makes retrieval assertions reproducible.
 */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'fake:deterministic-embedding';
  readonly dimensions: number;

  documentCalls = 0;
  queryCalls = 0;
  warmupCalls = 0;
  /** Overrides the query vector, for tests that need a controlled similarity. */
  queryVector: Float32Array | null = null;
  /** Texts handed to embedDocuments, in order. */
  readonly seenDocuments: string[] = [];

  constructor(dimensions: number = EMBEDDING_DIMENSIONS) {
    this.dimensions = dimensions;
  }

  async embedDocuments(texts: readonly string[]): Promise<Float32Array[]> {
    this.documentCalls += 1;
    this.seenDocuments.push(...texts);
    return texts.map((text) => deterministicVector(text, this.dimensions));
  }

  async embedQuery(text: string): Promise<Float32Array> {
    this.queryCalls += 1;
    return this.queryVector ?? deterministicVector(text, this.dimensions);
  }

  async warmup(): Promise<void> {
    this.warmupCalls += 1;
  }
}

export class FakeLlmProvider implements LlmProvider {
  readonly id = 'fake:scripted-llm';
  readonly contextWindow = 4096;

  streamCalls = 0;
  lastOptions: LlmStreamOptions | null = null;
  private readonly script: string[];
  private cursor = 0;

  constructor(deltas: readonly string[] = ['Grounded answer [1].']) {
    this.script = [...deltas];
  }

  /** Next call repeats the script from the start; tests that run 20 times need this. */
  reset(): void {
    this.cursor = 0;
    this.streamCalls = 0;
  }

  async *stream(options: LlmStreamOptions): AsyncIterable<string> {
    this.streamCalls += 1;
    this.lastOptions = options;
    const deltas = this.script.length > 0 ? this.script : [''];
    for (let index = 0; index < deltas.length; index += 1) {
      yield deltas[(this.cursor + index) % deltas.length] as string;
    }
    this.cursor = 0;
  }

  get lastMessages(): readonly ChatTurn[] {
    return this.lastOptions?.messages ?? [];
  }
}

/** FNV-1a over the text, then a small xorshift stream, normalised to unit length. */
function deterministicVector(text: string, dimensions: number): Float32Array {
  const vector = new Float32Array(dimensions);
  let state = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    state ^= text.charCodeAt(index);
    state = Math.imul(state, 0x01000193) >>> 0;
  }
  let norm = 0;
  for (let index = 0; index < dimensions; index += 1) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    const value = (state / 0xffffffff) * 2 - 1;
    vector[index] = value;
    norm += value * value;
  }
  const length = Math.sqrt(norm) || 1;
  for (let index = 0; index < dimensions; index += 1) {
    vector[index] = (vector[index] as number) / length;
  }
  return vector;
}
