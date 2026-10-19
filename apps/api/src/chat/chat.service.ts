import { Inject, Injectable } from '@nestjs/common';
import {
  MAX_TOKENS_CAP,
  RETRIEVAL_K,
  type AskRequest,
  type ChatEvent,
  type ChatTurn,
  type SourceRef,
} from '@twin/contracts';

import { LLM_PROVIDER, type LlmProvider } from '../providers/provider';
import { RETRIEVAL_PORT, type RetrievalPort } from '../retrieval/retrieval.port';
import { validateCitations } from './citation-validator';
import { ABSENT_TOKEN, buildSystemPrompt } from './system-prompt';
import { estimateTokens } from './token-estimate';

/** Turns of history forwarded to the model. Older turns are dropped, not summarised. */
const HISTORY_TURNS = 6;
const SUGGESTION_COUNT = 3;
const TEMPERATURE = 0.2;

@Injectable()
export class ChatService {
  constructor(
    @Inject(RETRIEVAL_PORT) private readonly retrieval: RetrievalPort,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  /**
   * Emits the frames in the one order the client understands: trace, retrieved,
   * delta*, then exactly one terminal frame. An abstention can arrive after the
   * deltas, because groundedness is only knowable once the answer is complete.
   */
  async *ask(request: AskRequest, traceId: string, signal?: AbortSignal): AsyncIterable<ChatEvent> {
    const startedAt = Date.now();
    yield { type: 'trace', trace_id: traceId };

    const sources = await this.retrieval.search(request.question, RETRIEVAL_K);
    yield { type: 'retrieved', sources };

    if (sources.length === 0) {
      // Nothing retrieved is a refusal, not an empty prompt.
      yield {
        type: 'abstain',
        reason: 'no_retrieval_above_floor',
        suggestions: await this.suggestions(),
      };
      return;
    }

    const maxTokens = Math.min(request.max_tokens ?? MAX_TOKENS_CAP, MAX_TOKENS_CAP);
    const answer = yield* this.generate(request, sources, maxTokens, signal);

    if (isDecline(answer)) {
      yield { type: 'abstain', reason: 'model_declined', suggestions: await this.suggestions() };
      return;
    }

    const check = validateCitations(answer, sources);
    if (check.grounded < 1) {
      yield {
        type: 'abstain',
        reason: 'ungrounded_citations',
        suggestions: await this.suggestions(),
      };
      return;
    }

    yield {
      type: 'done',
      grounded: check.grounded,
      tokens_out: Math.round(estimateTokens(answer)),
      elapsed_ms: Date.now() - startedAt,
    };
  }

  /**
   * Streams deltas while holding back a possible decline.
   *
   * The refusal token is short and starts the answer, so a plain stream would
   * show "ABSENT" to the visitor before the terminal frame replaced it. The
   * first few characters are therefore held until they either stop being a
   * prefix of the token or the stream ends.
   */
  private async *generate(
    request: AskRequest,
    sources: readonly SourceRef[],
    maxTokens: number,
    signal?: AbortSignal,
  ): AsyncGenerator<ChatEvent, string, undefined> {
    let answer = '';
    let guarding = true;

    const stream = this.llm.stream({
      system: buildSystemPrompt(sources),
      messages: messagesFor(request),
      temperature: TEMPERATURE,
      maxTokens,
      signal,
    });

    try {
      for await (const delta of stream) {
        answer += delta;
        if (guarding) {
          if (couldBeDecline(answer)) continue;
          guarding = false;
          yield { type: 'delta', text: answer };
          continue;
        }
        yield { type: 'delta', text: delta };
      }
    } finally {
      // Nothing to clean up: the provider owns its own abort on timeout.
    }

    if (guarding && answer.length > 0 && !isDecline(answer)) {
      yield { type: 'delta', text: answer };
    }
    return answer;
  }

  private async suggestions(): Promise<string[]> {
    return this.retrieval.suggestions(SUGGESTION_COUNT);
  }
}

export function messagesFor(request: AskRequest): ChatTurn[] {
  const recent = request.history.slice(-HISTORY_TURNS);
  return [...recent, { role: 'user', content: request.question }];
}

/** Trims whitespace and trailing punctuation before deciding, so "ABSENT." still declines. */
function normalizeDecline(text: string): string {
  return text.trim().replace(/[\s.]+$/, '').toUpperCase();
}

export function isDecline(text: string): boolean {
  return normalizeDecline(text) === ABSENT_TOKEN;
}

export function couldBeDecline(text: string): boolean {
  return ABSENT_TOKEN.startsWith(normalizeDecline(text));
}
