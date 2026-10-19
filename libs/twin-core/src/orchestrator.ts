import {
  MAX_TOKENS_CAP,
  RETRIEVAL_K,
  type AskRequest,
  type ChatEvent,
  type ChatTurn,
  type SourceRef,
} from '@twin/contracts';

import { validateCitations } from './citation-validator';
import type { GenerationPort } from './generation';
import { buildSystemPrompt } from './system-prompt';
import { estimateTokens } from './token-estimate';

export const HISTORY_TURNS = 6;
export const SUGGESTION_COUNT = 3;
export const TEMPERATURE = 0.2;

export interface TwinEngineDeps {
  readonly generation: GenerationPort;
  /** Sync for the in-browser corpus; a Promise for a remote index. */
  readonly search: (question: string, k: number) => SourceRef[] | Promise<SourceRef[]>;
  readonly suggestions: () => string[] | Promise<string[]>;
  readonly historyTurns?: number;
}

/**
 * The whole answer path, framework free.
 *
 * Same contract as the server version it replaces: trace, retrieved, delta*,
 * then exactly one terminal frame. An abstention may arrive after the deltas,
 * because groundedness is only knowable once the answer is complete.
 */
export async function* ask(
  request: AskRequest,
  traceId: string,
  deps: TwinEngineDeps,
  signal?: AbortSignal,
): AsyncIterable<ChatEvent> {
  const startedAt = Date.now();
  yield { type: 'trace', trace_id: traceId };

  const sources = await deps.search(request.question, RETRIEVAL_K);
  yield { type: 'retrieved', sources };

  if (sources.length === 0) {
    yield {
      type: 'abstain',
      reason: 'no_retrieval_above_floor',
      suggestions: await deps.suggestions(),
    };
    return;
  }

  const maxTokens = Math.min(request.max_tokens ?? MAX_TOKENS_CAP, MAX_TOKENS_CAP);
  const answer = yield* generate(request, sources, maxTokens, deps, signal);

  if (isDecline(answer)) {
    yield { type: 'abstain', reason: 'model_declined', suggestions: await deps.suggestions() };
    return;
  }

  const check = validateCitations(answer, sources);
  if (check.totalMarkers > 0 && !hasProse(check.text)) {
    // Seen in a real browser: the answer was literally "[1][4]" and every marker
    // resolved, so the guard called it grounded. A citation with no sentence is
    // not a claim, and there is nothing for the visitor to read.
    yield { type: 'abstain', reason: 'no_prose', suggestions: await deps.suggestions() };
    return;
  }
  if (check.totalMarkers === 0) {
    // Nothing was cited, so there is nothing to verify. This is the common failure
    // of a small model, and it is not the same as inventing a source.
    yield { type: 'abstain', reason: 'no_citations', suggestions: await deps.suggestions() };
    return;
  }
  if (check.grounded < 1) {
    yield {
      type: 'abstain',
      reason: 'unknown_citations',
      suggestions: await deps.suggestions(),
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
 * Streams deltas while holding back a possible refusal.
 *
 * A plain stream would show "ABSENT" to the visitor before the terminal frame
 * replaced it. The first characters are held until they stop being a prefix of
 * the refusal token, or the stream ends.
 */
async function* generate(
  request: AskRequest,
  sources: readonly SourceRef[],
  maxTokens: number,
  deps: TwinEngineDeps,
  signal?: AbortSignal,
): AsyncGenerator<ChatEvent, string, undefined> {
  let answer = '';
  let guarding = true;

  const stream = deps.generation.stream({
    system: buildSystemPrompt(sources),
    messages: messagesFor(request, deps.historyTurns ?? HISTORY_TURNS),
    temperature: TEMPERATURE,
    maxTokens,
    signal,
  });

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

  if (guarding && answer.length > 0 && !isDecline(answer)) {
    yield { type: 'delta', text: answer };
  }
  return answer;
}

/** At least three words and ten characters of actual text, markers excluded. */
export function hasProse(text: string): boolean {
  const stripped = text.replace(/\[\d{1,3}\]/g, ' ').trim();
  return stripped.length >= 10 && stripped.split(/\s+/).filter((word) => /[a-z0-9]/i.test(word)).length >= 3;
}

export function messagesFor(request: AskRequest, historyTurns: number): ChatTurn[] {
  const recent = request.history.slice(-historyTurns);
  return [...recent, { role: 'user', content: request.question }];
}

/** Trims whitespace and trailing punctuation before deciding, so "ABSENT." declines. */
function normalizeDecline(text: string): string {
  return text.trim().replace(/[\s.]+$/, '').toUpperCase();
}

export function isDecline(text: string): boolean {
  return normalizeDecline(text) === 'ABSENT';
}

export function couldBeDecline(text: string): boolean {
  return 'ABSENT'.startsWith(normalizeDecline(text));
}
