import { ChangeDetectionStrategy, Component } from '@angular/core';

import { ChatPane } from './twin/chat-pane';

@Component({
  selector: 'app-root',
  imports: [ChatPane],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="shell">
      <h1>AI Digital Twin</h1>
      <p class="lede">
        A portfolio whose chat answers from a fixed corpus of project write-ups. Every claim
        cites the passage it came from, and the system refuses when the corpus does not cover
        the question. The model runs in your browser, so nothing you type leaves this machine.
      </p>
      <app-chat-pane />
    </main>
  `,
  styles: `
    :host {
      display: block;
      font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #1a1a1a;
    }
    .shell {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      max-width: 52rem;
      margin: 0 auto;
      padding: 2.5rem 1.25rem 4rem;
    }
    h1 {
      margin: 0;
      font-size: 1.75rem;
      letter-spacing: -0.02em;
    }
    .lede {
      margin: 0;
      max-width: 46rem;
      line-height: 1.55;
      color: #444;
    }
  `,
})
export class App {}
