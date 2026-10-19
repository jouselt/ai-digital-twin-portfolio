# Portfolio hardening

Objective: turn a working twin into a project that explains and proves itself.
Branch: main (delivery: ask-on-risk). Test runner: jest (libs, api) + Karma/ChromeHeadless (web).

## Specs

S1. The repository explains itself. `README.md` states the problem, the flow, why
refusal is the feature, the measured model table, how to run the evals, and the
live URL. Every command in it is executed at least once before publishing.

S2. Citations are verifiable by the visitor. Every `[n]` marker is openable and
shows the exact passage that was sent to the model, with project, section and
score. Not a reconstruction: the same `SourceRef` object.

S3. The twin shows its own telemetry: adapter, model, bundle hash, copyable
`trace_id`, time to first token, total latency, output tokens. Local compute is
labelled as such, not confused with network latency.

S4. The page is usable with a keyboard and a screen reader. Streaming answers are
announced once, on completion, never per token. Focus moves to the answer when it
finishes and to the input on load.

S5. The default model is chosen from measurements, not taste: at least two model
rows recorded as JSON under `evals/results/`, and the README states which default
those rows justify.

Out of scope (explicitly declined by the user): a deterministic banned-topics
list. Refusal stays evidence-driven.

## Tasks

- T1 README + evals/README. Covers S1. Status: done. README commands verified: npm ci
  runs in the Pages workflow on every push; build:libs, bundle, test:core, test:web and
  typecheck were run locally for this commit.
- T2 Clickable citations. Covers S2. Status: done. 3 Karma tests, including one that
  compares the shown passage to the retrieved content verbatim.
- T3 Third model option and the recorded rows. Covers S5. Status: pending.
- T4 Telemetry panel and first-token timing. Covers S3. Status: pending.
- T5 Accessibility pass. Covers S4. Status: pending.

## Log

L1 (user, verbatim): "Sigamos tus recomendaciones, la fase 6 no la quiero implementar. Pero de la 1 a la 5 esta ok."

L2: baseline before this work. Eval on an iPad with WebGPU: 14/14 with
Qwen2.5-0.5B; 4 of the 6 covered cases generated prose, 2 were answered by the
extractive fallback. Recorded in `evals/results/fast-qwen-0.5b.json`.
