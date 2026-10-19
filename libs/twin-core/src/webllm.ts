/**
 * WebLLM behind the generation and embedding ports.
 *
 * Nothing in this file imports `@mlc-ai/web-llm` at module scope: the package
 * touches WebGPU on import, and a static import would break every Node test that
 * pulls in this library. The engine arrives as an argument, and the only place
 * that loads the real one does so through a dynamic import.
 */

export interface LoadProgress {
  /** 0 to 1, from the engine's own report. */
  readonly progress: number;
  readonly text: string;
}

export interface MlcEngineLike {
  readonly embeddings: {
    create(request: { input: string | string[]; model: string }): Promise<{
      data: { embedding: number[] }[];
    }>;
  };
  readonly chat: {
    completions: {
      create(request: MlcChatRequest): Promise<AsyncIterable<MlcChatChunk>>;
    };
  };
}

export interface MlcChatRequest {
  readonly stream: true;
  readonly messages: { role: string; content: string }[];
  readonly temperature: number;
  readonly max_tokens: number;
}

export interface MlcChatChunk {
  readonly choices: { delta?: { content?: string } }[];
}

/**
 * The two sizes offered at load, with the download measured from the registry on
 * 2026-10-19. The default is the small one: a visitor who never waits for the
 * better model never sees the better model.
 */
export const MODEL_CHOICES = [
  {
    id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    label: 'Fast',
    downloadMb: 290,
    description: 'Smallest download, answers in a couple of seconds on a laptop GPU.',
  },
  {
    id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    label: 'Better',
    downloadMb: 880,
    description: 'Better citation discipline and longer answers, three times the download.',
  },
  {
    id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',
    label: 'Best',
    downloadMb: 1748,
    description: 'Writes citable prose most reliably. Six times the download; desktop only in practice.',
  },
] as const;

/** Batch 32 variant, so a whole corpus can be embedded in a few calls. */
export const EMBEDDING_MODEL_ID = 'snowflake-arctic-embed-s-q0f32-MLC-b32';

export class WebLlmGenerator {
  readonly id = 'webllm';

  constructor(private readonly engine: MlcEngineLike) {}

  async *stream(request: {
    system: string;
    messages: readonly { role: string; content: string }[];
    temperature: number;
    maxTokens: number;
    signal?: AbortSignal;
  }): AsyncIterable<string> {
    const isAborted = (): boolean => request.signal?.aborted === true;
    if (isAborted()) return;

    const stream = await this.engine.chat.completions.create({
      stream: true,
      messages: [
        { role: 'system', content: request.system },
        ...request.messages.map((message) => ({ role: message.role, content: message.content })),
      ],
      temperature: request.temperature,
      max_tokens: request.maxTokens,
    });

    for await (const chunk of stream) {
      if (isAborted()) return;
      const delta = chunk.choices[0]?.delta?.content;
      if (typeof delta === 'string' && delta.length > 0) yield delta;
    }
  }
}

export class WebLlmEmbedder {
  readonly id = 'webllm:embedding';

  constructor(
    private readonly engine: MlcEngineLike,
    readonly dimensions?: number,
  ) {}

  async embedDocuments(texts: readonly string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const reply = await this.engine.embeddings.create({
      input: [...texts],
      model: EMBEDDING_MODEL_ID,
    });
    return reply.data.map((entry) => Float32Array.from(entry.embedding));
  }

  async embedQuery(text: string): Promise<Float32Array> {
    const [vector] = await this.embedDocuments([text]);
    if (vector === undefined) throw new Error('the embedding model returned no vector');
    return vector;
  }
}

/**
 * Loads the real engine. The dynamic import is the only place the package is
 * touched, so this function is the single seam a browser test needs to stub.
 */
export async function loadWebLlmEngine(
  modelId: string,
  onProgress: (progress: LoadProgress) => void,
): Promise<MlcEngineLike> {
  const webllm = (await import('@mlc-ai/web-llm')) as {
    CreateMLCEngine: (
      model: string,
      config: { initProgressCallback: (report: { progress: number; text: string }) => void },
    ) => Promise<MlcEngineLike>;
  };

  return webllm.CreateMLCEngine(modelId, {
    initProgressCallback: (report) => onProgress({ progress: report.progress, text: report.text }),
  });
}
