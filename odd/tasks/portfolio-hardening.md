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
announced once, on completion, never per token. Every control is reachable and
labelled, and text meets WCAG AA contrast.

Amended during implementation: focus stays in the question input when an answer
finishes, instead of moving to the answer. Yanking focus mid-conversation steals
the caret from someone already typing a follow-up, which is worse for the keyboard
user it was meant to help. The answer is announced through the live region, the
thread is a skip-link target, and the citations inside it are buttons.

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
- T3 Third model option and the recorded rows. Covers S5. Status: done. Two rows
  recorded (`fast-qwen-0.5b.json` 14/14, `better-qwen-1.5b.json` 11/14); the 3B is
  offered but unmeasured and the README says so. Default stays Fast because it
  measured better, which inverts the expected answer: the 1.5B declines on three
  covered questions. Recorded in `odd/` rather than the README alone because the
  reasoning matters more than the number.
- T4 Telemetry panel and first-token timing. Covers S3. Status: done. 3 Karma tests.
- T5 Accessibility pass. Covers S4. Status: done. Contrast measured, not eyeballed:
  white on --brand was 3.41:1, so the primary button moved to --brand-deep (5.82:1).
  2 Karma tests, one of which holds an answer mid-stream and asserts the live region
  stays empty.

## Log

L1 (user, verbatim): "Sigamos tus recomendaciones, la fase 6 no la quiero implementar. Pero de la 1 a la 5 esta ok."

L2: baseline before this work. Eval on an iPad with WebGPU: 14/14 with
Qwen2.5-0.5B; 4 of the 6 covered cases generated prose, 2 were answered by the
extractive fallback. Recorded in `evals/results/fast-qwen-0.5b.json`.

L3: contrast was computed for every text pair in the palette. Two failures found:
white on #1c9c87 at 3.41:1 (the primary button) and --accent at 2.68:1 on white,
which is only used for decorative borders and bullet glyphs, so it stays. The
button now uses the darker green already present in the portfolio palette.

L4: the second row inverted the assumption. The 1.5B passed 11/14 against the 0.5B's
14/14, declining three covered questions with model_declined and writing answers half
the length. Left in the table as found. The eval now accepts ?runs=N, because two
single runs at temperature 0.2 are anecdotes, not a measurement.
