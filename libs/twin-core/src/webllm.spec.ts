import {
  EMBEDDING_MODEL_ID,
  MODEL_CHOICES,
  WebLlmEmbedder,
  WebLlmGenerator,
  type MlcChatChunk,
  type MlcChatRequest,
  type MlcEngineLike,
} from './webllm';

function chunks(deltas: readonly (string | undefined)[]): MlcChatChunk[] {
  return deltas.map((delta) => ({ choices: [{ delta: delta === undefined ? {} : { content: delta } }] }));
}

class FakeEngine implements MlcEngineLike {
  requests: MlcChatRequest[] = [];
  embeddingCalls: { input: string | string[]; model: string }[] = [];

  constructor(
    private readonly deltas: readonly (string | undefined)[] = ['Shipped ', 'it [1].'],
    private readonly onChunk?: (index: number) => void,
  ) {}

  readonly embeddings = {
    create: async (request: { input: string | string[]; model: string }) => {
      this.embeddingCalls.push(request);
      const inputs = Array.isArray(request.input) ? request.input : [request.input];
      return {
        data: inputs.map((text, index) => ({
          embedding: [index, text.length, 0.5],
        })),
      };
    },
  };

  readonly chat = {
    completions: {
      create: async (request: MlcChatRequest) => {
        this.requests.push(request);
        const self = this;
        return (async function* () {
          let emitted = 0;
          for (const chunk of chunks(self.deltas)) {
            // The callback runs after the consumer has taken this chunk, which is
            // where an abort from the UI actually lands.
            yield chunk;
            emitted += 1;
            self.onChunk?.(emitted);
          }
        })();
      },
    },
  };
}

async function collect(iterable: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const delta of iterable) out.push(delta);
  return out;
}

const request = {
  system: 'Answer using only the numbered sources.',
  messages: [
    { role: 'user', content: 'What did he ship?' },
    { role: 'assistant', content: 'Logging [1].' },
    { role: 'user', content: 'And the PCI scope?' },
  ],
  temperature: 0.2,
  maxTokens: 220,
};

describe('WebLlmGenerator', () => {
  it('streams the deltas in order and skips empty ones', async () => {
    const engine = new FakeEngine(['Shipped ', undefined, '', 'logging [1].']);

    const deltas = await collect(new WebLlmGenerator(engine).stream(request));

    expect(deltas).toEqual(['Shipped ', 'logging [1].']);
  });

  it('sends the system prompt first, then the history, with the capped options', async () => {
    const engine = new FakeEngine();

    await collect(new WebLlmGenerator(engine).stream(request));

    const sent = engine.requests[0];
    expect(sent?.stream).toBe(true);
    expect(sent?.messages[0]).toEqual({
      role: 'system',
      content: 'Answer using only the numbered sources.',
    });
    expect(sent?.messages).toHaveLength(4);
    expect(sent?.temperature).toBe(0.2);
    expect(sent?.max_tokens).toBe(220);
  });

  it('does not touch the engine when the request is already aborted', async () => {
    const engine = new FakeEngine();
    const controller = new AbortController();
    controller.abort();

    const deltas = await collect(
      new WebLlmGenerator(engine).stream({ ...request, signal: controller.signal }),
    );

    expect(deltas).toEqual([]);
    expect(engine.requests).toHaveLength(0);
  });

  it('stops emitting as soon as the visitor aborts mid-stream', async () => {
    const controller = new AbortController();
    const engine = new FakeEngine(['first ', 'second ', 'third '], (index) => {
      if (index === 1) controller.abort();
    });

    const deltas = await collect(
      new WebLlmGenerator(engine).stream({ ...request, signal: controller.signal }),
    );

    expect(deltas).toEqual(['first ']);
  });
});

describe('WebLlmEmbedder', () => {
  it('embeds the whole corpus in one call with the batch-32 model', async () => {
    const engine = new FakeEngine();

    const vectors = await new WebLlmEmbedder(engine).embedDocuments(['one', 'two', 'three']);

    expect(engine.embeddingCalls).toHaveLength(1);
    expect(engine.embeddingCalls[0]?.model).toBe(EMBEDDING_MODEL_ID);
    expect(engine.embeddingCalls[0]?.input).toEqual(['one', 'two', 'three']);
    expect(vectors).toHaveLength(3);
    expect(vectors[0]).toBeInstanceOf(Float32Array);
  });

  it('returns the query vector directly', async () => {
    const engine = new FakeEngine();

    const vector = await new WebLlmEmbedder(engine).embedQuery('how did he log?');

    expect(vector).toBeInstanceOf(Float32Array);
    expect(engine.embeddingCalls[0]?.input).toEqual(['how did he log?']);
  });

  it('makes no call for an empty corpus', async () => {
    const engine = new FakeEngine();

    expect(await new WebLlmEmbedder(engine).embedDocuments([])).toEqual([]);
    expect(engine.embeddingCalls).toHaveLength(0);
  });
});

describe('MODEL_CHOICES', () => {
  it('leads with the small model, because the first load is a product decision', () => {
    expect(MODEL_CHOICES[0].downloadMb).toBeLessThan(MODEL_CHOICES[1].downloadMb);
    expect(MODEL_CHOICES[0].id).toBe('Qwen2.5-0.5B-Instruct-q4f16_1-MLC');
  });

  it('quotes the download measured from the registry', () => {
    expect(MODEL_CHOICES.map((choice) => choice.downloadMb)).toEqual([290, 880]);
  });
});
