# AI Digital Twin

A portfolio site whose chat answers questions about real work, cites the document each
claim came from, and refuses when the answer is not in its corpus.

The interesting part is not the chat window. It is that the system abstains instead of
guessing. Every answer is retrieved from a fixed corpus of project write-ups, every
factual sentence carries a marker that resolves to a retrieved passage, and an answer
with no valid citation is discarded and replaced by a structured refusal that names
what the corpus does cover.

## Status

The product direction changed on 2026-10-19: **the model runs in the visitor's browser**
with WebLLM over WebGPU, not on a server. That removes the server from the answer path,
so retrieval, generation, citation checking and abstention all happen client side, and the
site can be served as static files.

Measured before committing to it (HuggingFace API, 2026-10-19):

| Model | Download |
|---|---|
| Qwen2.5-0.5B-Instruct-q4f16 | 290 MB |
| Llama-3.2-1B-Instruct-q4f32 | 705 MB |
| Qwen2.5-1.5B-Instruct-q4f16 | 880 MB |
| snowflake-arctic-embed-s-q0f32 | 67 MB |

The smallest viable pair is 357 MB, which is why the browser path ships with a static
fallback: a visitor without WebGPU, or on a slow connection, must still get an answer
instead of a progress bar.

Built and green:

- `libs/contracts`: wire types plus the SSE codec, so a frame shape cannot drift between
  producer and consumer (5 gate tests).
- `libs/twin-core`: the whole answer path with no framework import. Frame order, the
  guard that keeps the refusal token out of the transcript, cosine retrieval with the
  score floor, the citation gate and the three abstention reasons (29 gate tests).
- `apps/api`: the server variant, kept while the browser path is built. Its chat service
  is now a thin adapter over `@twin/core`, so the two cannot diverge (63 gate tests, 5
  skipped without a database).

Not built yet: the corpus bundle builder, the WebLLM generator, the Angular pane, evals,
and deployment.

## Stack

Versions measured from the lockfile on 2026-10-19:

| Component | Version |
|---|---|
| Angular | 20.3.34 (zoneless, standalone) |
| Angular CLI | 20.3.40 |
| NestJS | 11.0.1 (server variant) |
| Node | 22.22.3 |
| npm | 10.9.8 |
| Generation (browser) | WebLLM over WebGPU, model chosen at load |
| Embeddings (browser) | `snowflake-arctic-embed-s` via WebLLM |
| Postgres (server variant only) | 16 with pgvector |

No cloud AI key is used anywhere, and on the browser path no request leaves the machine.

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
