# 01: AI Digital Twin Portfolio: Tasks

Angular 20.3 standalone, NestJS 11, TypeScript strict, PostgreSQL 16 + pgvector `vector(768)`, Ollama local. Every task ships with its tests in the same commit. Gate tests are deterministic and run in under 2s. Evals call the local model and are slower.

Legend: `[G]` gate test, `[E]` eval, `[M]` manual verification.

Stack is pinned because it matches the production stack Joe runs daily (`@angular/core` for the frontend, `@nestjs/common` and `@nestjs/core` 11.0.1 for the API). Angular 21 and 22 exist on npm; they are not used here. `vector(768)` is fixed because `nomic-embed-text` emits 768.

Measured on 2026-10-19 from the installed lockfile, not from npm ranges: `@angular/core` 20.3.34, `@angular/cli` 20.3.40, `@nestjs/common` 11.0.1, `@nestjs/core` 11.0.1, `typescript` 5.7.x, Node 22.22.3, npm 10.9.8. `@angular/core` and `@angular/cli` are pinned to those exact patch versions in `apps/web/package.json` so the lockfile and this document cannot drift apart; the other `@angular/*` packages keep a caret inside the same release train.

---

## Phase 0: Walking skeleton (the first demoable slice)

This phase exists because the original order builds horizontally: nothing a visitor can touch exists until Phase 9. A recruiter, a hiring manager, and Joe in an interview all need a URL that answers a question before any eval number means anything. Phase 0 pulls one thin vertical path through Phases 1 to 9 so that path is live early, then the numbered phases continue in their original order as the deepening path. No task below is deleted or reworded by this insertion.

Scope: eight corpus documents, real Ollama embeddings, real retrieval, real streaming, real citations, real abstention, deployed. Explicitly **out** of Phase 0: intent detection and lead capture (Phase 10), evals and published thresholds (Phases 5, 6, 7), the NixOS module beyond a Caddy route (Phase 11), and every HNSW parameter tuning task.

- [ ] `[G]` `libs/contracts` builds with `tsc` and the SSE codec round-trips all six frame types; a malformed frame decodes to `null` instead of throwing. Both apps import the package through the workspace.
- [ ] `[G]` `apps/api` boots with `ConfigModule` plus a Zod schema over the environment; a missing `OLLAMA_BASE_URL` throws a named error at boot, not at the first request.
- [ ] `[G]` `OllamaEmbeddingProvider` and `OllamaLlmProvider` bound through injection tokens, with `FakeEmbeddingProvider` and `FakeLlmProvider` bound in the test module so no test needs Ollama.
- [ ] `[G]` `IngestService` over `corpus/projects/*.md`: pack to `CHUNK_TARGET_TOKENS = 320` with the 60-token context prefix, `sha256(project_id | ord | content)`, upsert only changed hashes. A second run over an unchanged corpus issues 0 embedding calls.
- [ ] `[G]` `RetrievalService.search` drops every result below `RETRIEVAL_MIN_SCORE` before the prompt, and an empty result set produces the abstention branch rather than an empty prompt.
- [ ] `[G]` `POST /api/chat` streams `trace`, then `retrieved`, then one or more `delta`, then exactly one terminal frame (`done` or `abstain`); asserting the order across 20 fake runs. `ABSENT` from the model and `grounded < 1.0` both terminate as `abstain`.
- [ ] `[G]` Angular `ChatStore` plus `ChatPaneComponent` consume the SSE codec; the citation list renders from `retrieved` before the first `delta` arrives.
- [ ] `[M]` Deployed behind Caddy on the homelab: a stranger opens the URL, asks about the Commerce API observability work, gets an answer whose citation points at a real document, then asks about an employer that is not in the corpus and sees it abstain with three real topics offered.

Phase 0 is done when those seven gates are green, the manual check passes, and the eight corpus documents are the only source material. The evals in Phases 6 and 7 then measure this same path, which means their numbers describe something that already exists instead of a design.

---

## Phase 1: Repo skeleton and contracts

