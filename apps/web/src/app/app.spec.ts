import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CorpusBundleLike } from '@twin/core';

import { App } from './app';
import { TwinService } from './twin/twin.service';
import { MemoryVectorCache } from './twin/vector-cache';

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
  ],
};

/** The browser is replaced wholesale: no GPU, no network, no model download. */
function environmentWithoutWebGpu() {
  return {
    probe: async () => ({
      canRunModel: false,
      reason: 'no-webgpu' as const,
      adapter: null,
      message: 'This browser cannot run the model locally.',
    }),
    loadBundle: async () => bundle,
    loadEngine: async () => {
      throw new Error('the engine must not load when the browser cannot run it');
    },
    cache: new MemoryVectorCache(),
    newTraceId: () => 'trace-test',
  };
}

describe('App', () => {
  let service: TwinService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    service = TestBed.inject(TwinService);
    service.useEnvironment(environmentWithoutWebGpu());
  });

  it('renders the corpus notice instead of a spinner when the browser cannot run the model', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await service.init();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('This browser cannot run the model locally');
    expect(text).toContain('Structured logging across Commerce APIs');
    expect(service.status()).toBe('fallback');
  });

  it('offers no question box in fallback mode, because the model is what answers', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await service.init();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('input[name="question"]')).toBeNull();
  });

  it('refuses to ask before the corpus is ready, instead of failing silently', async () => {
    await service.ask('What did he ship for Carnival?');

    expect(service.messages().length).toBe(0);
    expect(service.busy()).toBe(false);
  });
});
