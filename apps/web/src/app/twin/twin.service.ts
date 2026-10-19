import { computed, Injectable, signal } from '@angular/core';
import type { AskRequest, ChatEvent, SourceRef } from '@twin/contracts';
import {
  ask as runTwin,
  cannedIntro,
  classifyIntent,
  uncoveredEntities,
  EMBEDDING_MODEL_ID,
  MODEL_CHOICES,
  parseBundle,
  probeCapabilities,
  retrieve,
  suggestionsFrom,
  WebLlmEmbedder,
  WebLlmGenerator,
  type Capability,
  type CorpusBundleLike,
  type EmbeddedChunk,
  type GenerationPort,
  type GpuLike,
  type MlcEngineLike,
} from '@twin/core';

import { sharesContentWord } from './relevance';
import { IndexedDbVectorCache, type VectorCache } from './vector-cache';

export type TwinStatus = 'idle' | 'probing' | 'fallback' | 'loading' | 'ready' | 'error';

export interface TwinTerminal {
  readonly kind: 'done' | 'abstain' | 'quote';
  readonly grounded?: number;
  readonly reason?: string;
  readonly suggestions?: readonly string[];
  /** The underlying failure, shown verbatim so it can be reported instead of guessed. */
  readonly detail?: string;
}

export interface TwinMessage {
  readonly role: 'user' | 'assistant';
  text: string;
  sources: readonly SourceRef[];
  terminal: TwinTerminal | null;
  traceId: string | null;
}

/** Everything that touches the browser, so tests can replace all of it. */
export interface TwinEnvironment {
  readonly probe: () => Promise<Capability>;
  readonly loadBundle: () => Promise<CorpusBundleLike>;
  readonly loadEngine: (
    modelId: string,
    onProgress: (progress: number, text: string) => void,
  ) => Promise<MlcEngineLike>;
  readonly cache: VectorCache;
  readonly newTraceId: () => string;
}

export function browserEnvironment(): TwinEnvironment {
  return {
    probe: () => probeCapabilities(browserGpuSafe()),
    loadBundle: async () => {
      const response = await fetch('corpus/bundle.json');
      if (!response.ok) throw new Error(`corpus bundle returned HTTP ${response.status}`);
      return parseBundle(await response.json());
    },
    loadEngine: async (modelId, onProgress) => {
      // Dynamic on purpose: web-llm touches WebGPU on import, so it belongs in a
      // lazy chunk that a fallback visitor never downloads.
      const { loadWebLlmEngine } = await import('@twin/core');
      return loadWebLlmEngine(modelId, (report) => onProgress(report.progress, report.text));
    },
    cache: new IndexedDbVectorCache(),
    newTraceId: () => crypto.randomUUID(),
  };
}

function browserGpuSafe(): GpuLike | null {
  const nav = globalThis as unknown as { navigator?: { gpu?: GpuLike } };
  return nav.navigator?.gpu ?? null;
}

@Injectable({ providedIn: 'root' })
export class TwinService {
  private environment: TwinEnvironment = browserEnvironment();
  private readonly bundleState = signal<CorpusBundleLike | null>(null);
  private chunks: EmbeddedChunk[] = [];
  private generator: GenerationPort | null = null;
  private embedder: WebLlmEmbedder | null = null;
  private controller: AbortController | null = null;
  private currentQuestion = '';
  private initialisation: Promise<void> | null = null;

  readonly status = signal<TwinStatus>('idle');
  readonly capability = signal<Capability | null>(null);
  readonly progress = signal(0);
  readonly progressText = signal('');
  readonly messages = signal<TwinMessage[]>([]);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly modelId = signal<string>(MODEL_CHOICES[0].id);
  readonly models = MODEL_CHOICES;
  readonly projects = computed(() => this.bundleState()?.projects ?? []);

  /** Test seam: replace the browser before anything runs. */
  useEnvironment(environment: TwinEnvironment): void {
    this.environment = environment;
  }

  /**
   * Probing and loading the bundle is a one-shot. The promise is kept so a caller
   * can await the work the component already started, which is what a zoneless
   * test needs: `whenStable` does not track promises.
   */
  init(): Promise<void> {
    this.initialisation ??= this.runInit();
    return this.initialisation;
  }

