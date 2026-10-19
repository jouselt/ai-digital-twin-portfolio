import type { CorpusBundleLike } from './bundle';
import { uncoveredEntities } from './coverage';
import { classifyIntent } from './intent';

/**
 * The three questions offered before the visitor has asked anything.
 *
 * Hand-written, because a generated question reads like a chunk title ("What did he
 * ship for AI-assisted engineering?"), and tied to a project id so the test can
 * prove the corpus answers them. A suggestion that leads to a refusal is worse than
 * no suggestion: it burns the one interaction a stranger gives the page.
 */
export interface Starter {
  readonly question: string;
  readonly projectId: string;
}

export const STARTER_QUESTIONS: readonly Starter[] = [
  { question: 'What did he ship for Carnival Cruise Line?', projectId: 'pos-websocket-pci' },
  { question: 'How did he cut the initial bundle size?', projectId: 'frontend-performance' },
  { question: 'How was logging handled across the commerce APIs?', projectId: 'commerce-observability' },
  { question: 'What did he ship for Autodesk?', projectId: 'autodesk-fusion-360' },
];

const STOP_WORDS = new Set([
  'about', 'across', 'after', 'been', 'before', 'could', 'did', 'does', 'from', 'have',
  'into', 'made', 'over', 'ship', 'shipped', 'should', 'some', 'than', 'that', 'their',
  'them', 'then', 'there', 'these', 'they', 'this', 'those', 'used', 'very', 'was',
  'were', 'what', 'when', 'where', 'which', 'while', 'with', 'work', 'worked', 'would',
]);

function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word));
}

export interface StarterProblem {
  readonly question: string;
  readonly problem: 'wrong_intent' | 'uncovered_entity' | 'unsupported';
  readonly detail: string;
}

/**
 * Proves each starter is answerable from the bundle. Used by the test suite, so a
 * corpus rename that strands a suggestion fails the build instead of shipping.
 */
export function checkStarters(
  bundle: CorpusBundleLike,
  starters: readonly Starter[] = STARTER_QUESTIONS,
): StarterProblem[] {
  const projects = bundle.projects ?? [];
  const chunks = bundle.chunks ?? [];
  const corpusText = [
    ...projects.map((project) =>
      [project.title, project.client ?? '', project.role ?? '', (project.stack ?? []).join(' ')].join(' '),
    ),
    ...chunks.map((chunk) => [chunk.title, chunk.section ?? '', chunk.content].join(' ')),
  ].join('\n');

  const problems: StarterProblem[] = [];
  for (const starter of starters) {
    if (classifyIntent(starter.question) !== 'ask') {
      problems.push({ question: starter.question, problem: 'wrong_intent', detail: 'not treated as a question' });
      continue;
    }

    const missing = uncoveredEntities(starter.question, corpusText);
    if (missing.length > 0) {
      problems.push({
        question: starter.question,
        problem: 'uncovered_entity',
        detail: `the corpus has no record of ${missing.join(', ')}`,
      });
      continue;
    }

    const target = chunks.filter((chunk) => chunk.projectId === starter.projectId);
    if (target.length === 0) {
      problems.push({
        question: starter.question,
        problem: 'unsupported',
        detail: `no chunks for project ${starter.projectId}`,
      });
      continue;
    }

    const targetWords = new Set(contentWords(target.map((chunk) => chunk.content).join(' ')));
    const shared = contentWords(starter.question).filter((word) => targetWords.has(word));
    if (shared.length === 0) {
      problems.push({
        question: starter.question,
        problem: 'unsupported',
        detail: `shares no content word with ${starter.projectId}`,
      });
    }
  }

  return problems;
}
