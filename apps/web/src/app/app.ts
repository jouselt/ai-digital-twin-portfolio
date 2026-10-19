import { ChangeDetectionStrategy, Component } from '@angular/core';

import { ChatPane } from './twin/chat-pane';

@Component({
  selector: 'app-root',
  imports: [ChatPane],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="site-header">
      <div class="container header-inner">
        <a class="brand" href="https://jouselt.github.io/portfolio/">
          <span class="brand-mark">JF</span>
          <span class="brand-text">Jouselt A. Fernandez</span>
        </a>
        <nav class="site-nav">
          <a href="https://jouselt.github.io/portfolio/">Portfolio</a>
          <a href="https://github.com/jouselt">GitHub</a>
          <a href="https://linkedin.com/in/jouselt">LinkedIn</a>
        </nav>
      </div>
    </header>

    <main>
      <section class="hero container">
        <p class="eyebrow">Answers with receipts</p>
        <h1>Ask about the work.<br />Watch it refuse.</h1>
        <p class="hero-lead">
          Answers come from a fixed corpus of written project records. Every factual sentence
          carries a marker that resolves to the passage it came from, and when the records do
          not answer the question the system says so instead of guessing.
        </p>
        <p class="hero-note">
          The model runs in your browser on WebGPU. Nothing you type leaves this machine.
        </p>
      </section>

      <section class="container pane-section">
        <app-chat-pane />
      </section>
    </main>

    <footer class="site-footer">
      <div class="container footer-inner">
        <p>
          The refusal is the feature: an answer that cannot be grounded is discarded, and the
          trace id stays visible so the path to it can be checked.
        </p>
        <p class="footer-meta">Angular &middot; TypeScript &middot; WebLLM</p>
      </div>
    </footer>
  `,
  styles: `
    :host {
      display: flex;
      min-height: 100vh;
      flex-direction: column;
    }

    .site-header {
      position: sticky;
      top: 0;
      z-index: 50;
      backdrop-filter: blur(14px);
      background: rgba(245, 242, 232, 0.92);
      border-bottom: 1px solid rgba(216, 209, 193, 0.85);
    }

    .header-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1.5rem;
      padding: 1rem 0;
    }

    .brand {
      display: inline-flex;
      align-items: center;
      gap: 0.85rem;
      color: var(--text);
      text-decoration: none;
      font-weight: 700;
    }

    .brand-mark {
      display: inline-grid;
      place-items: center;
      width: 2.5rem;
      height: 2.5rem;
      border-radius: 999px;
      background: var(--text);
      color: #fff;
      font-size: 0.95rem;
    }

    .site-nav {
      display: flex;
      flex-wrap: wrap;
      gap: 0.9rem 1.2rem;
      font-weight: 600;
    }

    .site-nav a {
      color: var(--ink-soft);
      text-decoration: none;
    }

    .site-nav a:hover,
    .site-nav a:focus-visible {
      color: var(--brand-deep);
    }

    main {
      flex: 1;
      padding-bottom: 4rem;
    }

    .hero {
      max-width: 52rem;
      padding: 4.5rem 0 2.5rem;
    }

    .hero h1 {
      margin: 0.5rem 0 1rem;
      font-size: clamp(2.2rem, 4.4vw, 3.6rem);
      line-height: 1.02;
      letter-spacing: -0.03em;
    }

    .hero-lead {
      margin: 0;
      max-width: 46rem;
      font-size: 1.18rem;
      color: var(--ink-soft);
    }

    .hero-note {
      margin: 1rem 0 0;
      color: var(--muted);
      font-size: 0.95rem;
    }

    .pane-section {
      padding-top: 0.5rem;
    }

    .site-footer {
      padding: 1.8rem 0 2.4rem;
      border-top: 1px solid rgba(216, 209, 193, 0.85);
      background: var(--surface-alt);
      font-size: 0.92rem;
    }

    .footer-inner {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }

    .footer-inner p {
      margin: 0;
      max-width: 42rem;
      color: var(--muted);
    }

    .footer-meta {
      color: var(--brand-deep) !important;
      font-weight: 700;
    }

    @media (max-width: 720px) {
      .site-nav {
        gap: 0.65rem 0.9rem;
      }

      .hero {
        padding-top: 3rem;
      }
    }
  `,
})
export class App {}
