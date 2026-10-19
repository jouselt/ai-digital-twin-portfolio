import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CorpusBundleLike, MlcChatChunk, MlcChatRequest, MlcEngineLike } from '@twin/core';

import { TwinService } from './twin.service';
import { MemoryVectorCache } from './vector-cache';

const bundle: CorpusBundleLike = {
  version: 1,
  bundleHash: 'hash-for-tests',
  chunkTargetTokens: 320,
  projects: [
    {
      id: 'commerce-observability',
      title: 'Structured logging across Commerce APIs',
      client: 'Disney Parks',
      role: 'Senior Fullstack Developer',
      period: '2021-present',
      stack: ['TypeScript'],
    },
  ],
  chunks: [
    {
      chunkId: 'commerce-observability:0',
      projectId: 'commerce-observability',
      title: 'Structured logging across Commerce APIs',
      section: 'Outcome',
      embedText: 'Adopted across 6+ Commerce APIs.',
      content: 'Adopted across 6+ Commerce APIs.',
      contentHash: 'abc',
    },
    {
      chunkId: 'commerce-observability:1',
      projectId: 'commerce-observability',
      title: 'Structured logging across Commerce APIs',
      section: 'Context',
      embedText: 'Commerce is several teams behind one surface.',
      content: '[context ...] Commerce is several teams behind one surface.',
      contentHash: 'def',
    },
  ],
};

/** Every vector is identical, so every chunk clears the floor and citations resolve. */
class FakeEngine implements MlcEngineLike {
  embeddingCalls = 0;
  chatCalls = 0;

  private readonly deltas: readonly string[];

  constructor(deltas?: readonly string[]) {
    this.deltas = deltas ?? ['Adopted across ', '6+ Commerce APIs [1].'];
  }

  readonly embeddings = {
    create: async (request: { input: string | string[]; model: string }) => {
      this.embeddingCalls += 1;
      const inputs = Array.isArray(request.input) ? request.input : [request.input];
      return { data: inputs.map(() => ({ embedding: [1, 0, 0, 0] })) };
    },
  };

  readonly chat = {
    completions: {
      create: async (_request: MlcChatRequest) => {
        this.chatCalls += 1;
        const deltas = this.deltas;
        return (async function* () {
          for (const delta of deltas) {
            yield { choices: [{ delta: { content: delta } }] } satisfies MlcChatChunk;
          }
        })();
      },
    },
  };
}

interface Recorder {
  readonly loads: string[];
  readonly engines: Map<string, FakeEngine>;
}

function environmentWithModelSupport(chatDeltas?: readonly string[]): {
  environment: Parameters<TwinService['useEnvironment']>[0];
  recorder: Recorder;
} {
  const recorder: Recorder = { loads: [], engines: new Map() };
  const environment = {
    probe: async () => ({ canRunModel: true, reason: 'ready' as const, adapter: null, message: '' }),
    loadBundle: async () => bundle,
    loadEngine: async (modelId: string) => {
      recorder.loads.push(modelId);
      const engine = new FakeEngine(
        modelId.includes('Qwen') && chatDeltas !== undefined ? chatDeltas : undefined,
      );
      recorder.engines.set(modelId, engine);
      return engine as MlcEngineLike;
    },
    cache: new MemoryVectorCache(),
    newTraceId: () => 'trace-test',
  };
  return { environment, recorder };
}

