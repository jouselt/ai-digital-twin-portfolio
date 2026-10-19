import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';

import { MODEL_CHOICES } from '@twin/core';

import { TwinService } from '../twin/twin.service';

import { summarize, scoreCase, type CaseResult, type EvalSummary } from './eval-runner';
import { GOLDEN_SET } from './golden-set';

/**
 * The eval page, reachable at `?eval=1`.
 *
 * It drives the real service with the real model, so the numbers come from the
 * thing a visitor gets, not from a mock. Sequential on purpose: one engine, one
 * question at a time, no interleaved traces.
 */
@Component({
  selector: 'app-eval-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="eval">
      <p class="eyebrow">Eval run</p>
      <h1>{{ GOLDEN_SET.length }} cases, real model, real corpus</h1>
      <p class="hint">
        Measured model: <strong>{{ service.modelId() }}</strong>
        @if (requestedModel !== '') {
          <span> (from the URL)</span>
        }
      </p>
      <p class="lead">
        Each case asks whether the visitor got the behaviour the product promises: a cited
        answer, a refusal that names the missing record, a canned intro, or an honest
        abstention.
      </p>

      @if (running()) {
        <div class="progress-block">
          <p class="status">Running {{ done() }} of {{ planned() }}…</p>

          @if (service.status() === 'probing') {
            <p class="hint">Checking what this browser can run.</p>
          }

          @if (service.status() === 'loading') {
            <progress [value]="service.progress()" max="1"></progress>
            <p class="hint">
              {{ service.progressText() }} — the first run downloads about 357 MB of model, once.
              The questions start as soon as it finishes.
            </p>
          }

          @if (service.status() === 'fallback') {
            <p class="hint broken">{{ service.capability()?.message }}</p>
          }

          @if (service.status() === 'error') {
            <p class="hint broken">{{ service.error() }}</p>
          }
        </div>
      }

      @if (broken()) {
        <p class="broken">
          {{ broken() }} cases failed inside the request itself, not in the answer path. That is an
          environment problem (model download or GPU), not a product result: the score below
          undercounts what the twin does.
        </p>
      }

      @if (summary(); as result) {
        <div class="score">
          <strong>{{ result.passed }} / {{ result.total }}</strong>
          <span>{{ (result.rate * 100).toFixed(0) }}%</span>
        </div>

        <ul class="groups">
          @for (group of result.byExpectation; track group.expect) {
            <li>
              <span class="tag">{{ group.expect }}</span>
              <span>{{ group.passed }} / {{ group.total }}</span>
            </li>
          }
        </ul>
      }

      <table>
        <thead>
          <tr><th>Case</th><th>Expected</th><th>Got</th><th>Verdict</th><th>Answer the visitor read</th><th>Raw error</th></tr>
        </thead>
        <tbody>
          <!-- track $index: with ?runs=N the same case repeats, so ids are not unique. -->
          @for (row of results(); track $index) {
            <tr [class.failed]="!row.passed">
              <td>{{ row.question }}</td>
              <td>{{ row.expect }}</td>
              <td>{{ row.got }}</td>
              <td>{{ row.detail }}</td>
              <td class="answer">{{ row.answer }}</td>
              <td class="error">{{ row.error }}</td>
            </tr>
          }
        </tbody>
      </table>

      @if (summary()) {
        <button type="button" class="button button-secondary" (click)="copy()">
          {{ copied() ? 'Copied' : 'Copy JSON' }}
        </button>
      }
    </section>
  `,
  styles: `
    .eval {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
      max-width: 70rem;
    }

    h1 {
      margin: 0;
      font-size: clamp(1.5rem, 2.6vw, 2.2rem);
    }

    .lead {
      margin: 0;
      max-width: 52rem;
      color: var(--ink-soft);
    }

    .progress-block {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }

    progress {
      width: 100%;
      height: 0.5rem;
      accent-color: var(--brand);
    }

    .hint {
      margin: 0;
      color: var(--muted);
      font-size: 0.9rem;
    }

    .status {
      margin: 0;
      color: var(--brand-deep);
      font-weight: 600;
    }

    .score {
      display: flex;
      align-items: baseline;
      gap: 0.6rem;
    }

    .score strong {
      font-size: 2.2rem;
      line-height: 1;
    }

    .score span {
      color: var(--brand-deep);
      font-weight: 700;
    }

    .groups {
      display: flex;
      flex-wrap: wrap;
      gap: 0.6rem 1.2rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .groups li {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.9rem;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--surface-strong);
      border: 1px solid rgba(216, 209, 193, 0.9);
      border-radius: var(--radius);
      overflow: hidden;
      font-size: 0.86rem;
    }

    th,
    td {
      padding: 0.6rem 0.75rem;
      text-align: left;
      vertical-align: top;
      border-bottom: 1px solid rgba(216, 209, 193, 0.6);
    }

    th {
      background: var(--surface-alt);
      font-size: 0.75rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--brand-deep);
    }

    .error {
      max-width: 22rem;
      font-size: 0.78rem;
      color: #a3282f;
      word-break: break-word;
    }

    .broken {
      margin: 0;
      padding: 0.9rem 1rem;
      background: rgba(239, 123, 132, 0.12);
      border-left: 4px solid var(--accent);
      border-radius: 10px;
      color: var(--ink-soft);
    }

    tr.failed td {
      background: rgba(239, 123, 132, 0.1);
    }
  `,
})
export class EvalPage implements OnInit {
  readonly service = inject(TwinService);
  readonly GOLDEN_SET = GOLDEN_SET;
  readonly results = signal<readonly CaseResult[]>([]);
  readonly summary = signal<EvalSummary | null>(null);
  readonly running = signal(false);
  readonly done = signal(0);
  readonly planned = signal(GOLDEN_SET.length);
  readonly copied = signal(false);
  readonly broken = signal(0);
  /** `?runs=` repeats the whole set; one run at temperature 0.2 is an anecdote. */
  readonly runs = (() => {
    if (typeof location === 'undefined') return 1;
    const raw = Number.parseInt(new URLSearchParams(location.search).get('runs') ?? '1', 10);
    return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 5) : 1;
  })();

  /** `?model=` selects which chat model is measured; empty means the default. */
  readonly requestedModel =
    typeof location === 'undefined' ? '' : (new URLSearchParams(location.search).get('model') ?? '');

  ngOnInit(): void {
    void this.run();
  }

  async run(): Promise<void> {
    if (this.running()) return;
    this.running.set(true);
    this.results.set([]);
    this.summary.set(null);

    await this.service.init();

    // Choosing before the corpus loads costs nothing: the vectors belong to the
    // embedding model, which does not change with the chat model.
    const choice = MODEL_CHOICES.find((candidate) => {
      const wanted = this.requestedModel.toLowerCase();
      if (wanted === '') return false;
      return candidate.id.toLowerCase().includes(wanted) || candidate.label.toLowerCase() === wanted;
    });
    if (choice !== undefined && choice.id !== this.service.modelId()) {
      this.service.chooseModel(choice.id);
    }

    const collected: CaseResult[] = [];
    const total = GOLDEN_SET.length * this.runs;
    for (let run = 0; run < this.runs; run += 1) {
      for (const testCase of GOLDEN_SET) {
        await this.service.ask(testCase.question);
        const answer = this.service.messages().at(-1);
        collected.push(scoreCase(testCase, answer));
        this.results.set([...collected]);
        this.done.set(collected.length);
        this.planned.set(total);
      }
    }

    this.summary.set(summarize(collected));
    this.broken.set(collected.filter((row) => row.error.length > 0).length);
    this.running.set(false);
    (globalThis as { __TWIN_EVAL__?: unknown }).__TWIN_EVAL__ = {
      summary: this.summary(),
      results: collected,
      runs: this.runs,
      model: this.service.modelId(),
      adapter: this.service.capability()?.adapter,
    };
  }

  async copy(): Promise<void> {
    const payload = JSON.stringify({ summary: this.summary(), results: this.results() }, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      this.copied.set(true);
    } catch {
      this.copied.set(false);
    }
  }
}
