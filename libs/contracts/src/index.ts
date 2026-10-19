/**
 * Wire types shared by the Angular client and the NestJS API.
 *
 * This package is the only shared code between the two apps, and it holds
 * request and response shapes plus the SSE codec. No server imports, no
 * framework imports, no runtime dependencies beyond the standard library.
 *
 * Source of truth: design.md, sections "Streaming and latency" and
 * "Grounding, citation, abstention".
 */

/** Cosine similarity floor. Retrieved chunks below it are dropped before the prompt. */
export const RETRIEVAL_MIN_SCORE = 0.30;
export const RETRIEVAL_K = 6;
export const RETRIEVAL_K_MAX = 20;
export const MAX_TOKENS_CAP = 220;
/** Fixed by `nomic-embed-text`; `chunks.embedding` is `vector(768)`. */
export const EMBEDDING_DIMENSIONS = 768;
export const TRACE_HEADER = 'x-trace-id';

export type TraceId = string;

/** One retrieved passage, sent to the client before generation starts. */
export interface SourceRef {
  readonly chunkId: string;
  readonly projectId: string;
  readonly title: string;
  readonly section: string | null;
  readonly content: string;
  /** Cosine similarity in [0, 1]. */
  readonly score: number;
}

export interface ChatTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface AskRequest {
  readonly question: string;
  /** Oldest first. The API caps how many turns it forwards to the model. */
  readonly history: readonly ChatTurn[];
  /** Clamped to MAX_TOKENS_CAP; a caller asking for 2000 gets the cap. */
  readonly max_tokens?: number;
}

export type AbstainReason =
  | 'no_retrieval_above_floor'
  | 'model_declined'
  | 'ungrounded_citations';

export interface AbstainPayload {
  readonly outcome: 'abstain';
  readonly reason: AbstainReason;
  /** Always names what the twin does know. Never a bare "I don't know". */
  readonly answer: string;
  readonly suggestions: readonly string[];
  readonly trace_id: TraceId;
}

export interface AnswerPayload {
  readonly outcome: 'answered';
  readonly answer: string;
  readonly sources: readonly SourceRef[];
  /** citedMarkers / totalMarkers. 1.0 means every marker resolved to a real source. */
  readonly grounded: number;
  readonly tokens_out: number;
  readonly elapsed_ms: number;
  readonly trace_id: TraceId;
}

export type AskResponse = AnswerPayload | AbstainPayload;

/** Server-Sent Event frames, in the order the API emits them. */
export type ChatEvent =
  | { readonly type: 'trace'; readonly trace_id: TraceId }
  | { readonly type: 'retrieved'; readonly sources: readonly SourceRef[] }
  | { readonly type: 'delta'; readonly text: string }
  | {
      readonly type: 'abstain';
      readonly reason: AbstainReason;
      readonly suggestions: readonly string[];
    }
  | {
      readonly type: 'done';
      readonly grounded: number;
      readonly tokens_out: number;
      readonly elapsed_ms: number;
    }
  | { readonly type: 'error'; readonly message: string };

export type LeadIntent = 'email_summary' | 'schedule_call';

export interface LeadRequest {
  readonly name: string;
  readonly email: string;
  readonly intent: LeadIntent;
  readonly question: string;
  readonly trace_id: TraceId;
}

export interface LeadResponse {
  readonly lead_id: string;
  readonly mail_status: 'queued' | 'sent' | 'failed';
  readonly trace_id: TraceId;
}

export type Outcome = AskResponse['outcome'];