  private async runInit(): Promise<void> {
    this.status.set('probing');
    this.error.set(null);
    try {
      this.capability.set(await this.environment.probe());
      this.bundleState.set(await this.environment.loadBundle());
      // The fallback branch needs the bundle too: it lists the real projects.
      this.status.set(this.capability()?.canRunModel === true ? 'ready' : 'fallback');
    } catch (caught) {
      this.error.set(caught instanceof Error ? caught.message : 'the corpus could not be loaded');
      this.status.set('error');
    }
  }

  chooseModel(modelId: string): void {
    if (modelId === this.modelId()) return;
    this.modelId.set(modelId);
    // Only the chat engine is replaced. The vector space belongs to the embedding
    // model, which does not change, so the corpus is not re-embedded for this.
    this.generator = null;
  }

  cancel(): void {
    this.controller?.abort();
  }

  async ask(question: string): Promise<void> {
    const trimmed = question.trim();
    if (trimmed.length === 0 || this.busy() || this.status() !== 'ready') return;

    this.busy.set(true);
    this.error.set(null);

    const history = this.history();
    const traceId = this.environment.newTraceId();
    const answerIndex = this.messages().length + 1;
    this.messages.update((messages) => [
      ...messages,
      { role: 'user', text: trimmed, sources: [], terminal: null, traceId: null },
      { role: 'assistant', text: '', sources: [], terminal: null, traceId },
    ]);

    // A greeting is not a corpus question. Answering it with a refusal was the
    // single worst thing this page did: it read as broken on the first keystroke.
    if (classifyIntent(trimmed) !== 'ask') {
      const titles = (this.bundleState()?.projects ?? []).map((project) => project.title);
      this.patch(answerIndex, (entry) => {
        entry.text = cannedIntro(titles);
      });
      this.busy.set(false);
      return;
    }

    // A company the corpus never mentions cannot be answered from it, and cosine
    // similarity will not tell the difference: measured 0.71 to 0.74 for a
    // question about Autodesk against 0.73 for a covered one. Ask the text first.
    const missing = uncoveredEntities(trimmed, this.corpusText());
    if (missing.length > 0) {
      this.patch(answerIndex, (entry) => {
        entry.terminal = {
          kind: 'abstain',
          reason: 'uncovered_entity',
          detail: `No record of ${missing.join(', ')}. The corpus covers ${this.projectCount()} projects, none of them that.`,
        };
      });
      this.busy.set(false);
      return;
    }

    try {
      await this.ensureCorpus();
      const embedder = this.embedder;
      const generator = this.generator;
      if (embedder === null || generator === null) throw new Error('the model is not loaded');

      const query = await embedder.embedQuery(trimmed);
      const request: AskRequest = { question: trimmed, history };
      this.controller = new AbortController();
      this.currentQuestion = trimmed;

      const frames = runTwin(
        request,
        traceId,
        {
          generation: generator,
          search: (_text, k) => retrieve(query, this.chunks, k),
          suggestions: () => suggestionsFrom(this.chunks, 3),
        },
        this.controller.signal,
      );

      for await (const frame of frames) this.apply(frame, answerIndex);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'the answer could not be produced';
      this.error.set(message);
      this.patch(answerIndex, (entry) => {
        entry.terminal = { kind: 'abstain', reason: 'request_failed', detail: message };
      });
    } finally {
      this.busy.set(false);
      this.controller = null;
    }
  }

  /**
   * Two independent units of work, each loaded once.
   *
   * The corpus (embedding model plus vectors) and the chat model are separate
   * because an MLCEngine only serves the model it was loaded with: asking a chat
   * model for embeddings throws EmbeddingModelNotFound. Splitting the guards also
   * means switching the chat model does not reload the embedding engine or
   * re-embed anything, since the vector space does not change.
   */
  private async ensureCorpus(): Promise<void> {
    if (this.embedder === null || this.chunks.length === 0) await this.loadCorpus();
    if (this.generator === null) await this.loadChatModel();
    this.progress.set(1);
    this.status.set('ready');
  }

