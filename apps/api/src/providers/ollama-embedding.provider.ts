import {
  EmbeddingDimensionMismatch,
  ProviderUnavailable,
  type EmbeddingProvider,
} from './provider';

export interface OllamaEmbeddingConfig {
  readonly baseUrl: string;
  readonly model: string;
  readonly dimensions: number;
  /** nomic-embed-text is trained with these task prefixes; skipping them degrades asymmetric retrieval. */
  readonly documentPrefix?: string;
  readonly queryPrefix?: string;
  /** Ollama keeps the model resident between requests instead of reloading per call. */
  readonly keepAlive?: string;
  readonly batchSize?: number;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

interface OllamaEmbeddingResponse {
  embedding?: unknown;
}

/**
 * `nomic-embed-text` over Ollama's legacy `/api/embeddings` endpoint, one prompt
 * per request, batched at 16 to keep the host from queueing dozens of calls.
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  private readonly documentPrefix: string;
  private readonly queryPrefix: string;
  private readonly keepAlive: string;
  private readonly batchSize: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: OllamaEmbeddingConfig) {
    this.id = `ollama:${config.model}`;
    this.dimensions = config.dimensions;
    this.documentPrefix = config.documentPrefix ?? 'search_document: ';
    this.queryPrefix = config.queryPrefix ?? 'search_query: ';
    this.keepAlive = config.keepAlive ?? '10m';
    this.batchSize = config.batchSize ?? 16;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async embedDocuments(texts: readonly string[]): Promise<Float32Array[]> {
    const prefixed = texts.map((text) => this.documentPrefix + text);
    const vectors: Float32Array[] = [];
    for (let start = 0; start < prefixed.length; start += this.batchSize) {
      const batch = prefixed.slice(start, start + this.batchSize);
      vectors.push(...(await Promise.all(batch.map((prompt) => this.embed(prompt)))));
    }
    return vectors;
  }

  async embedQuery(text: string): Promise<Float32Array> {
    return this.embed(this.queryPrefix + text);
  }

  /** Loads the model so the first real question does not pay the cold start. */
  async warmup(): Promise<void> {
    await this.embed(this.documentPrefix + 'warmup');
  }

  private async embed(prompt: string): Promise<Float32Array> {
    const response = await this.post({ model: this.config.model, prompt, keep_alive: this.keepAlive });
    const vector = (response as OllamaEmbeddingResponse).embedding;
    if (!Array.isArray(vector) || !vector.every((value) => typeof value === 'number')) {
      throw new ProviderUnavailable(this.id, 'response carried no numeric embedding array');
    }
    if (vector.length !== this.dimensions) {
      throw new EmbeddingDimensionMismatch(this.dimensions, vector.length, this.id);
    }
    return Float32Array.from(vector as number[]);
  }

  private async post(body: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.config.baseUrl.replace(/\/$/, '')}/api/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new ProviderUnavailable(this.id, `HTTP ${response.status}`);
      }
      return (await response.json()) as unknown;
    } catch (error) {
      if (error instanceof ProviderUnavailable || error instanceof EmbeddingDimensionMismatch) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      throw new ProviderUnavailable(this.id, reason);
    } finally {
      clearTimeout(timer);
    }
  }
}
