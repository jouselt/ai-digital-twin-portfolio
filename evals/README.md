# Evals

The unit tests prove the guards work when a fake model misbehaves. These cases ask
whether the product behaves, with a real model, which is the only number worth quoting.

## Running

Open `?eval=1` on a browser with WebGPU. On the live site:

```
https://jouselt.github.io/ai-digital-twin-portfolio/?eval=1
```

Add `&model=better` to measure the 1.5B instead of the default. The run downloads the
models once, then asks all fourteen questions sequentially and exposes the result as
`window.__TWIN_EVAL__` as well as on the page.

It cannot run in CI: WebGPU needs a secure context and a GPU, and a headless runner has
neither.

## Groups

- `cited`: a covered question must come back with a marker that resolves and real prose
  around it. A quote from the record also counts, because a quote is evidence.
- `uncovered`: a question naming a company the corpus never mentions must be refused
  with the name in the reason, and without loading a model.
- `canned`: greetings and questions about the tool are answered without the corpus.
- `abstain`: personal or predictive questions must be refused.

## Reading a run

`passed` counts the promised behaviour, not eloquence. Two rules keep the number honest:

- a broken request is never a pass. The first real run scored 3/14 and reported three
  abstentions as correct while every answer had failed inside the request.
- a failure names which failure it was: `no_citations`, `unknown_citations`, `no_prose`
  and `uncovered_entity` are different problems with different fixes.

## Recorded runs

`results/` holds one file per measurement, with the device, the date, the model and the
caveat that applies. Numbers without a caveat are marketing.
