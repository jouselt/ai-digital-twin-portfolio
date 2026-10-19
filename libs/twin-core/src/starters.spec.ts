import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseBundle } from './bundle';
import { checkStarters, STARTER_QUESTIONS } from './starters';

/**
 * These run against the real corpus the site ships, not a fixture. A suggestion is
 * only allowed on the page if the records behind it can answer it, and the way to
 * know that is to read the same bundle the browser reads.
 */
const bundlePath = join(__dirname, '../../../apps/web/public/corpus/bundle.json');
const bundle = parseBundle(JSON.parse(readFileSync(bundlePath, 'utf8')));

describe('starter questions', () => {
  it('offers a small set, because a wall of suggestions is a menu', () => {
    expect(STARTER_QUESTIONS.length).toBeGreaterThanOrEqual(3);
    expect(STARTER_QUESTIONS.length).toBeLessThanOrEqual(4);
  });

  it('is answerable from the shipped corpus', () => {
    const problems = checkStarters(bundle);
    // Printed in full when it fails: "unsupported" tells you nothing on its own.
    expect(problems).toEqual([]);
  });

  it('catches a suggestion the corpus cannot answer', () => {
    const problems = checkStarters(bundle, [
      { question: 'What did he build at Spotify?', projectId: 'frontend-performance' },
      { question: 'How did he cut the initial bundle size?', projectId: 'frontend-performance' },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.problem).toBe('uncovered_entity');
    expect(problems[0]?.detail).toContain('Spotify');
  });

  it('catches a suggestion pointing at a project that does not exist', () => {
    const problems = checkStarters(bundle, [
      { question: 'How did he cut the initial bundle size?', projectId: 'no-such-project' },
    ]);
    expect(problems[0]?.problem).toBe('unsupported');
  });

  it('catches a suggestion whose words the target project never uses', () => {
    const problems = checkStarters(bundle, [
      { question: 'How did he handle the kubernetes rollout?', projectId: 'frontend-performance' },
    ]);
    expect(problems[0]?.problem).toBe('unsupported');
    expect(problems[0]?.detail).toContain('no content word');
  });
});
