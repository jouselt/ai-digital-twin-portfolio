# AI Digital Twin

A portfolio whose chat answers questions about real project work, and refuses when the
written record does not support an answer.

**Live:** https://jouselt.github.io/ai-digital-twin-portfolio/

Three properties, each of which most portfolio chatbots skip:

1. **Every factual sentence carries a citation** that resolves to the passage it came
   from, and the passage is openable in the page.
2. **The system refuses** when the corpus does not cover the question, and names what
   is missing instead of apologising vaguely.
3. **The answer path is observable**: a trace id, the passages retrieved, a grounding
   verdict, and the latency of the compute.

The model runs in the visitor's browser on WebGPU. No server, no API key, no cost per
question, and nothing typed leaves the machine.

## How it works

```
corpus/projects/*.md        9 written project records, front matter + prose
        |
        v  build step (npm run bundle)
corpus/bundle.json          38 chunks, 44.8 KB, no vectors, content-hashed
        |
        v  first visit, in the browser
snowflake-arctic-embed-s    embeds every chunk once, cached in IndexedDB by bundle hash
        |
        v  per question
cosine retrieval            top 6 passages above a floor
        |
        v
Qwen2.5 in WebLLM           streams an answer that must cite [n]
        |
        v
citation validator          every marker resolves?  -> done
                            no markers at all?       -> no_citations
                            marker that is not real? -> unknown_citations
                            markers with no prose?   -> no_prose
        |
        v
extractive fallback         if the model failed but a passage matches the question,
                            quote it and label it "Quoted from the record, not generated"
```

Deterministic guards run before and after the model:

- **intent**: a greeting or a question about the tool is answered from a canned text,
  with no model load at all.
- **coverage**: a company the corpus never mentions is refused immediately. Measured
  reason this exists: "What did he ship for Carnival?" (covered) scored 0.73 and
  "What did he ship for autodesk?" (not in the corpus) scored 0.71 to 0.74. Cosine
  similarity on nine documents does not separate the two, so no threshold ever fires.
- **prose**: markers alone are not a claim. The guard once approved an answer whose
  entire text was `[1][4]`.

## Measured, not claimed

The evals ask whether the visitor got the promised behaviour: a cited answer, a refusal
that names the missing record, a canned intro, or an honest abstention. Fourteen cases,
run in a real browser against the real model.

| Model | Download | Cases passed | Covered questions answered |
|---|---|---|---|
| Qwen2.5-0.5B (Fast, default) | 290 MB | 14/14 | 6 of 6 (4 generated, 2 quoted) |
| Qwen2.5-1.5B (Better) | 880 MB | 11/14 | 3 of 6 |
| Qwen2.5-3B (Best) | 1748 MB | not measured | — |

**The bigger model scored lower, and that is the interesting result.** The 1.5B refused
three covered questions by emitting the refusal token, where the 0.5B answered them. Its
answers were also about half as long. Being more cautious is not being more correct: on a
nine-document corpus the larger model reads the retrieval as insufficient evidence and
declines. Fast is the default because it measured better, not because it is smaller.

Raw runs live in `evals/results/`, with the caveat written into each file. Two apply:
each row is a single run at temperature 0.2, so one run is an anecdote rather than a
measurement, and `?runs=3` exists to measure the variance. And what the 14/14 supports is
that the product always returns evidence, not that the small model always writes.

The model is selectable in the page: `?model=better`, and `?runs=2` to repeat the set.

## Cost of all this, in bytes

| What | Raw | Over the wire |
|---|---|---|
| Page (initial) | 277 kB | 75 kB |
| WebLLM runtime, lazy | 6.15 MB | 1.46 MB |
| Embedding model, once | 67 MB | — |
| Chat model, once | 290 MB | — |

A visitor without WebGPU downloads 75 kB and gets the readable project index. Nothing
downloads a model until it is asked to answer. Getting this split required building the
shared libraries as both ESM and CommonJS: esbuild cannot code-split a CommonJS dist,
and the whole 6.4 MB was landing in the initial bundle.

## Run it

```bash
npm ci
npm run build:libs          # @twin/contracts and @twin/core
npm run bundle              # corpus -> apps/web/public/corpus/bundle.json
npm run --workspace @twin/web start
```

Tests, all deterministic and requiring no model:

```bash
npm run test:core           # 62 tests
npm run test:web            # 26 tests, Karma + headless Chrome
npm run typecheck
npm test                    # everything, including the legacy API
```

The eval needs a browser with WebGPU (it will not run in CI):

```
https://jouselt.github.io/ai-digital-twin-portfolio/?eval=1
```

## Repository layout

```
libs/contracts      wire types and the SSE codec
libs/twin-core      the whole answer path: retrieval, prompt, citations, guards, WebLLM ports
apps/web            Angular 20 client, the product
apps/api            NestJS 11 server variant (legacy path, kept green)
corpus/projects     the nine records everything is retrieved from
evals               golden set, scoring, recorded runs
odd/tasks           the feature document this work was tracked in
```

`libs/twin-core` holds a single implementation of the answer path. `apps/api` is a thin
adapter over it, not a second copy: two copies of a citation guard diverge within a
week.

## What this does not do

- It does not answer from the model's general knowledge. Ask about a company that is not
  in the corpus and it tells you so.
- The 0.5B model writes citable prose roughly two thirds of the time. The fallback covers
  the rest by quoting. That is the trade for a 290 MB download.
- Refusal is evidence-driven, not topic-driven: personal questions are refused because
  nothing in the record cites them, not because a list says so.