- [ ] `[G]` Create the workspace: `apps/web` (Angular), `apps/api` (NestJS), `libs/contracts`, `infra/nixos`, `infra/sql`, `corpus/projects`. Confirm `npm run typecheck` covers all three TypeScript projects.
- [ ] `[G]` Scaffold Angular 20.3 in `apps/web`: `ng new web --standalone --style=scss --routing --ssr=false`; set `"strict": true` and `"strictTemplates": true`; confirm `@angular/core` resolves to `20.3.x` in the lockfile.
- [ ] `[G]` Scaffold NestJS 11 in `apps/api`: `nest new api`; confirm `@nestjs/common` and `@nestjs/core` resolve to `11.0.x`; add `@nestjs/config`, `zod`, `pg`, `nestjs-pino`, `pino-http`.
- [ ] `[G]` `libs/contracts`: define `AskRequest`, `AskResponse`, `SourceRef`, `LeadRequest`, and the `ChatEvent` union. Test that an `AskResponse` fixture type-checks and that both apps can import the module.
- [ ] `[G]` Enable `provideZonelessChangeDetection()` in `app.config.ts`; test that a signal update in `ChatStore` re-renders without `NgZone`.
- [ ] `[G]` `ConfigModule` with a Zod schema over the env table in `design.md`; test that a missing `DATABASE_URL` throws a named error at boot, not at first request.

## Phase 2: Database and vector column

- [ ] `[G]` Write `infra/sql/001_init.sql`: `CREATE EXTENSION vector`, `projects`, `chunks` with `embedding vector(768) NOT NULL`, `content_hash char(64)`, `UNIQUE (project_id, ord)`, `leads`.
- [ ] `[G]` Write `infra/sql/002_hnsw.sql`: `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)`; set `hnsw.ef_search = 40` at session level in the retrieval query.
- [ ] `[G]` `VectorWidthGuard` in a NestJS `OnApplicationBootstrap` hook: reads `atttypmod` for `chunks.embedding` and throws `VectorWidthMismatch` unless it is exactly 768; test against a fixture column of 384 and one of 1536, asserting the error names the actual value found.
- [ ] `[G]` Run both migrations against a throwaway Postgres 16 container with pgvector; assert `\\d chunks` shows `vector(768)` and the HNSW index exists.
- [ ] `[M]` Confirm the local Postgres reports `0.8.x` for `SELECT extversion FROM pg_extension WHERE extname = 'vector'` and record the version in the README.

## Phase 3: Chunker and token estimate

- [ ] `[G]` `token-estimate.ts`: pure `estimate(text): number`, `max(chars / 4.0, words * 1.30) + codeChars * 0.40 + cjkChars * 0.50`; export the constants; test determinism over 10 identical calls and monotonicity.
- [ ] `[G]` `chunker.ts`: pure `splitIntoChunks(text, targetTokens)`. Split order: ATX heading, then blank-line paragraph, then sentence, then hard whitespace cut. Sentence regex `(?<=[.!?])\s+(?=[A-Z"'(])` with an abbreviation guard (`Mr.`, `e.g.`, `i.e.`, `vs.`, `Fig.`, single initials).
- [ ] `[G]` Test across the 8 corpus documents: zero mid-sentence splits except where `forced_split === true`, and no chunk exceeds `targetTokens + 50`.
- [ ] `[G]` Test determinism: same input and target give a JSON-identical chunk array across 3 runs.
- [ ] `[G]` Test the context prefix: chunk N > 0 carries the trailing 60 tokens of chunk N-1 tagged `[context ...]`, and `embedText()` on that chunk asserts the tag is absent.
- [ ] `[G]` Test markdown frontmatter extraction: `client`, `role`, `period`, `stack[]` parse from a fixture document; a document missing `stack` fails with a named error.

## Phase 4: Corpus

