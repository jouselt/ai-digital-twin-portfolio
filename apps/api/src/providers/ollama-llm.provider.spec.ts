import { FakeLlmProvider } from './fakes';
import { OllamaLlmProvider } from './ollama-llm.provider';
import { ProviderUnavailable, type LlmStreamOptions } from './provider';

const BASE = 'http://127.0.0.1:11434';

function streamOf(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function frames(deltas: readonly string[], final: Record<string, unknown> = { done: true }): string {
  return (
    deltas.map((delta) => JSON.stringify({ message: { role: 'assistant', content: delta }, done: false })).join('\n') +
    '\n' +
    JSON.stringify(final) +
    '\n'
  );
}

function provider(fetchImpl: typeof fetch): OllamaLlmProvider {
  return new OllamaLlmProvider({
    baseUrl: BASE,
    model: 'mistral-nemo',
    contextWindow: 4096,
    fetchImpl,
  });
}

const options: LlmStreamOptions = {
  system: 'Answer using only the numbered sources.',
  messages: [
    { role: 'user', content: 'What did he ship at Carnival?' },
    { role: 'assistant', content: 'A WebSocket bridge [1].' },
    { role: 'user', content: 'And the PCI scope?' },
  ],
  temperature: 0.2,
  maxTokens: 220,
};

async function collect(iterable: AsyncIterable<string>): Promise<string[]> {
  const deltas: string[] = [];
  for await (const delta of iterable) deltas.push(delta);
  return deltas;
}

describe('OllamaLlmProvider', () => {
  it('yields one delta per frame, in order', async () => {
    const deltas = Array.from({ length: 12 }, (_, i) => `part${i} `);
    const fetchImpl = jest.fn(async () => new Response(streamOf([frames(deltas)]), { status: 200 }));

    const received = await collect(provider(fetchImpl as unknown as typeof fetch).stream(options));

    expect(received).toHaveLength(12);
    expect(received).toEqual(deltas);
  });

  it('reassembles frames split across transport chunks', async () => {
    const payload = frames(['Shipped ', 'structured ', 'logging [1].']);
    const fetchImpl = jest.fn(
      async () =>
        new Response(streamOf([payload.slice(0, 17), payload.slice(17, 45), payload.slice(45)]), {
          status: 200,
        }),
    );

    const received = await collect(provider(fetchImpl as unknown as typeof fetch).stream(options));

    expect(received.join('')).toBe('Shipped structured logging [1].');
  });

  it('sends the system prompt first and the configured sampling options', async () => {
    const fetchImpl = jest.fn(async () => new Response(streamOf([frames(['ok'])]), { status: 200 }));

    await collect(provider(fetchImpl as unknown as typeof fetch).stream(options));

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/chat`);
    const body = JSON.parse(String(init.body)) as {
      stream: boolean;
      model: string;
      messages: { role: string; content: string }[];
      options: { temperature: number; num_predict: number };
    };
    expect(body.stream).toBe(true);
    expect(body.model).toBe('mistral-nemo');
    expect(body.messages[0]).toEqual({ role: 'system', content: options.system });
    expect(body.messages).toHaveLength(4);
    expect(body.options).toEqual({ temperature: 0.2, num_predict: 220 });
  });

  it('stops at the done frame even when more frames follow', async () => {
    const payload =
      JSON.stringify({ message: { content: 'first' }, done: false }) +
      '\n' +
      JSON.stringify({ done: true }) +
      '\n' +
      JSON.stringify({ message: { content: 'never' }, done: false }) +
      '\n';
    const fetchImpl = jest.fn(async () => new Response(streamOf([payload]), { status: 200 }));

    const received = await collect(provider(fetchImpl as unknown as typeof fetch).stream(options));

    expect(received).toEqual(['first']);
  });

  it('surfaces an error frame as an unavailable provider instead of a truncated answer', async () => {
    const payload = JSON.stringify({ error: 'model mistral-nemo not found' }) + '\n';
    const fetchImpl = jest.fn(async () => new Response(streamOf([payload]), { status: 200 }));

    await expect(collect(provider(fetchImpl as unknown as typeof fetch).stream(options))).rejects.toThrow(
      /model mistral-nemo not found/,
    );
  });

  it('reports a non-200 response as unavailable', async () => {
    const fetchImpl = jest.fn(async () => new Response('nope', { status: 503 }));

    await expect(collect(provider(fetchImpl as unknown as typeof fetch).stream(options))).rejects.toThrow(
      ProviderUnavailable,
    );
  });

  it('rejects an unparseable frame rather than silently dropping text', async () => {
    const fetchImpl = jest.fn(async () => new Response(streamOf(['{not json}\n']), { status: 200 }));

    await expect(collect(provider(fetchImpl as unknown as typeof fetch).stream(options))).rejects.toThrow(
      /unparseable stream frame/,
    );
  });
});

describe('FakeLlmProvider', () => {
  it('records the options it was called with and counts calls', async () => {
    const fake = new FakeLlmProvider(['a', 'b']);

    const received = await collect(fake.stream(options));

    expect(received).toEqual(['a', 'b']);
    expect(fake.streamCalls).toBe(1);
    expect(fake.lastOptions?.maxTokens).toBe(220);
    expect(fake.lastMessages).toHaveLength(3);
  });

  it('can be scripted to decline, which is how the abstention path is driven', async () => {
    const fake = new FakeLlmProvider(['ABSENT']);

    const received = await collect(fake.stream(options));

    expect(received.join('')).toBe('ABSENT');
  });
});
