import type { ChatTurn } from '@twin/contracts';

/**
 * The seam that keeps the model out of the domain.
 *
 * Both providers are bound through injection tokens in the module, never as
 * concrete classes, so swapping Ollama for a hosted model is one binding and
 * no call site changes. Tests bind the fakes and never touch the network.
 *
 * Source of truth: design.md, "Provider seams".
 */
export interface EmbeddingProvider {
  /** Model identity recorded with every chunk, e.g. 'ollama:nomic-embed-text'. */
  readonly id: string;
  /** Fixed by the model and enforced by the `vector(768)` column. */
  readonly dimensions: number;
  embedDocuments(texts: readonly string[]): Promise<Float32Array[]>;
  embedQuery(text: string): Promise<Float32Array>;
  warmup(): Promise<void>;
}

export interface LlmStreamOptions {
  readonly system: string;
  readonly messages: readonly ChatTurn[];
  readonly temperature: number;
  readonly maxTokens: number;
  readonly signal?: AbortSignal;
}

export interface LlmProvider {
  /** Model identity recorded on every answer, e.g. 'ollama:mistral-nemo'. */
  readonly id: string;
  readonly contextWindow: number;
  /** Yields text deltas, not whole responses. */
  stream(options: LlmStreamOptions): AsyncIterable<string>;
}

export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

export class EmbeddingDimensionMismatch extends Error {
  constructor(
    readonly expected: number,
    readonly received: number,
    readonly model: string,
  ) {
    super(
      `Embedding model ${model} returned ${received} dimensions, but the chunks.embedding column is vector(${expected}). ` +
        `Fix the model or the migration; do not let a narrower vector reach the database.`,
    );
    this.name = 'EmbeddingDimensionMismatch';
  }
}

export class ProviderUnavailable extends Error {
  constructor(
    readonly provider: string,
    readonly cause: string,
  ) {
    super(`${provider} is unavailable: ${cause}`);
    this.name = 'ProviderUnavailable';
  }
}
