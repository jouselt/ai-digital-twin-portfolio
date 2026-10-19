# 01: AI Digital Twin Portfolio — Proposal

## Problem

Traditional resumes are static documents that recruiters spend about six seconds scanning. In 2026 a language model can generate a basic CRUD app in a single prompt, so surface-level projects no longer differentiate anyone. Recruiters need evidence of judgment, systems depth, and production awareness, and a PDF cannot carry that.

## Goal

Build an **AI digital twin**: a live portfolio that answers recruiter questions about Joe's own work, grounded in a real document corpus, and that acts when a recruiter shows intent. Two behaviours matter:

1. **Grounded answering.** Every answer is retrieved from Joe's own documents and cites the source. When the corpus does not contain the answer, the assistant says so instead of guessing.
2. **Agentic lead capture.** When a recruiter expresses intent to talk, the system extracts the essentials and sends Joe a structured summary.

## Target Recruiter Signal

A recruiter lands on the portfolio and asks "How did he handle PCI scope on the Carnival WebSocket work?" The answer arrives with a citation to a real document, not a fluent invention. The recruiter then types "I would like to talk to him" and the assistant offers to send details. Joe receives a summary with the recruiter's name, intent, and the questions they asked.

The rare part is not the chat window. It is that the system refuses when it does not know, and that it converts interest into a concrete next step without a form filling funnel.

## Constraints Measured Up Front

`context_window_size` is 4096 tokens for nearly every usable model. A `-1k` variant exists for some models with 1024. Usable input after the prompt template and output reserve is roughly 3000 to 3400 tokens.

Joe's corpus is 284,262 clean words of transcripts and project documents. A single large transcript is about 18,000 clean words, which is 7 to 8 retrieval chunks. Retrieval, not long context, is what makes this work.

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Angular 20.3, standalone components, signals | Matches `shiftify`, which already runs `@angular/core` 20.3.0. Angular is the decade-long strength worth leading with. |
| Backend | NestJS 11 on Node.js 20 | Modules map to capabilities: `RetrievalModule`, `ChatModule`, `IntentModule`, `LeadModule`. Guards, pipes, and interceptors for auth, validation, and structured logging. |
| Language | TypeScript strict | Citation objects, intent results, and lead payloads share types with the frontend through `libs/contracts`. |
| Database | PostgreSQL 16 + pgvector, `vector(768)` | One engine for relational metadata and vectors. 768 matches `nomic-embed-text`, verified on this host. |
| Embeddings | `nomic-embed-text` via Ollama | 768 dims, free per token, no data egress. |
| Generation | `mistral-nemo` via Ollama | Verified at about 17 tokens per second warm. `qwen2.5-coder` fallback for code-shaped questions. |
| Provider seam | `EmbeddingProvider` / `LlmProvider` interfaces | Local Ollama is the default. Cloud is an adapter, never a dependency. |
| Retrieval | Hybrid: HNSW cosine + `tsvector`, fused with Reciprocal Rank Fusion | Deterministic, free, and better than vector alone on short factual questions. |
| Intent | Deterministic classifier first, model second | Regex and keyword gates catch the obvious cases for free. The model only runs on ambiguous input, and its result is validated against a schema. |
| Observability | Structured JSON logs with correlation IDs, Splunk-compatible fields | Reuses the logging discipline from Disney work: `diagLog` shaped fields, correlation ID on every request. |
| Lead delivery | SMTP adapter on the homelab, SendGrid behind the same interface | The earlier draft said "residual_sendgrid", which is not a product. SendGrid is the product; local SMTP is the self-hosted default. |
| Deployment | NixOS module on the homelab, Docker Compose fallback, Caddy reverse proxy | Self-hosted and reproducible. No Vercel, Render, Railway, or EKS. |

## Scope Boundary

This project is independent from project 02. It owns its own retrieval, its own corpus, and its own deploy. It does not call the 02 API. The overlap is deliberate: two systems solving adjacent problems with the same stack proves the stack, not a shared dependency.

## Why This Differentiates a Senior Angular/NestJS Engineer

- **The assistant abstains on purpose.** A demo that answers everything is a demo that invents. Refusal is the feature that survives a technical interview.
- **Citations are validated, not requested.** Markers are parsed back out of the answer and checked against what was actually retrieved. A citation that does not resolve fails the build.
- **Intent runs deterministic-first.** Reaching for a model before trying a cheap deterministic rule is how projects get slow and expensive.
- **Hybrid retrieval in the database already required.** No second service, no extra bill, no new failure mode.
- **Correlation IDs from the first commit.** Observability is not a phase four concern. It is how the first bug gets found.
- **Angular 20.3 and NestJS 11 throughout.** The same stack as the shipped `shiftify` project, not a framework learned for a demo.

## Timeline

- **Week 1** Angular 20.3 shell with chat route. NestJS 11 API. Postgres 16 + pgvector with `vector(768)`. Ingest of the first 15 documents from the CV and project corpus.
- **Week 2** `/chat` endpoint with hybrid retrieval, RRF, citation-enforcing prompt, and `mistral-nemo` generation. Citation validator. Streaming responses in the Angular client.
- **Week 3** Intent detection with the deterministic gate first and the model second. Lead capture with schema validation, SMTP delivery, and a persisted `leads` table. Rate limiting and abuse handling on the public endpoint.
- **Week 4** Hardening, Caddy route, README with curl examples and a recruiter walkthrough, 3-minute demo video, published abstain and citation accuracy numbers.

## Acceptance Criteria

- [ ] Asking a question covered by the corpus returns an answer with at least one citation that resolves to a real document and chunk.
- [ ] Five planted unanswerable questions return an explicit abstain, 5 of 5.
- [ ] Citation validation rejects an answer whose markers do not match retrieved chunks.
- [ ] An obvious intent phrase ("I would like to talk to him") is caught by the deterministic gate without invoking the model.
- [ ] A captured lead lands in the database and triggers one email with name, intent, and the last three questions asked.
- [ ] The public endpoint is rate limited and rejects abuse with a 429 and a logged correlation ID.
- [ ] Deployed on the NixOS homelab behind Caddy over HTTPS, reachable from the portfolio site, and restarts from configuration alone.
