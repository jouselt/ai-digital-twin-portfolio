import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CorpusBundleLike, MlcChatChunk, MlcEngineLike } from '@twin/core';

import { ChatPane } from './chat-pane';
import { TwinService } from './twin.service';
import { MemoryVectorCache } from './vector-cache';

const PASSAGE = 'The pattern and the dashboards were adopted across 6+ Commerce APIs.';

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
      embedText: PASSAGE,
      content: PASSAGE,
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

function environment() {
  return {
    probe: async () => ({ canRunModel: true, reason: 'ready' as const, adapter: null, message: '' }),
    loadBundle: async () => bundle,
    loadEngine: async () => engine(),
    cache: new MemoryVectorCache(),
    newTraceId: () => 'trace-test',
  };
}

describe('ChatPane citations', () => {
  let service: TwinService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChatPane],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    service = TestBed.inject(TwinService);
    service.useEnvironment(environment());
    await service.init();
  });

  it('hides the passage until the citation is opened', async () => {
    const fixture = TestBed.createComponent(ChatPane);
    fixture.detectChanges();
    await service.ask('How was the logging adopted?');
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.passage')).toBeNull();
    expect(element.querySelector('.source-toggle')).not.toBeNull();
  });

  it('shows the exact passage that was sent to the model, not a summary', async () => {
    const fixture = TestBed.createComponent(ChatPane);
    fixture.detectChanges();
    await service.ask('How was the logging adopted?');
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    (element.querySelector('.source-toggle') as HTMLButtonElement).click();
    fixture.detectChanges();

    const passage = element.querySelector('.passage-text')?.textContent?.trim();
    // The acceptance criterion for S2: the words shown are the words retrieved.
    expect(passage).toBe(PASSAGE);
    expect(element.querySelector('.source-toggle')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('closes the passage when the same citation is toggled again', async () => {
    const fixture = TestBed.createComponent(ChatPane);
    fixture.detectChanges();
    await service.ask('How was the logging adopted?');
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const toggle = element.querySelector('.source-toggle') as HTMLButtonElement;
    toggle.click();
    fixture.detectChanges();
    toggle.click();
    fixture.detectChanges();

    expect(element.querySelector('.passage')).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
});
