import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TwinService, type TwinMessage } from './twin.service';

@Component({
  selector: 'app-chat-pane',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pane">
      <header class="pane-head">
        <p class="eyebrow">Grounded chat</p>
        <h2>Ask about the work</h2>
        <p class="hint">
          {{ service.projects().length }} project records are indexed. Every claim cites the
          passage it came from, and the system refuses when the records do not cover the
          question.
        </p>
      </header>

      @if (service.projects().length > 0 && service.status() !== 'fallback') {
        <ul class="corpus">
          @for (project of service.projects(); track project.id) {
            <li class="corpus-card">
              <span class="tag">{{ project.client }}</span>
              <strong>{{ project.title }}</strong>
              <span class="corpus-meta">{{ project.role }} · {{ project.period }}</span>
            </li>
          }
        </ul>
      }

      @if (service.status() === 'probing') {
        <p class="status">Checking what this browser can run.</p>
      }

      @if (service.status() === 'fallback') {
        <div class="notice" role="status">
          <strong>The model cannot run in this browser.</strong>
          <p>{{ service.capability()?.message }}</p>
          <p>The project write-ups are all still readable here:</p>
          <ul>
            @for (project of service.projects(); track project.id) {
              <li>{{ project.title }} · {{ project.client }} · {{ project.period }}</li>
            }
          </ul>
        </div>
      }

      @if (service.status() === 'error') {
        <p class="status error">{{ service.error() }}</p>
      }

      @if (service.status() === 'loading') {
        <div class="loading" role="status">
          <progress [value]="service.progress()" max="1"></progress>
          <span>{{ service.progressText() }}</span>
        </div>
      }

      @if (service.status() === 'ready' || service.status() === 'loading') {
        <fieldset class="models">
          <legend>Model</legend>
          @for (model of service.models; track model.id) {
            <label [class.chosen]="model.id === service.modelId()">
              <input
                type="radio"
                name="model"
                [value]="model.id"
                [checked]="model.id === service.modelId()"
                (change)="service.chooseModel(model.id)"
                [disabled]="service.busy()"
              />
              <span class="label">{{ model.label }}</span>
              <span class="size">{{ model.downloadMb }} MB</span>
              <span class="description">{{ model.description }}</span>
            </label>
          }
        </fieldset>
      }

      <ol class="thread">
        @for (message of service.messages(); track $index) {
          <li [class.question]="message.role === 'user'" [class.answer]="message.role === 'assistant'">
            <p class="text">{{ message.text }}</p>

            @if (message.sources.length > 0) {
              <ul class="sources">
                @for (source of message.sources; track source.chunkId; let position = $index) {
                  <li>
                    <span class="marker">[{{ position + 1 }}]</span>
                    <span class="where">{{ source.title }} · {{ source.section }}</span>
                    <span class="score">{{ source.score.toFixed(2) }}</span>
                  </li>
                }
              </ul>
            }

            @if (message.terminal?.kind === 'done') {
              <p class="verdict grounded">
                Grounded · every citation resolved · {{ message.traceId }}
              </p>
            }

            @if (message.terminal?.kind === 'abstain') {
              <div class="verdict refused">
                <strong>{{ refusalTitle(message) }}</strong>
                <p>{{ refusalDetail(message) }}</p>
                @if (message.terminal?.detail) {
                  <details class="detail">
                    <summary>Technical detail</summary>
                    <code>{{ message.terminal?.detail }}</code>
                  </details>
                }
                @if (message.terminal?.suggestions?.length) {
                  <ul>
                    @for (suggestion of message.terminal?.suggestions; track suggestion) {
                      <li>{{ suggestion }}</li>
                    }
                  </ul>
                }
                <p class="trace">trace {{ message.traceId }}</p>
              </div>
            }
          </li>
        }
      </ol>

      @if (service.status() === 'ready') {
        <form (ngSubmit)="submit()">
          <input
            name="question"
            [ngModel]="question()"
            (ngModelChange)="question.set($event)"
            placeholder="What did he ship for Carnival?"
            [disabled]="service.busy()"
            autocomplete="off"
          />
          @if (service.busy()) {
            <button type="button" (click)="service.cancel()">Stop</button>
          } @else {
            <button type="submit" [disabled]="question().trim().length === 0">Ask</button>
          }
        </form>
      }

      @if (service.error() !== null && service.status() !== 'error') {
        <p class="status error">{{ service.error() }}</p>
      }

      @if (service.capability()?.adapter; as adapter) {
        <p class="adapter">running on {{ adapter.vendor }} · {{ adapter.architecture }}</p>
      }
    </section>
  `,
  styles: `
    .pane {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .pane-head {
      max-width: 46rem;
    }

    .pane-head h2 {
      margin: 0.35rem 0 0.6rem;
      font-size: clamp(1.5rem, 2.4vw, 2.1rem);
      line-height: 1.15;
    }

    .hint {
      margin: 0;
      color: var(--ink-soft);
    }

    .corpus {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
      gap: 0.75rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .corpus-card {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      padding: 1rem;
      background: var(--surface);
      border: 1px solid rgba(216, 209, 193, 0.9);
      border-radius: var(--radius);
    }

    .corpus-card strong {
      font-size: 0.98rem;
      line-height: 1.3;
    }

    .corpus-meta {
      color: var(--muted);
      font-size: 0.82rem;
    }

    .status {
      margin: 0;
      color: var(--muted);
      font-size: 0.95rem;
    }

    .status.error {
      color: #a3282f;
    }

    .notice {
      padding: 1.25rem;
      background: var(--surface-strong);
      border: 1px solid rgba(216, 209, 193, 0.9);
      border-left: 4px solid var(--accent);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
    }

    .notice p {
      margin: 0.5rem 0 0;
      color: var(--ink-soft);
    }

    .notice ul {
      margin: 0.6rem 0 0;
      padding-left: 1.1rem;
      color: var(--muted);
      font-size: 0.92rem;
    }

    .loading {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      color: var(--muted);
      font-size: 0.9rem;
    }

    progress {
      width: 100%;
      height: 0.5rem;
      accent-color: var(--brand);
    }

    .models {
      display: grid;
      gap: 0.5rem;
      margin: 0;
      padding: 1rem 1.25rem;
      background: var(--surface);
      border: 1px solid rgba(216, 209, 193, 0.9);
      border-radius: var(--radius);
    }

    .models legend {
      padding: 0 0.4rem;
      color: var(--brand-deep);
      font-size: 0.78rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .models label {
      display: grid;
      grid-template-columns: auto auto 1fr;
      align-items: center;
      gap: 0.25rem 0.55rem;
      padding: 0.45rem 0;
      font-size: 0.92rem;
    }

    .models .label {
      font-weight: 600;
    }

    .models .size {
      justify-self: start;
    }

    .models .description {
      grid-column: 2 / -1;
      color: var(--muted);
      font-size: 0.84rem;
    }

    .models .chosen {
      background: rgba(28, 156, 135, 0.07);
      border-radius: 10px;
      padding-inline: 0.5rem;
    }

    .thread {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .thread li {
      padding: 1.25rem;
      background: var(--surface-strong);
      border: 1px solid rgba(216, 209, 193, 0.9);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
    }

    .thread li.question {
      background: var(--surface-alt);
      box-shadow: none;
    }

    .text {
      margin: 0;
      white-space: pre-wrap;
      line-height: 1.6;
    }

    .sources {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      margin: 1rem 0 0;
      padding: 0;
      list-style: none;
    }

    .sources li {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      padding: 0.5rem 0.7rem;
      background: var(--surface-alt);
      border-radius: 10px;
      box-shadow: none;
      border: 1px solid rgba(216, 209, 193, 0.7);
      font-size: 0.84rem;
    }

    .sources .marker {
      font-weight: 700;
      color: var(--brand-deep);
    }

    .sources .where {
      flex: 1;
      color: var(--ink-soft);
    }

    .sources .score {
      color: var(--brand-deep);
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }

    .verdict {
      margin: 1rem 0 0;
      padding-top: 0.9rem;
      border-top: 1px solid var(--line);
      font-size: 0.85rem;
    }

    .verdict.grounded {
      color: var(--brand-deep);
      font-weight: 600;
    }

    .refused strong {
      display: block;
      color: #a3282f;
      margin-bottom: 0.35rem;
    }

    .refused p {
      margin: 0;
      color: var(--ink-soft);
    }

    .refused ul {
      margin: 0.5rem 0 0;
      padding-left: 1.1rem;
      color: var(--brand-deep);
      font-weight: 600;
    }

    .detail {
      margin: 0.5rem 0 0;
      font-size: 0.78rem;
    }

    .detail summary {
      cursor: pointer;
      font-weight: 600;
      color: var(--muted);
    }

    .detail code {
      display: block;
      margin-top: 0.35rem;
      padding: 0.6rem;
      background: rgba(36, 48, 58, 0.06);
      border-radius: 10px;
      word-break: break-word;
    }

    .trace {
      margin: 0.5rem 0 0;
      color: var(--muted);
      font-size: 0.78rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }

    form {
      display: flex;
      gap: 0.6rem;
      flex-wrap: wrap;
    }

    form input {
      flex: 1 1 18rem;
      min-height: 3rem;
      padding: 0.75rem 1rem;
      font: inherit;
      color: var(--text);
      background: var(--surface-strong);
      border: 1px solid var(--line);
      border-radius: 999px;
    }

    form input:focus-visible {
      outline: 2px solid var(--brand);
      outline-offset: 1px;
      border-color: var(--brand);
    }

    form button {
      min-height: 3rem;
      padding: 0.8rem 1.4rem;
      border-radius: 999px;
      border: 1px solid transparent;
      background: var(--brand);
      color: #fff;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }

    form button:hover:not(:disabled) {
      background: var(--brand-deep);
    }

    form button:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }

    .adapter {
      margin: 0;
      color: var(--muted);
      font-size: 0.8rem;
    }
  `,
})
export class ChatPane implements OnInit {
  readonly service = inject(TwinService);
  readonly question = signal('');
  readonly ready = computed(() => this.service.status() === 'ready');

  ngOnInit(): void {
    void this.service.init();
  }

  submit(): void {
    const value = this.question();
    this.question.set('');
    void this.service.ask(value);
  }

  refusalTitle(message: TwinMessage): string {
    switch (message.terminal?.reason) {
      case 'model_declined':
        return 'The model declined to answer.';
      case 'ungrounded_citations':
        return 'That answer could not be grounded, so it was discarded.';
      case 'request_failed':
        return 'Something failed while answering.';
      default:
        return 'Nothing in the corpus covers that.';
    }
  }

  refusalDetail(message: TwinMessage): string {
    switch (message.terminal?.reason) {
      case 'model_declined':
        return 'The passages retrieved do not actually answer the question.';
      case 'ungrounded_citations':
        return 'The answer cited a passage that was never retrieved, which is how a guess looks.';
      case 'request_failed':
        return 'The model or the corpus failed mid-request. The message below is the raw error.';
      default:
        return 'The question may be outside the projects written up here. Try one of these:';
    }
  }
}
