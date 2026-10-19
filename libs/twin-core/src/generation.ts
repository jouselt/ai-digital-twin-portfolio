import type { ChatTurn } from '@twin/contracts';

export interface GenerationRequest {
  readonly system: string;
  readonly messages: readonly ChatTurn[];
  readonly temperature: number;
  readonly maxTokens: number;
  readonly signal?: AbortSignal;
}

/**
 * The generation seam.
 *
 * In the browser this is WebLLM; in tests and in the no-WebGPU fallback it is
 * something deterministic. Nothing above this interface knows which one is
 * running, which is what keeps the orchestration testable without a GPU.
 */
export interface GenerationPort {
  readonly id: string;
  stream(request: GenerationRequest): AsyncIterable<string>;
}

export interface CannedEntry {
  /** Case-insensitive substring matched against the visitor's question. */
  readonly matches: string;
  readonly deltas: readonly string[];
}

/**
 * Generation without a model.
 *
 * Two uses: a deterministic double for tests, and the honest fallback for a
 * browser that cannot run WebGPU, where the alternative would be a spinner that
 * never resolves.
 */
export class CannedGenerator implements GenerationPort {
  readonly id = 'canned';
  calls = 0;
  lastRequest: GenerationRequest | null = null;

  constructor(
    private readonly entries: readonly CannedEntry[] = [],
    private readonly fallback: readonly string[] = ['ABSENT'],
  ) {}

  async *stream(request: GenerationRequest): AsyncIterable<string> {
    this.calls += 1;
    this.lastRequest = request;
    const question = lastUserMessage(request.messages).toLowerCase();
    const entry = this.entries.find((candidate) =>
      question.includes(candidate.matches.toLowerCase()),
    );
    for (const delta of entry?.deltas ?? this.fallback) {
      yield delta;
    }
  }
}

function lastUserMessage(messages: readonly ChatTurn[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message !== undefined && message.role === 'user') return message.content;
  }
  return '';
}
