# 01: AI Digital Twin Portfolio: Design

Angular 20.3 frontend, NestJS 11 API, PostgreSQL 16 + pgvector (`vector(768)`), embeddings and generation from a local Ollama instance on the same host. Deployed as two systemd units behind Caddy on NixOS. No cloud API keys, no serverless, no managed vector database.

The proposal is the spec: a recruiter lands on the portfolio, asks a question, gets an answer grounded in real project data with citations, and the system performs a lead-capture action when it detects hiring intent. Everything below is the machinery that makes those four sentences true.

## Architecture

```
+------------------ Angular 20.3 (standalone, signals, zoneless) ------------------+
|                                                                                  |
|  +----------------+   +--------------------+   +----------------------------+   |
|  | ChatPane       |   | CitationList       |   | LeadCard                   |   |
|  | streamed SSE   |   | source + score     |   | name / email / intent      |   |
|  +----------------+   +--------------------+   +----------------------------+   |
|  +----------------+   +--------------------+                                    |
|  | SuggestionChips|   | TraceBadge         |  shows the correlation id          |
|  +----------------+   +--------------------+                                    |
+----------------------------------------------------------------------------------+
        | POST /api/chat  (SSE)                        | POST /api/lead
        v                                              v
+----------------------------------------------------------------------------------+
|  NestJS 11 API  (one process, feature modules)                                   |
|                                                                                  |
|  ChatModule          RetrievalModule        IngestModule       LeadModule        |
|   ChatController      RetrievalService       IngestService      LeadController   |
|   ChatService         EmbeddingProvider      ChunkerService     MailerProvider   |
|   LlmProvider         RerankService (none)   HashIndex          LeadRepository   |
|                                                                                  |
|  Shared: ConfigModule (Zod-validated env), LoggerModule (pino + correlation id), |
|          HealthModule (/healthz, /readyz with Ollama + pg probes)                |
+----------------------------------------------------------------------------------+
        |                    |                        |                  |
        v                    v                        v                  v
+----------------+  +------------------+  +--------------------+  +--------------+
| PostgreSQL 16  |  | Ollama :11434    |  | MailerProvider     |  | Caddy :443   |
| pgvector 0.8   |  | nomic-embed-text |  | SmtpMailer (prod)  |  | TLS, ACME    |
| vector(768)    |  | mistral-nemo     |  | FileMailer (dev)   |  | / -> angular |
| HNSW cosine    |  | qwen2.5-coder    |  | NullMailer (tests) |  | /api -> nest |
+----------------+  +------------------+  +--------------------+  +--------------+
```

Ollama and Postgres run on the same host as the API. The API never reaches the public internet for inference. That is a deliberate constraint, not an accident: it means the demo keeps working when a provider changes pricing, and there is no key to rotate.

## Package layout

```
01-ai-digital-twin-portfolio/
  apps/
    web/            Angular 20.3 application
    api/            NestJS 11 application
  libs/
    contracts/      DTOs and wire types shared by both apps, TypeScript only
  infra/
    nixos/          NixOS module: postgres16 + pgvector, ollama, caddy, two systemd units
    sql/            001_init.sql, 002_hnsw.sql
  corpus/
    projects/*.md   the source documents that become chunks
```

`contracts/` is the only shared code. It holds request and response shapes and nothing else, so the Angular build never imports server code.

## Data model

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE projects (
  id            text PRIMARY KEY,              -- 'splunk-commerce-observability'
  title         text NOT NULL,
  client        text,                          -- 'Disney Parks', 'LATAM Airlines'
  role          text,
  period        text,
  stack         text[] NOT NULL DEFAULT '{}',
  source_uri    text NOT NULL,                 -- path inside corpus/ or a public URL
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chunks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ord           int  NOT NULL,                 -- position within the document
  section       text,                          -- nearest markdown heading
  content       text NOT NULL,
  content_hash  char(64) NOT NULL,             -- sha256 of (project_id, ord, content)
  token_est     int  NOT NULL,
  embedding     vector(768) NOT NULL,
  embedded_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, ord)
);

CREATE INDEX chunks_embedding_hnsw ON chunks
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

