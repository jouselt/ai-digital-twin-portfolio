# AI Digital Twin

A portfolio site whose chat answers questions about real work, cites the document each
claim came from, and refuses when the answer is not in its corpus.

The interesting part is not the chat window. It is that the system abstains instead of
guessing. Every answer is retrieved from a fixed corpus of project write-ups, every
factual sentence carries a marker that resolves to a retrieved passage, and an answer
with no valid citation is discarded and replaced by a structured refusal that names
what the corpus does cover.

## Status

Walking skeleton in progress. See `tasks.md`, Phase 0, for the slice being built and the
gates that define it.

Built and green:

- `libs/contracts`: wire types plus the SSE codec both apps share, so a frame shape
  cannot drift between server and client (5 gate tests).
- `apps/api` citation validator: parses `[n]` markers, drops ids that were never
  retrieved, computes groundedness, treats an answer with no markers as ungrounded
  (8 gate tests).

Not built yet: embedding and LLM providers, ingest, retrieval, the streaming chat
endpoint, the Angular pane, and deployment. `tasks.md` Phase 1 onward is the plan of
record.

## Stack

Versions measured from the lockfile on 2026-10-19:

| Component | Version |
|---|---|
| Angular | 20.3.34 (zoneless, standalone) |
| Angular CLI | 20.3.40 |
| NestJS | 11.0.1 |
| Node | 22.22.3 |
| npm | 10.9.8 |
| Postgres (planned) | 16 with pgvector |
| Embeddings (planned) | `nomic-embed-text` via local Ollama, 768 dimensions |
| Generation (planned) | `mistral-nemo` via local Ollama |

No cloud AI key is used anywhere. Inference runs against Ollama on the same host.

## Layout

```
apps/web              Angular application
apps/api              NestJS application
apps/api/migrations   SQL migrations, idempotent, applied with psql
libs/contracts        wire types and the SSE codec, no framework imports
infra/nixos           NixOS module (planned)
corpus/projects       source documents that become chunks (planned)
```

## Commands

```bash
npm install
npm run typecheck         # contracts build + tsc over api, web and test files
npm run test:contracts    # contract gate tests
npm run --workspace @twin/api test

# local database: Postgres 16 + pgvector in Docker, never on 5432
npm run db:up             # docker compose up -d postgres
npm run db:migrate        # applies apps/api/migrations/*.sql, safe to re-run
npm run test:db           # the real-database suite against that container
```

The database suite is skipped, not failed, when `DATABASE_URL` is unset, so the default
test run needs no services.

## Design constraints that shape the code

`chunks.embedding` is `vector(768)` because the embedding model emits 768 values. The
width is asserted at boot against the actual column, not assumed.

Usable context is about 3200 tokens, so retrieval rather than long context is what makes
a grounded answer possible. Chunks are packed to 320 tokens with a 60-token context
prefix from the previous chunk, and six retrieved chunks fit in the prompt with room for
the answer.

`RETRIEVAL_MIN_SCORE` is 0.30 cosine similarity. Results below it never reach the model,
and an empty result set produces an abstention instead of an empty prompt.

`MAX_TOKENS_CAP` is 220. A caller asking for more is clamped.
