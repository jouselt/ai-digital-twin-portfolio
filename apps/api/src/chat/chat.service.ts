import { Inject, Injectable } from '@nestjs/common';
import type { AskRequest, ChatEvent } from '@twin/contracts';
import {
  ask as runTwin,
  couldBeDecline,
  isDecline,
  messagesFor,
  SUGGESTION_COUNT,
  type GenerationPort,
  type TwinEngineDeps,
} from '@twin/core';

import { LLM_PROVIDER, type LlmProvider } from '../providers/provider';
import { RETRIEVAL_PORT, type RetrievalPort } from '../retrieval/retrieval.port';

export { couldBeDecline, isDecline, messagesFor };

/**
 * Server-side adapter over the shared engine.
 *
 * The frame order, the decline guard and the citation gate live in @twin/core so
 * the browser build and this one cannot drift apart. This class only supplies
 * the two ports: a Postgres-backed retriever and an HTTP-backed generator.
 */
@Injectable()
export class ChatService {
  private readonly generation: GenerationPort;

  constructor(
    @Inject(RETRIEVAL_PORT) private readonly retrieval: RetrievalPort,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {
    this.generation = {
      id: llm.id,
      stream: (request) =>
        this.llm.stream({
          system: request.system,
          messages: [...request.messages],
          temperature: request.temperature,
          maxTokens: request.maxTokens,
          signal: request.signal,
        }),
    };
  }

  async *ask(request: AskRequest, traceId: string, signal?: AbortSignal): AsyncIterable<ChatEvent> {
    const deps: TwinEngineDeps = {
      generation: this.generation,
      search: (question, k) => this.retrieval.search(question, k),
      suggestions: () => this.retrieval.suggestions(SUGGESTION_COUNT),
    };
    yield* runTwin(request, traceId, deps, signal);
  }
}
