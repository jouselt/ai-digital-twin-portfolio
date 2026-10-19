import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CorpusBundleLike, MlcChatChunk, MlcEngineLike } from '@twin/core';

import { StatusPanel } from './status-panel';
import { TwinService } from './twin.service';
import { MemoryVectorCache } from './vector-cache';

const bundle: CorpusBundleLike = {
  version: 1,
  bundleHash: 'abcdef0123456789',
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
  ],
};

function engine(): MlcEngineLike {
  return {
    embeddings: {
      create: async (request: { input: string | string[]; model: string }) => {
        const inputs = Array.isArray(request.input) ? request.input : [request.input];
        return { data: inputs.map(() => ({ embedding: [1, 0, 0, 0] })) };
      },
    },
    chat: {
      completions: {
        create: async () =>
          (async function* () {
            yield { choices: [{ delta: { content: 'Adopted across 6+ Commerce APIs [1].' } }] } satisfies MlcChatChunk;
          })(),
      },
    },
  } as MlcEngineLike;
}

describe('StatusPanel', () => {
  let service: TwinService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StatusPanel],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    service = TestBed.inject(TwinService);
    service.useEnvironment({
      probe: async () => ({
        canRunModel: true,
        reason: 'ready' as const,
        adapter: { vendor: 'apple', architecture: 'metal-3' },
        message: '',
      }),
      loadBundle: async () => bundle,
      loadEngine: async () => engine(),
      cache: new MemoryVectorCache(),
      newTraceId: () => 'trace-abc',
    } as Parameters<TwinService['useEnvironment']>[0]);
    await service.init();
  });

  it('names the hardware the answer actually ran on', async () => {
    const fixture = TestBed.createComponent(StatusPanel);
    fixture.detectChanges();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('apple metal-3');
    expect(text).toContain('your device');
  });

  it('ties the page to a corpus build and a model', async () => {
    const fixture = TestBed.createComponent(StatusPanel);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('bundle abcdef01');
    expect(text).toContain('290 MB');
  });

  it('shows the latency of the visitor machine and the trace id after an answer', async () => {
    const fixture = TestBed.createComponent(StatusPanel);
    fixture.detectChanges();
    await service.ask('How was the logging adopted?');
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('First token');
    expect(text).toContain('Full answer');
    expect(text).toContain('trace-abc');
    // Local compute, not a network: the label has to say so.
    expect(text).not.toContain('from the server');
  });
});