- [ ] `[M]` Write 8 corpus documents grounded in real work, each with the frontmatter fields above. Source material: Splunk dashboards over Commerce API traffic; structured logging with correlation ids adopted across 6+ Commerce APIs; a BFF in Node.js; a WebSocket bridge between web and POS under PCI constraints; Quick Quote Vista in Stencil.js with 8 international variants serving 20,000+ daily users; a 40% bundle reduction on the same storefront.
- [ ] `[M]` Verify against the two hard rules: every client named is one of Disney Parks, Carnival Cruise Line, LATAM Airlines, Autodesk, Banchile Inversiones; and nothing in the corpus describes building a tool Joe only used or only cloned.
- [ ] `[G]` Lint the corpus with a script that fails on empty sections, on a `stack` array with fewer than 2 entries, and on any document under 200 words.
- [ ] `[G]` Assert the corpus totals: 8 documents produce between 60 and 140 chunks at `CHUNK_TARGET_TOKENS = 320`. Record the real number in the README.

## Phase 5: Providers and ingest

- [ ] `[G]` Define `EmbeddingProvider` and `LlmProvider` in `libs/contracts`; bind both through injection tokens, not concrete classes.
- [ ] `[G]` `OllamaEmbeddingProvider`: POST `/api/embeddings` with `keep_alive: '10m'`; `embedDocuments` batches in groups of 16; `embedQuery` prefixes `search_query: ` and `embedDocuments` prefixes `search_document: `.
- [ ] `[G]` Test `OllamaEmbeddingProvider` against a mocked Ollama server that returns a fixed 768-float vector; assert every returned array has length 768 and that a 512-length response throws `EmbeddingDimensionMismatch`.
- [ ] `[G]` `FakeEmbeddingProvider` for tests: deterministic pseudo-random unit vectors from a seeded hash; test that the same text always yields the same vector.
- [ ] `[G]` `OllamaLlmProvider.stream()`: POST `/api/chat` with `stream: true`, parse newline-delimited JSON, yield `message.content` deltas; test against a fixture stream of 12 frames and assert 12 deltas in order.
- [ ] `[G]` `FakeLlmProvider` that yields a scripted string and counts `stream()` calls; test that the chat service calls it exactly once per question.
- [ ] `[G]` `IngestService`: normalize, chunk, prefix, hash, diff against existing hashes, embed only new or changed, upsert. Test that a second run over an unchanged corpus issues 0 embedding calls.
- [ ] `[G]` Test the incremental path: seed 100 chunks, change the content of 3, assert exactly 3 embedding calls and 97 rows untouched (`embedded_at` unchanged).
- [ ] `[G]` Test the hash contract: `sha256(project_id | ord | content)`; reordering two chunks changes both of their hashes.
- [ ] `[E]` Ingest eval: run `npm run ingest` on the real corpus and record total chunks, wall time, and the count of chunks carrying `forced_split`. Target: under 1% forced splits.

## Phase 6: Retrieval

- [ ] `[G]` `RetrievalService.search(query, k = 6)`: embed the query, run the cosine `<=>` query with `hnsw.ef_search = 40`, join `projects` for the title, return `SourceRef[]` with score.
- [ ] `[G]` Apply `RETRIEVAL_MIN_SCORE = 0.30`: results below the floor are dropped before the prompt. Test with a fake provider tuned to return a 0.05 score and assert the result set is empty.
- [ ] `[G]` Test the empty-result branch: an empty result set produces `outcome: 'abstain'`, `reason: 'no_retrieval_above_floor'`, and three non-empty suggestions drawn from `projects.title`.
- [ ] `[G]` Test that `k` is configurable and capped at 20; a request for `k = 500` is clamped, not passed through.
- [ ] `[E]` Retrieval eval: build a 30-question golden set, each question labelled with the chunk id a human judged correct. Assert recall@3 >= 25/30. Record the score, the model id, and the date in `evals/retrieval.md`.
- [ ] `[E]` Prefix ablation: run the same golden set with and without the `search_document:` / `search_query:` prefixes. Record both recall@3 numbers. Keep the prefixes only if they are better or equal; publish the delta either way.

## Phase 7: Chat, grounding, abstention

