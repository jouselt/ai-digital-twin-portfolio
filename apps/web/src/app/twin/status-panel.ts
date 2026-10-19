import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { MODEL_CHOICES } from '@twin/core';

import { TwinService } from './twin.service';

/**
 * The twin's own telemetry.
 *
 * A chat that hides how it works cannot be debugged by the person looking at it, and
 * "it runs in your browser" is a claim until the page shows which CPU, which model and
 * what it cost. Local compute is labelled as local: these milliseconds are the
 * visitor's GPU, not a network.
 */
@Component({
  selector: 'app-status-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel" aria-label="How this answer was produced">
      <dl>
        <div>
          <dt>Compute</dt>
          <dd>
            @if (service.capability()?.adapter; as adapter) {
              {{ adapter.vendor }} {{ adapter.architecture }} · your device
            } @else {
              not detected
            }
          </dd>
        </div>

        <div>
          <dt>Model</dt>
          <dd>{{ modelLabel() }}</dd>
        </div>

        <div>
          <dt>Corpus</dt>
          <dd>{{ service.projects().length }} projects · bundle {{ shortHash() }}</dd>
        </div>

        @if (service.timings(); as timings) {
          <div>
            <dt>First token</dt>
            <dd>{{ timings.firstTokenMs === null ? 'n/a' : timings.firstTokenMs + ' ms' }}</dd>
          </div>
          <div>
            <dt>Full answer</dt>
            <dd>{{ timings.totalMs }} ms · {{ timings.tokensOut }} tokens</dd>
          </div>
        }

        @if (lastTrace(); as trace) {
          <div class="trace-row">
            <dt>Trace</dt>
            <dd>
              <code>{{ trace }}</code>
              <button type="button" class="copy" (click)="copyTrace(trace)">
                {{ copied() ? 'copied' : 'copy' }}
              </button>
            </dd>
          </div>
        }
      </dl>
    </section>
  `,
  styles: `
    .panel {
      padding: 1rem 1.25rem;
      background: var(--surface-alt);
      border: 1px solid rgba(216, 209, 193, 0.8);
      border-radius: var(--radius);
    }

    dl {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
      gap: 0.75rem 1.5rem;
      margin: 0;
    }

    dt {
      color: var(--brand-deep);
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.07em;
      text-transform: uppercase;
    }

    dd {
      margin: 0.15rem 0 0;
      font-size: 0.88rem;
      color: var(--ink-soft);
    }

    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.78rem;
      word-break: break-all;
    }

    .trace-row dd {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .copy {
      padding: 0.1rem 0.5rem;
      background: transparent;
      border: 1px solid var(--line);
      border-radius: 999px;
      color: var(--brand-deep);
      font: inherit;
      font-size: 0.72rem;
      font-weight: 700;
      cursor: pointer;
    }

    .copy:hover,
    .copy:focus-visible {
      border-color: var(--brand);
    }
  `,
})
export class StatusPanel {
  readonly service = inject(TwinService);
  readonly copied = signal(false);

  readonly modelLabel = computed(() => {
    const choice = MODEL_CHOICES.find((candidate) => candidate.id === this.service.modelId());
    return choice === undefined ? this.service.modelId() : `${choice.label} · ${choice.downloadMb} MB`;
  });

  readonly shortHash = computed(() => (this.service.bundleHash() ?? '').slice(0, 8) || 'n/a');

  /** The trace id of the most recent answer, which is the one worth copying. */
  readonly lastTrace = computed(() => {
    const messages = this.service.messages();
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const trace = messages[index]?.traceId;
      if (trace !== null && trace !== undefined) return trace;
    }
    return null;
  });

  async copyTrace(trace: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(trace);
      this.copied.set(true);
    } catch {
      this.copied.set(false);
    }
  }
}