describe('TwinService with a model it can run', () => {
  let service: TwinService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    service = TestBed.inject(TwinService);
  });

  it('loads the embedding model and the chat model as two separate engines', async () => {
    const { environment, recorder } = environmentWithModelSupport();
    service.useEnvironment(environment);
    await service.init();

    await service.ask('How did he handle observability?');

    // The bug this covers: a single engine loaded with the chat model throws
    // EmbeddingModelNotFound the moment the corpus is embedded.
    expect(recorder.loads.length).toBe(2);
    expect(recorder.loads[0]).toContain('snowflake-arctic-embed-s');
    expect(recorder.loads[1]).toContain('Qwen');
    expect(service.status()).toBe('ready');
  });

  it('streams a grounded answer with citations once the model is loaded', async () => {
    const { environment } = environmentWithModelSupport();
    service.useEnvironment(environment);
    await service.init();

    await service.ask('How did he handle observability?');

    const answer = service.messages().at(-1);
    expect(answer?.text).toBe('Adopted across 6+ Commerce APIs [1].');
    expect(answer?.sources.length).toBeGreaterThan(0);
    expect(answer?.terminal).toEqual({ kind: 'done', grounded: 1 });
    expect(service.busy()).toBe(false);
  });

  it('does not re-embed the corpus when only the chat model changes', async () => {
    const { environment, recorder } = environmentWithModelSupport();
    service.useEnvironment(environment);
    await service.init();
    await service.ask('How did he handle observability?');
    const embeddingLoads = recorder.loads.filter((id) => id.includes('arctic-embed')).length;

    service.chooseModel('Qwen2.5-1.5B-Instruct-q4f16_1-MLC');
    await service.ask('And the second question?');

    expect(recorder.loads.filter((id) => id.includes('arctic-embed')).length).toBe(embeddingLoads);
    expect(recorder.loads.at(-1)).toContain('1.5B');
  });

  it('abstains instead of guessing when the model declines', async () => {
    // A chat engine that declines, which is what a small model does at the edge.
    const { environment } = environmentWithModelSupport(['ABSENT']);
    service.useEnvironment(environment);
    await service.init();

    await service.ask('What did he do at Disney Parks?');

    const answer = service.messages().at(-1);
    expect(answer?.text).toBe('');
    expect(answer?.terminal?.kind).toBe('abstain');
    expect(answer?.terminal?.reason).toBe('model_declined');
  });
});

describe('TwinService small talk', () => {
  let service: TwinService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    service = TestBed.inject(TwinService);
  });

  it('answers a greeting without loading a model or refusing', async () => {
    const { environment, recorder } = environmentWithModelSupport();
    service.useEnvironment(environment);
    await service.init();

    await service.ask('Hi');

    const answer = service.messages().at(-1);
    expect(answer?.text).toContain('every answer cites');
    expect(answer?.terminal).toBeNull();
    // The whole point: no download, no retrieval, no refusal on the first keystroke.
    expect(recorder.loads.length).toBe(0);
  });

  it('still sends a greeting followed by a real question to the corpus', async () => {
    const { environment, recorder } = environmentWithModelSupport();
    service.useEnvironment(environment);
    await service.init();

    await service.ask('Hi, how did he handle observability?');

    expect(recorder.loads.length).toBe(2);
    expect(service.messages().at(-1)?.terminal?.kind).toBe('done');
  });
});

describe('TwinService when the model cites without writing prose', () => {
  it('answers with the passage instead of leaving the visitor with markers', async () => {
    await TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    const service = TestBed.inject(TwinService);
    // The shape the browser produced: markers and nothing else. The question has
    // to be one the corpus covers, or the entity guard answers before the model.
    const { environment } = environmentWithModelSupport(['[1][4]']);
    service.useEnvironment(environment);
    await service.init();

    await service.ask('What did he ship for Disney Parks?');

    const answer = service.messages().at(-1);
    expect(answer?.terminal?.kind).toBe('quote');
    expect(answer?.text).toContain('From the record:');
    expect(answer?.text).toContain('[1]');
  });
});

describe('TwinService when the question names a company with no record', () => {
  let service: TwinService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    service = TestBed.inject(TwinService);
  });

  it('abstains without loading a model, and names what is missing', async () => {
    const { environment, recorder } = environmentWithModelSupport();
    service.useEnvironment(environment);
    await service.init();

    await service.ask('What did he ship for autodesk?');

    const answer = service.messages().at(-1);
    expect(answer?.terminal?.reason).toBe('uncovered_entity');
    expect(answer?.terminal?.detail).toContain('autodesk');
    expect(answer?.text).toBe('');
    // No 290 MB download to answer a question the corpus cannot answer.
    expect(recorder.loads.length).toBe(0);
  });

  it('still answers a question about a company the corpus covers', async () => {
    const { environment, recorder } = environmentWithModelSupport();
    service.useEnvironment(environment);
    await service.init();

    await service.ask('What did he ship for Disney Parks?');

    expect(recorder.loads.length).toBe(2);
    expect(service.messages().at(-1)?.terminal?.kind).toBe('done');
  });
});
