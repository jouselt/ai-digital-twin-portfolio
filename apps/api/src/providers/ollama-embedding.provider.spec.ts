import { EMBEDDING_DIMENSIONS } from '@twin/contracts';

import { FakeEmbeddingProvider } from './fakes';
import { OllamaEmbeddingProvider } from './ollama-embedding.provider';
import { EmbeddingDimensionMismatch, ProviderUnavailable } from './provider';

const BASE = 'http://127.0.0.1:11434';

function embeddingResponse(length: number): Response {
  return new Response(JSON.stringify({ embedding: Array.from({ length }, (_, i) => i / length) }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function provider(fetchImpl: typeof fetch, dimensions = EMBEDDING_DIMENSIONS): OllamaEmbeddingProvider {
  return new OllamaEmbeddingProvider({ baseUrl: BASE, model: 'nomic-embed-text', dimensions, fetchImpl });
}

describe('OllamaEmbeddingProvider', () => {
  it('sends the document task prefix and keeps the model resident', async () => {
    const fetchImpl = jest.fn(async () => embeddingResponse(EMBEDDING_DIMENSIONS));

    await provider(fetchImpl as unknown as typeof fetch).embedDocuments(['one passage']);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/embeddings`);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body['prompt']).toBe('search_document: one passage');
    expect(body['keep_alive']).toBe('10m');
    expect(body['model']).toBe('nomic-embed-text');
  });

  it('sends the query task prefix, which is not the document prefix', async () => {
    const fetchImpl = jest.fn(async () => embeddingResponse(EMBEDDING_DIMENSIONS));

    await provider(fetchImpl as unknown as typeof fetch).embedQuery('how did he log?');

    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>;
    expect(body['prompt']).toBe('search_query: how did he log?');
  });

  it('bounds in-flight requests to the batch size and still embeds all 33 documents', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchImpl = jest.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return embeddingResponse(EMBEDDING_DIMENSIONS);
    });
    const texts = Array.from({ length: 33 }, (_, i) => `passage ${i}`);

    const vectors = await provider(fetchImpl as unknown as typeof fetch).embedDocuments(texts);

    // One prompt per request on /api/embeddings, so 16 is a concurrency window, not a payload.
    expect(fetchImpl).toHaveBeenCalledTimes(33);
    expect(maxInFlight).toBeLessThanOrEqual(16);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(vectors).toHaveLength(33);
    expect(vectors.every((vector) => vector.length === EMBEDDING_DIMENSIONS)).toBe(true);
  });

  it('refuses a vector whose width does not match the column', async () => {
    const fetchImpl = jest.fn(async () => embeddingResponse(512));

    await expect(provider(fetchImpl as unknown as typeof fetch).embedQuery('q')).rejects.toThrow(
      EmbeddingDimensionMismatch,
    );

    await expect(provider(fetchImpl as unknown as typeof fetch).embedQuery('q')).rejects.toThrow(
      /returned 512 dimensions, but the chunks\.embedding column is vector\(768\)/,
    );
  });

  it('reports an unreachable or failing Ollama as unavailable, not as a dimension bug', async () => {
    const fetchImpl = jest.fn(async () => new Response('boom', { status: 500 }));

    await expect(provider(fetchImpl as unknown as typeof fetch).embedQuery('q')).rejects.toThrow(
      ProviderUnavailable,
    );
  });

  it('warms the model up with one request', async () => {
    const fetchImpl = jest.fn(async () => embeddingResponse(EMBEDDING_DIMENSIONS));

    await provider(fetchImpl as unknown as typeof fetch).warmup();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('FakeEmbeddingProvider', () => {
  it('returns the same vector for the same text across calls', async () => {
    const fake = new FakeEmbeddingProvider();

    const [first] = await fake.embedDocuments(['identical']);
    const [second] = await fake.embedDocuments(['identical']);

    expect(Array.from(first as Float32Array)).toEqual(Array.from(second as Float32Array));
    expect(first).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it('returns different vectors for different text and counts its calls', async () => {
    const fake = new FakeEmbeddingProvider();

    const [a] = await fake.embedDocuments(['alpha']);
    const [b] = await fake.embedDocuments(['beta']);
    await fake.embedQuery('alpha');

    expect(Array.from(a as Float32Array)).not.toEqual(Array.from(b as Float32Array));
    expect(fake.documentCalls).toBe(2);
    expect(fake.queryCalls).toBe(1);
  });

  it('produces unit vectors, so cosine similarity stays in range', async () => {
    const fake = new FakeEmbeddingProvider();

    const [vector] = await fake.embedDocuments(['length check']);
    const norm = Math.sqrt(Array.from(vector as Float32Array).reduce((sum, v) => sum + v * v, 0));

    expect(norm).toBeCloseTo(1, 5);
  });
});
