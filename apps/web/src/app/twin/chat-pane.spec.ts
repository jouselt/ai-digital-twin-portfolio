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

function gatedEngine() {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const base = engine();
  return {
    release: () => release(),
    engine: {
      ...base,
      chat: {
        completions: {
          create: async () =>
            (async function* () {
              yield { choices: [{ delta: { content: 'Adopted across 6+ ' } }] } satisfies MlcChatChunk;
              // Held open so a test can look at the page mid-answer.
              await gate;
              yield { choices: [{ delta: { content: 'Commerce APIs [1].' } }] } satisfies MlcChatChunk;
            })(),
        },
      },
    } as MlcEngineLike,
  };
}

function environment(customEngine?: MlcEngineLike) {
  return {
    probe: async () => ({ canRunModel: true, reason: 'ready' as const, adapter: null, message: '' }),
    loadBundle: async () => bundle,
    loadEngine: async () => customEngine ?? engine(),
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

describe('ChatPane accessibility', () => {
  let service: TwinService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChatPane],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    service = TestBed.inject(TwinService);
  });

  it('labels the question input and offers a skip link to the answer', async () => {
    service.useEnvironment(environment() as Parameters<TwinService['useEnvironment']>[0]);
    await service.init();
    const fixture = TestBed.createComponent(ChatPane);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('input[name="question"]')?.getAttribute('aria-label')).toContain(
      'Ask a question',
    );
    expect(element.querySelector('.skip-link')?.getAttribute('href')).toBe('#answers');
    expect(element.querySelector('#answers')).not.toBeNull();
  });

  it('announces nothing while the answer is still streaming', async () => {
    const gated = gatedEngine();
    service.useEnvironment(environment(gated.engine) as Parameters<TwinService['useEnvironment']>[0]);
    await service.init();
    const fixture = TestBed.createComponent(ChatPane);
    fixture.detectChanges();

    const asking = service.ask('How was the logging adopted?');
    // Let the first token land without finishing the answer.
    await new Promise((resolve) => setTimeout(resolve, 30));
    fixture.detectChanges();

    const live = fixture.nativeElement.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(live.textContent?.trim()).toBe('');

    gated.release();
    await asking;
    fixture.detectChanges();

    // Exactly one announcement, once the answer is complete.
    expect(live.textContent).toContain('Answer complete and grounded.');
    expect(live.textContent).toContain('Commerce APIs [1].');
  });
});

describe('ChatPane starters', () => {
  let service: TwinService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChatPane],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    service = TestBed.inject(TwinService);
    service.useEnvironment(environment() as Parameters<TwinService['useEnvironment']>[0]);
    await service.init();
  });

  it('offers a stranger something to click before they ask anything', () => {
    const fixture = TestBed.createComponent(ChatPane);
    fixture.detectChanges();

    const buttons = fixture.nativeElement.querySelectorAll('.starter') as NodeListOf<HTMLButtonElement>;
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    expect(buttons[0]?.textContent).toContain('?');
    // They are buttons, not links or list items, so a keyboard reaches them.
    expect(buttons[0]?.tagName).toBe('BUTTON');
  });

  it('asks the exact question it showed', () => {
    const fixture = TestBed.createComponent(ChatPane);
    fixture.detectChanges();

    const asked: string[] = [];
    spyOn(service, 'ask').and.callFake((question: string) => {
      asked.push(question);
      return Promise.resolve();
    });

    const first = fixture.nativeElement.querySelector('.starter') as HTMLButtonElement;
    const label = (first.textContent ?? '').trim();
    first.click();

    expect(asked).toEqual([label]);
  });
});