  private async loadCorpus(): Promise<void> {
    this.status.set('loading');
    const bundle = this.bundleState() ?? (await this.environment.loadBundle());
    this.bundleState.set(bundle);

    const embeddingEngine = await this.environment.loadEngine(EMBEDDING_MODEL_ID, (value, text) => {
      this.progress.set(value * 0.2);
      this.progressText.set(`embedding model · ${text}`);
    });
    const embedder = new WebLlmEmbedder(embeddingEngine);

    const cached = await this.environment.cache.read(bundle.bundleHash);
    const vectors = new Map<string, Float32Array>();

    if (cached !== null && cached.size === bundle.chunks.length) {
      this.progressText.set('reusing the vectors already computed in this browser');
      for (const [chunkId, vector] of cached) vectors.set(chunkId, vector);
    } else {
      this.progressText.set(`embedding ${bundle.chunks.length} passages`);
      const embedded = await embedder.embedDocuments(bundle.chunks.map((chunk) => chunk.embedText));
      bundle.chunks.forEach((chunk, index) => {
        const vector = embedded[index];
        if (vector !== undefined) vectors.set(chunk.chunkId, vector);
      });
      await this.environment.cache.write(bundle.bundleHash, vectors);
    }

    this.chunks = bundle.chunks.flatMap((chunk) => {
      const vector = vectors.get(chunk.chunkId);
      return vector === undefined
        ? []
        : [
            {
              chunkId: chunk.chunkId,
              projectId: chunk.projectId,
              title: chunk.title,
              section: chunk.section,
              content: chunk.content,
              embedding: vector,
            },
          ];
    });

    this.embedder = embedder;
  }

  private async loadChatModel(): Promise<void> {
    this.status.set('loading');
    const chatEngine = await this.environment.loadEngine(this.modelId(), (value, text) => {
      this.progress.set(0.2 + value * 0.8);
      this.progressText.set(`chat model · ${text}`);
    });
    this.generator = new WebLlmGenerator(chatEngine);
  }

  /**
   * Everything the corpus actually says, for the coverage check. Derived from the
   * bundle on demand: the check runs before any model is loaded, so caching this
   * inside the model-loading path left it empty exactly when it was needed.
   */
  private corpusText(): string {
    const bundle = this.bundleState();
    if (bundle === null) return '';
    return [
      ...bundle.projects.map((project) =>
        [project.title, project.client, project.role, ...project.stack].join(' '),
      ),
      ...bundle.chunks.map((chunk) => `${chunk.title} ${chunk.content}`),
    ].join(' ');
  }

  private projectCount(): number {
    return this.bundleState()?.projects.length ?? 0;
  }

  private history(): { role: 'user' | 'assistant'; content: string }[] {
    return this.messages()
      .filter((message) => message.text.length > 0)
      .slice(-6)
      .map((message) => ({ role: message.role, content: message.text }));
  }

  /** Only for model failures that still have a retrieved passage behind them. */
  private quoteFrom(sources: readonly SourceRef[], reason: string, question: string): string | null {
    if (reason !== 'no_citations' && reason !== 'no_prose') return null;
    // Quoting a passage at a question it has nothing to do with is not an answer.
    // The eval caught this: 'What is his current salary?' came back as a quote
    // about structured logging, which reads as if the record mentioned a salary.
    // The passage quoted is the first that actually shares a word with the
    // question, which is not always the top-scoring one.
    const relevant = sources.find((source) =>
      sharesContentWord(question, `${source.title} ${source.section ?? ''} ${source.content}`),
    );
    if (relevant === undefined) return null;

    const sentence = relevant.content
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(/(?<=[.!?])\s/)[0];
    const trimmed = sentence.length > 240 ? `${sentence.slice(0, 237).trimEnd()}...` : sentence;
    return `From the record: "${trimmed}" [1]`;
  }

  private apply(frame: ChatEvent, answerIndex: number): void {
    this.patch(answerIndex, (entry) => {
      switch (frame.type) {
        case 'trace':
          entry.traceId = frame.trace_id;
          break;
        case 'retrieved':
          entry.sources = frame.sources;
          break;
        case 'delta':
          entry.text += frame.text;
          break;
        case 'done':
          entry.terminal = { kind: 'done', grounded: frame.grounded };
          break;
        case 'abstain': {
          // The model failed to write a citable sentence. A weak model does that
          // often, and leaving the visitor with nothing wastes the retrieval that
          // already succeeded. Quoting the source is honest: the words are the
          // record's, and the marker points at the passage they came from.
          const quote = this.quoteFrom(entry.sources, frame.reason, this.currentQuestion);
          if (quote !== null) {
            entry.text = quote;
            entry.terminal = { kind: 'quote', grounded: 1 };
            break;
          }
          entry.terminal = {
            kind: 'abstain',
            reason: frame.reason,
            suggestions: frame.suggestions,
          };
          break;
        }
        default:
          break;
      }
    });
  }

  private patch(answerIndex: number, mutate: (message: TwinMessage) => void): void {
    this.messages.update((messages) => {
      const target = messages[answerIndex];
      if (target === undefined) return messages;
      mutate(target);
      return [...messages];
    });
  }
}