- [ ] `[G]` `ChatController`: `POST /api/chat`, Zod-validated `{ question, trace_id, history }`, responds `text/event-stream`.
- [ ] `[G]` `ChatService`: retrieve, build the system prompt from `design.md`, stream from `LlmProvider`, run `CitationValidator`, emit the `ChatEvent` frames in order.
- [ ] `[G]` Test frame ordering: `trace`, then `retrieved`, then one or more `delta`, then exactly one terminal frame (`done` or `abstain`). Assert `retrieved` precedes the first `delta` in 20 fake runs.
- [ ] `[G]` `CitationValidator`: parse `[n]` markers; drop any `n > sources.length`; compute `grounded = cited / total`. Test an answer citing `[9]` with 6 sources drops the marker and yields `grounded = 0`.
- [ ] `[G]` Test the abstention contract: a model reply of exactly `ABSENT` returns `outcome: 'abstain'`, `reason: 'model_declined'`, and the model text is not returned to the client.
- [ ] `[G]` Test the `grounded < 1.0` path: only 2 of 5 markers valid returns `abstain` with `reason: 'ungrounded_citations'` and logs the offending markers with the `trace_id`.
- [ ] `[G]` `maxTokens` is capped at 220; test the cap is applied even when the caller asks for 2000.
- [ ] `[G]` Model routing: a question matching the code-shaped keyword list (`function`, `class`, `endpoint`, `regex`, `query`, `schema`, plus `SQL` and `TypeScript`) routes to `qwen2.5-coder`; test 6 routing fixtures in each direction.
- [ ] `[E]` Answer eval: 30 golden questions, `mistral-nemo`, temperature 0.2. Assert >= 24/30 answers carry at least one valid citation to the human-labelled chunk. Record per-question results in `evals/answers.md`.
- [ ] `[E]` Abstention eval: 10 unanswerable questions (about employers not in the corpus, about tools Joe did not build, about technologies absent from the stack). Assert >= 9/10 abstain rather than answer. This is the eval that matters most; a twin that never says "I don't know" is not a twin, it is a liar with good uptime.

## Phase 8: Tracing and health

- [ ] `[G]` `TraceMiddleware`: reads `X-Trace-Id` or generates a UUID, binds it to async context, sets it on every pino line. Test that two requests produce two ids and that a supplied id is preserved verbatim.
- [ ] `[G]` Structured log lines on the Ollama call (`model`, `ms`, `tokens_out`) and on the pgvector query (`ms`, `rows`); test both lines appear for one request.
- [ ] `[G]` `/healthz` returns 200 when the process is up; `/readyz` returns 503 when the Ollama probe fails and 200 when it passes. Test both states with a stubbed probe.
- [ ] `[M]` `journalctl -u digital-twin-api | grep <trace-id>` returns every line for one request, using an id copied from the badge in the UI.

## Phase 9: Angular UI

- [ ] `[G]` `ChatStore` as a signal-based service: `messages`, `sources`, `status`, `traceId`. Test a submitted question moves status `idle -> retrieving -> streaming -> done`.
- [ ] `[G]` `ChatPaneComponent`: input, message list, auto-scroll pinned to the bottom unless the user has scrolled up. Test that a programmatic scroll is skipped when `scrollTop` is above the threshold.
- [ ] `[G]` `SseClient`: parse `text/event-stream` with `EventSource`, or with `fetch` + `ReadableStream` when a header is required. Test against a fixture stream and assert frame order matches.
- [ ] `[G]` `CitationListComponent`: renders source title, section, and score; clicking a citation scrolls to and highlights the source card. Test with 6 fixture sources and one dropped marker.
- [ ] `[G]` `AbstainCardComponent`: renders the abstain message and three suggestion chips; clicking a chip submits that question verbatim. Test the chip text equals the API suggestion text.
- [ ] `[G]` `TraceBadgeComponent`: shows the `trace_id`, click to copy via `navigator.clipboard.writeText`; test the clipboard call receives the full id.
- [ ] `[G]` `LeadCardComponent`: name, email, intent select, submit. Hidden by default; shown only when the API returns `intent_detected`. Test it is absent on a normal answer.
- [ ] `[G]` Test that `LeadCardComponent` never auto-submits; submitting requires a click event in the test, and no mail is sent on render.
- [ ] `[M]` Time to first token measured with `performance.now()` in the browser: under 1.5 s warm on 20 runs. Record p50.

