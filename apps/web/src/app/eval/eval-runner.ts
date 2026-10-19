import type { TwinMessage } from '../twin/twin.service';

import type { EvalCase, Expectation } from './golden-set';

export interface CaseResult {
  readonly id: string;
  readonly question: string;
  readonly expect: Expectation;
  readonly got: string;
  readonly passed: boolean;
  /** One line explaining the verdict, so a failure is diagnosable from the report. */
  readonly detail: string;
  /** The raw error when the request itself broke, which is not a product behaviour. */
  readonly error: string;
  readonly chars: number;
}

/**
 * Scoring is pure and deterministic: it reads the message the visitor would see
 * and decides whether that is the behaviour the case asked for. No model, so this
 * part is unit tested like any other function.
 */
export function scoreCase(testCase: EvalCase, message: TwinMessage | undefined): CaseResult {
  const text = message?.text ?? '';
  const terminal = message?.terminal ?? null;
  const kind = terminal?.kind ?? 'none';
  const reason = terminal?.reason ?? '';
  const got = kind === 'abstain' ? `abstain:${reason}` : kind;

  const hasMarker = /\[\d{1,3}\]/.test(text);
  const prose = text.replace(/\[\d{1,3}\]/g, ' ').trim();
  const hasProse = prose.length >= 10 && prose.split(/\s+/).filter((word) => /[a-z0-9]/i.test(word)).length >= 3;

  let passed = false;
  let detail = '';

  switch (testCase.expect) {
    case 'cited':
      passed = (kind === 'done' || kind === 'quote') && hasMarker && hasProse;
      detail = passed
        ? `answered with a resolved marker (${text.length} chars)`
        : `expected a cited answer, got ${got} with ${hasMarker ? 'a' : 'no'} marker`;
      break;
    case 'uncovered':
      passed = kind === 'abstain' && reason === 'uncovered_entity';
      detail = passed ? 'named the missing entity' : `expected uncovered_entity, got ${got}`;
      break;
    case 'canned':
      passed = terminal === null && text.includes('every answer cites');
      detail = passed ? 'answered without the corpus' : `expected the canned intro, got ${got}`;
      break;
    case 'abstain':
      // A broken request is not a refusal. Counting it as one hides an outage
      // behind a passing score, which is exactly what happened on the first run.
      passed = kind === 'abstain' && reason !== 'request_failed';
      detail = passed ? `refused (${reason})` : `expected a refusal, got ${got}`;
      break;
  }

  return {
    id: testCase.id,
    question: testCase.question,
    expect: testCase.expect,
    got,
    passed,
    detail,
    error: terminal?.detail ?? '',
    chars: text.length,
  };
}

export interface EvalSummary {
  readonly total: number;
  readonly passed: number;
  readonly rate: number;
  readonly byExpectation: readonly { readonly expect: Expectation; readonly passed: number; readonly total: number }[];
  readonly failures: readonly CaseResult[];
}

export function summarize(results: readonly CaseResult[]): EvalSummary {
  const expectations: Expectation[] = ['cited', 'uncovered', 'canned', 'abstain'];
  const passed = results.filter((result) => result.passed).length;

  return {
    total: results.length,
    passed,
    rate: results.length === 0 ? 0 : passed / results.length,
    byExpectation: expectations.map((expect) => {
      const group = results.filter((result) => result.expect === expect);
      return { expect, passed: group.filter((result) => result.passed).length, total: group.length };
    }),
    failures: results.filter((result) => !result.passed),
  };
}