CREATE TABLE leads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text,
  email         text,
  intent        text NOT NULL,                 -- 'email_summary' | 'schedule_call'
  question      text,                          -- last question asked, for context
  trace_id      text NOT NULL,                 -- ties the lead to a chat trace
  mail_status   text NOT NULL,                 -- 'queued' | 'sent' | 'failed'
  mail_error    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
```

`vector(768)` is fixed. `nomic-embed-text` emits 768 dimensions, verified against the local Ollama instance. The width is asserted at boot: the API refuses to start if `SELECT atttypmod` for `chunks.embedding` is not 768. That check turns a silent dimension mismatch into a loud startup failure.

## Provider seams

Two interfaces, one implementation each, plus a fake for tests.

```ts
export interface EmbeddingProvider {
  readonly id: string;                 // 'ollama:nomic-embed-text'
  readonly dimensions: 768;
  embedDocuments(texts: string[]): Promise<Float32Array[]>;
  embedQuery(text: string): Promise<Float32Array>;
  warmup(): Promise<void>;
}

export interface LlmProvider {
  readonly id: string;                 // 'ollama:mistral-nemo'
  readonly contextWindow: number;
  stream(opts: {
    system: string;
    messages: ChatTurn[];
    temperature: number;
    maxTokens: number;
    signal: AbortSignal;
  }): AsyncIterable<string>;           // text deltas, not full responses
}
```

`OllamaEmbeddingProvider` posts to `/api/embeddings` with `keep_alive: '10m'` so the model stays resident between questions. `OllamaLlmProvider` posts to `/api/chat` with `stream: true` and parses the newline-delimited JSON body.

Both are bound through a NestJS injection token, not a concrete class:

```ts
{ provide: EMBEDDING_PROVIDER, useClass: OllamaEmbeddingProvider }
```

A cloud provider would be a second class plus one line in the module. That is the whole point of the seam: the day Joe wants to compare `nomic-embed-text` against a hosted model, the change is one binding, not a rewrite.

## Ingest

`IngestService` runs as a NestJS command (`npm run ingest`), not at request time.

1. Read every `corpus/projects/*.md` plus frontmatter (title, client, role, period, stack).
2. Normalize: CRLF to LF, collapse 3+ blank lines to 2, strip HTML comments.
3. Split on ATX headings into sections. A heading always starts a new chunk boundary.
4. Oversized section: split on blank lines into paragraphs.
5. Oversized paragraph: split on sentence boundaries with an abbreviation guard.
6. Oversized single sentence: hard cut at whitespace, flagged `forced_split: true`.
7. Pack greedily to `CHUNK_TARGET_TOKENS = 320`, carrying the trailing 60 tokens of the previous chunk as a `[context …]` prefix that is excluded from the embedded text.
8. Prefix each embedded document with `search_document: ` and each query with `search_query: `. `nomic-embed-text` is trained with those task prefixes; skipping them measurably degrades asymmetric retrieval, and the eval in Phase 6 measures the delta rather than assuming it.
9. `sha256(project_id | ord | content)`. Query existing hashes. Embed only the rows whose hash is missing or changed. Upsert the rest untouched.

Step 9 is why a re-ingest after fixing one typo costs one embedding call instead of the whole corpus. It also makes the ingest idempotent, which matters when it runs on every deploy.

Token estimate is the same pure heuristic used across the portfolio: `max(chars / 4.0, words * 1.30)` plus adjustments for code fences and CJK. It is labelled an estimate everywhere it appears.

## Retrieval

Dense-only for v1.

```sql
SELECT c.id, c.project_id, p.title, c.section, c.content,
       1 - (c.embedding <=> $1::vector) AS score
FROM chunks c
JOIN projects p ON p.id = c.project_id
ORDER BY c.embedding <=> $1::vector
LIMIT $2;
```

`k = 6`, then a score floor. Chunks scoring below `MIN_SCORE = 0.30` cosine similarity are dropped before they reach the prompt. If the floor drops everything, the pipeline abstains. The floor is a constant in `retrieval.config.ts`, exported and covered by a test, not a number buried in a query.

Chunk size 320 with a 60-token context prefix is chosen against `mistral-nemo`'s practical context: 6 chunks is about 2,300 tokens, which leaves room for the system prompt and a 300-token answer without pushing past what a 7B model tracks reliably. Bigger chunks would retrieve fewer, coarser passages and lose the section-level citation granularity the UI shows.

Hybrid retrieval with reciprocal rank fusion is deliberately not here. Project 02 builds it, because its corpus is source code where an exact identifier like `diagLog` or a PCI control name is a stronger signal than semantics. This corpus is prose about the same person, where paraphrase dominates and exact-token matching adds little. Stating that keeps the two projects from duplicating work and gives each a reason for its design.

## Grounding, citation, abstention

The system prompt is short and constrains output shape:

```
You are answering questions about Jouselt A. Fernandez, a senior fullstack
developer with 10 years of experience, based in Santiago, Chile.

Answer using ONLY the numbered sources. Every sentence that states a fact must
end with a citation like [1] or [2][3]. Cite the lowest-numbered source that
supports the claim.

If the sources do not contain the answer, reply with exactly:
ABSENT

Do not guess. Do not use prior knowledge about this person or his employers.
```

After streaming completes, `CitationValidator` runs deterministically:

1. Parse every `[n]` marker out of the answer.
2. Drop markers where `n > retrieved.length`. Those are hallucinated source ids.
3. Compute `grounded = citedMarkers / totalMarkers`.
4. Check each cited chunk id against the ids actually passed to the model.

If the model emitted `ABSENT`, or if `grounded < 1.0`, the API returns a structured abstention instead of the text:

```json
{
  "outcome": "abstain",
  "reason": "no_retrieval_above_floor",
  "answer": "I do not have that in my project records. Ask about the Commerce API observability work, the POS WebSocket integration, or the Quick Quote Vista build.",
  "suggestions": ["..."],
  "trace_id": "01HQ..."
}
```

The response always names what the twin does know. An abstention that just says "I don't know" is a dead end; an abstention that offers three real topics is a conversation.

## Intent detection and lead capture

Intent detection is a two-stage design, because a regex alone fires on "Do you have experience with email queues?" and a model alone is slow.

Stage 1, deterministic, runs on the user turn in under a millisecond:

```
/(let'?s|lets)\s+(work|talk|connect|chat)|reach\s+(out|me)|get\s+in\s+touch|
 (send|email)\s+(me|us)?\s*(a|the)?\s*(summary|details|info)|
 (schedule|book)\s+(a\s+)?(call|meeting|interview)|i'?d\s+like\s+to\s+(hire|interview)/
```

Stage 2, model-backed, only runs when stage 1 misses and the turn contains a first-person or second-person cue. It is a single short classification call at temperature 0 returning one of `none | email_summary | schedule_call | none`. Stage 2 exists so "Sounds good, how do we move forward?" is caught without hand-writing another regex.

A hit sets `showLeadCard = true` in the UI. It never sends mail without an explicit submit. Auto-sending on a guessed intent is how you email someone who was just being polite.

`POST /api/lead` takes `{ name, email, intent, question, trace_id }`, validates against a Zod schema, writes the `leads` row with `mail_status: 'queued'`, then hands off to `MailerProvider`. Three implementations: `SmtpMailer` (production, credentials from `/etc/nixos/secrets/`), `FileMailer` (dev, writes `.eml` to a temp dir), `NullMailer` (tests). The mail body is built from the same corpus documents the answer was grounded in, so the summary a recruiter receives cites the same sources the chat did.

## Streaming and latency

`POST /api/chat` responds as Server-Sent Events. Frame types:

```ts
type ChatEvent =
  | { type: 'trace';     trace_id: string }
  | { type: 'retrieved'; sources: SourceRef[] }   // sent before generation starts
  | { type: 'delta';     text: string }
  | { type: 'abstain';   reason: string; suggestions: string[] }
  | { type: 'done';      grounded: number; tokens_out: number; elapsed_ms: number }
  | { type: 'error';     message: string };
```

Sending `retrieved` before the first `delta` means the citation list renders while the model is still writing. Time to first token is what a recruiter feels; sources-on-screen at 300 ms beats sources-on-screen at 9 s.

Measured on the target host, `mistral-nemo` warm generates at roughly 17 tokens/sec. A 180-token answer is therefore about 10.6 s of generation. That number is published in the README rather than hidden, because hiding it would make the demo look broken when someone times it. The acceptance criteria reflect it: time to first token under 1.5 s, full answer p50 measured and published, and `maxTokens` capped at 220 so a rambling answer is truncated rather than allowed to run for a minute.

## Observability

Every request gets a `trace_id` generated in the Angular client (crypto.randomUUID) and sent as `X-Trace-Id`. NestJS reads it in a middleware, binds it to the async context, and pino emits it on every log line, including the Ollama call timing and the pgvector query timing. The chat UI shows the id in a small badge; a recruiter who reports "answer X was wrong" can quote a single id and Joe can pull the exact retrieval set.

This mirrors work Joe has done in production: structured logging with correlation ids propagated across 6+ Commerce APIs, with Splunk dashboards on top. Same idea, one process, and the trace is visible to the person who needs it instead of only to the on-call engineer.

## Deployment

NixOS module in `infra/nixos/`:

- `services.postgresql` with `package = pkgs.postgresql16`, `extensions = with pkgs.postgresql16.pkgs; [ pgvector ]`, database `digital_twin`.
- `services.ollama` with `acceleration` set to the host default, `environment.Models` pulling `nomic-embed-text` and `mistral-nemo`, and a `postStart` that runs `ollama pull` for both.
- `systemd.services.digital-twin-api` running the built NestJS bundle, `Restart = on-failure`, `EnvironmentFile = /etc/nixos/secrets/digital-twin.env`, `After = postgresql.service ollama.service`, and a `ExecStartPre` that runs the pending migrations.
- `systemd.services.digital-twin-web` is not needed. Caddy serves `dist/apps/web/browser` from the same filesystem: `file_server` with a `try_files {path} /index.html` rewrite for the SPA routes.
- `services.caddy` with `digitaltwin.<domain>` -> `reverse_proxy /api* localhost:3000` and `file_server` for everything else. ACME handles TLS.

A `docker-compose.yml` with `postgres:16` + `pgvector/pgvector:pg16`, `ollama/ollama`, and the two app images exists for local development on machines that are not NixOS. Production target is the NixOS module. There is no Vercel, Render, Railway, or EKS in any branch of this plan.

## Configuration

`ConfigModule` validates env with Zod at boot and refuses to start on a missing key, so a misconfigured deploy fails at the unit instead of at the first request.

| Variable | Default | Notes |
| --- | --- | --- |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text` | must emit 768 |
| `OLLAMA_CHAT_MODEL` | `mistral-nemo` | |
| `OLLAMA_CHAT_FALLBACK_MODEL` | `qwen2.5-coder` | used when the question is code-shaped |
| `DATABASE_URL` | required | |
| `RETRIEVAL_TOP_K` | `6` | |
| `RETRIEVAL_MIN_SCORE` | `0.30` | |
| `CHUNK_TARGET_TOKENS` | `320` | |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | empty | empty means `FileMailer` |

No API key variable exists, because no cloud provider is in the default path.

## Trade-offs

- **Dense retrieval vs hybrid RRF.** Dense-only here, hybrid in project 02. Prose corpus, paraphrase dominates, and identifier matching does not pay for itself. Documented so the omission reads as a choice.
- **Signals vs NgRx.** Two screens, one in-flight request. Signals plus a `ChatStore` service is enough. NgRx would add four files per feature for no behavior.
- **Postgres cache vs Redis.** The corpus is about 400 chunks, static between ingests, and a single-node deploy. An HNSW lookup over 400 rows is sub-millisecond and the whole table lives in Postgres shared buffers. Adding Redis means another service to operate, another health check, and another failure mode, to cache something that is already in memory. Redis is a real answer when the corpus grows past one host or the embedding call is metered; here it is not. This is stated plainly because the previous draft added Redis with no justification, and an unexplained dependency is a bad look in a design review.
- **Streaming SSE vs a single JSON response.** SSE costs one extra code path and buys time-to-first-token. For a demo whose entire value is a recruiter watching an answer appear, that trade is worth it.
- **Angular SSR vs static build.** The page is a chat app with no per-request content. SSR would add a Node process to operate for zero SEO gain, since the corpus lives behind the chat anyway. Static build plus SPA fallback.
- **Zoneless change detection.** Enabled via `provideZonelessChangeDetection()` in Angular 20. Fewer change detection passes during token streaming. If any dependency misbehaves, the fallback is `provideZoneChangeDetection({ eventCoalescing: true })`, one line in `app.config.ts`.
- **`mistral-nemo` vs a smaller model.** `gemma3:1b` and `llama3.2:3b` are both faster and would cut the 10.6 s answer to under 4 s. They are worse at following the citation format, and citation accuracy is the thing being evaluated. Latency is published; correctness is not traded for it.

## What this proves to a hiring manager

| Piece | Competency it demonstrates |
| --- | --- |
| `vector(768)` asserted at boot against the real column type | Treats a silent dimension mismatch as a startup failure, not a runtime mystery |
| Content-hash incremental ingest | Idempotent pipelines. A one-typo fix re-embeds one chunk, not the corpus |
| Provider interfaces with one real and one fake implementation each | Abstraction at the seam that actually gets swapped, not speculative indirection |
| Score floor plus deterministic citation validation | Grounding enforced in code, not requested in a prompt |
| Structured abstention that offers three real topics | Honest degradation. "I don't know" plus a path forward, never a confident guess |
| Two-stage intent detection | Cheap deterministic filter in front of an expensive model call |
| Never sends mail without an explicit submit | Agentic behavior with a human confirmation gate |
| Correlation id from browser to Ollama, shown in the UI | Observability as a first-class feature, carried over from 6+ production APIs |
| Published latency numbers including the slow one | Reports measured behavior instead of a target nobody checked |
| Single-host NixOS deploy, Caddy, no cloud AI keys | Understands the cheapest architecture that still runs continuously |
| No Redis, with the reasoning written down | Adds a dependency only when it earns its place |

## Acceptance criteria (design-verifiable)

- [ ] `npm run ingest` on a corpus of 8 project documents is idempotent: running it twice embeds 0 new chunks, and editing one document embeds only that document's changed chunks.
- [ ] Boot fails with a named error when `chunks.embedding` is `vector(384)` or `vector(1536)`.
- [ ] `embedding <=> query` with `k = 6` returns its first result in under 25 ms at 400 chunks, measured with `EXPLAIN ANALYZE`.
- [ ] For 25 of 30 golden questions, at least one of the top-3 retrieved chunks is the chunk a human labelled as the correct source.
- [ ] Citation validator drops a marker citing source 9 when only 6 sources were retrieved, and the answer is returned as `abstain`.
- [ ] A question with no supporting content in the corpus returns `outcome: 'abstain'` plus exactly three suggestions drawn from real project titles.
- [ ] Time to first token is under 1.5 s on a warm model, measured client-side with `performance.now()`.
- [ ] The `retrieved` SSE frame arrives before the first `delta` frame in 100% of 20 runs.
- [ ] Stage-1 intent regex fires on 8 positive fixtures and does not fire on "Do you have experience with email queues?" or "Tell me about your messaging layer".
- [ ] `MailerProvider` has three implementations, and the test suite runs with `NullMailer` while dev runs with `FileMailer`.
- [ ] `POST /api/lead` rejects a malformed email with 400 and a field-level message.
- [ ] Every log line for one request carries the same `trace_id` the browser displayed, verified by grepping the journal for an id copied from the UI.
- [ ] `/healthz` returns 200 with the API up and `/readyz` returns 503 when Ollama is stopped, and 200 again when it returns.
- [ ] The NixOS module brings up postgres, ollama, the API, and Caddy from a clean `nixos-rebuild switch`, and `curl https://<host>/api/healthz` returns 200 over TLS.
- [ ] No React example, no fabricated employer, and no mention of a tool Joe used but did not build appears anywhere in the corpus or prompts.

## Open questions

- Should the corpus include a short "weak spots" document so the twin can answer honestly about gaps? Leaning yes: a twin that admits a gap is more credible than one that deflects, but it needs careful phrasing.
- Calendar booking after email capture, via a self-hosted Cal.com instance on the same host, or a simple "here are three slots" mail? Cal.com is another service to operate.
- Should answered questions be logged as analytics so the README can publish "most asked question"? It is a nice touch and a privacy question at the same time.
- Does the fallback to `qwen2.5-coder` trigger on a keyword list or on a classifier call? Keyword list for v1, measured in the eval.