## Phase 10: Intent detection and lead capture

- [ ] `[G]` `IntentService.stage1(text)`: the regex from `design.md`. Test 8 positive fixtures fire and 6 negative fixtures do not.
- [ ] `[G]` Negative fixture set must include "Do you have experience with email queues?", "Tell me about your messaging layer", and "How do you schedule background jobs?". All three must miss. This is the bug a keyword-only detector ships.
- [ ] `[G]` `IntentService.stage2(text)`: only invoked when stage 1 misses and the turn contains a first-person or second-person cue; one classification call at temperature 0 returning `none | email_summary | schedule_call`. Test that stage 2 is not called when stage 1 hits.
- [ ] `[G]` Test the none branch: stage 2 returning `none` sets no intent and does not show the lead card.
- [ ] `[G]` `LeadController`: `POST /api/lead`, Zod-validated; writes `leads` with `mail_status: 'queued'` then dispatches to `MailerProvider`; test a malformed email returns 400 with a field-level message.
- [ ] `[G]` Three `MailerProvider` implementations: `SmtpMailer`, `FileMailer`, `NullMailer`. Test suite binds `NullMailer`; test `FileMailer` writes an `.eml` containing the candidate name and at least one cited source.
- [ ] `[G]` Test the mail body is assembled from the same `SourceRef[]` that grounded the answer, not from a separate query.
- [ ] `[G]` Test that a mail failure writes `mail_status: 'failed'` and `mail_error`, and the HTTP response still returns 202. A broken SMTP server must not lose the lead.
- [ ] `[M]` Real end-to-end: start the stack, ask a question, express interest, fill the card, receive the email, confirm the cited sources match the chat citations.

## Phase 11: Deploy

- [ ] `[G]` `infra/nixos/default.nix`: `services.postgresql` on `postgresql16` with `pgvector`; `services.ollama` pulling `nomic-embed-text` and `mistral-nemo`; `systemd.services.digital-twin-api` with `After = postgresql.service ollama.service`, `Restart = on-failure`, `EnvironmentFile`, and an `ExecStartPre` migration step; `services.caddy` with `/api*` reverse-proxied to `:3000` and `file_server` + SPA `try_files` for the rest.
- [ ] `[G]` `nix flake check` passes on the module; assert the evaluated config contains both systemd units and the Caddy virtualHost.
- [ ] `[G]` `docker-compose.yml` for non-NixOS local dev: `pgvector/pgvector:pg16`, `ollama/ollama` with a named volume for models, `api`, `web`. Test `docker compose up --build` reaches a 200 on `/healthz`.
- [ ] `[G]` `npm run build` for both apps; assert `dist/apps/web/browser/index.html` exists and the API bundle starts from `dist/`.
- [ ] `[M]` `nixos-rebuild switch` on the homelab host, then `curl https://<host>/api/healthz` returns 200 over a valid ACME certificate.
- [ ] `[M]` `systemctl stop ollama` then `curl /readyz` returns 503; start it again and `/readyz` returns 200.
- [ ] `[G]` README: stack with pinned versions and why; the 768-dimension constraint and how it is asserted; measured latency including the ~10.6 s figure for a 180-token answer at ~17 tokens/sec; the recruiter demo script in 6 steps; how to add a document to the corpus and re-ingest.
- [ ] `[M]` 3-minute demo video: landing page, ask about the Commerce API observability work, get a cited answer, express interest, receive the email, show the trace id in the UI and the same id in the journal.

---

## Definition of done

- All `[G]` tasks pass in CI on a clean checkout.
- All `[E]` evals meet their thresholds, recorded with model id and date under `evals/`.
- Retrieval recall@3 >= 25/30 and abstention rate >= 9/10, both published in the README.
- The live site answers, cites, abstains, and sends mail, all on the homelab host.
- No cloud AI API key anywhere in the codebase or the environment files.
- No React example in any fixture, eval, or demo script.
- Every number in the README traces to a measured value or a named constant in the code.
