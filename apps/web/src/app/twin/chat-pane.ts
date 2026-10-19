import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TwinService, type TwinMessage } from './twin.service';

@Component({
  selector: 'app-chat-pane',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pane">
      <header>
        <h2>Ask about the work</h2>
        <p class="hint">
          Answers come from {{ service.projects().length }} project write-ups. Every claim cites
          the passage it came from, and the system refuses when the corpus does not cover the
          question.
        </p>
      </header>

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
    .pane { display: flex; flex-direction: column; gap: 1rem; max-width: 46rem; }
    header h2 { margin: 0 0 0.25rem; font-size: 1.1rem; }
    .hint, .adapter { margin: 0; opacity: 0.7; font-size: 0.85rem; }
    .status { font-size: 0.9rem; opacity: 0.8; }
    .status.error, .verdict.refused strong { color: #b3261e; }
    .notice { border: 1px solid #d0d0d0; border-radius: 0.5rem; padding: 0.75rem 1rem; }
    .notice ul { margin: 0.5rem 0 0; padding-left: 1.1rem; font-size: 0.9rem; }
    .loading { display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.85rem; }
    progress { width: 100%; }
    .models { border: 1px solid #d0d0d0; border-radius: 0.5rem; padding: 0.5rem 0.75rem; }
    .models legend { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; }
    .models label { display: grid; grid-template-columns: auto auto 1fr; gap: 0.25rem 0.5rem; padding: 0.35rem 0; font-size: 0.85rem; }
    .models .description { grid-column: 2 / -1; opacity: 0.7; }
    .models .chosen .label { font-weight: 600; }
    .thread { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.75rem; }
    .thread li { border-left: 3px solid #d0d0d0; padding-left: 0.75rem; }
    .thread li.question { border-color: #333; }
    .text { margin: 0 0 0.4rem; white-space: pre-wrap; }
    .sources { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.8rem; }
    .sources .marker { font-weight: 600; margin-right: 0.35rem; }
    .sources .score { opacity: 0.6; margin-left: 0.35rem; }
    .verdict { margin: 0.4rem 0 0; font-size: 0.8rem; }
    .verdict.grounded { color: #1b5e20; }
    .refused ul { margin: 0.35rem 0; padding-left: 1.1rem; }
    .trace { opacity: 0.6; }
    form { display: flex; gap: 0.5rem; }
    form input { flex: 1; padding: 0.5rem; }
    form button { padding: 0.5rem 0.9rem; }
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
        return 'The model or the corpus failed mid-request. Try again.';
      default:
        return 'The question may be outside the projects written up here. Try one of these:';
    }
  }
}
