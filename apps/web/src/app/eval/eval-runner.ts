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
  /**
   * The answer as the visitor read it. Without this, a report says "56 chars" and
   * nothing else, so a refusal and a fabricated sentence are indistinguishable.
   */
  readonly answer: string;
}

/**
 * A refusal in prose, as a pattern rather than a phrase list. A phrase list was
 * written first and missed the real form: "the records do not state his salary"
 * is plural, and no fixed list survives a model's phrasing.
 *
 * Negation followed by a disclosure verb inside the same sentence.
 */
const REFUSAL_PATTERN =
  /\b(?:not|no|never|isn'?t|aren'?t|doesn'?t|don'?t|didn'?t|cannot|can'?t)\b[^.]{0,40}\b(?:mention|state|specify|provide|include|contain|disclose|available|record|information|detail|list|show)\b/i;

/** A figure the records cannot support: an invented salary is the failure that matters. */
const INVENTED_FIGURE = /(?:[$€£]\s?\d|\d[\d.,]*\s?(?:k\b|usd|eur|clp|pesos|dollars))/i;

export function looksLikeRefusal(text: string): boolean {
  if (INVENTED_FIGURE.test(text)) return false;
  return REFUSAL_PATTERN.test(text);
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
    case 'abstain': {
      // A broken request is not a refusal. Counting it as one hides an outage
      // behind a passing score, which is exactly what happened on the first run.
      const refused = kind === 'abstain' && reason !== 'request_failed';
      // Declining in prose is also a refusal. "The records do not state his salary [1]"
      // is what the visitor should read, and it is better than a bare refusal frame.
      // It has to carry a resolved citation so it is grounded, and it must not
      // contain a figure the corpus cannot support.
      const proseRefusal =
        (kind === 'done' || kind === 'quote') && hasMarker && hasProse && looksLikeRefusal(text);
      passed = refused || proseRefusal;
      detail = refused
        ? `refused (${reason})`
        : proseRefusal
          ? 'refused in prose, with a citation'
          : `expected a refusal, got ${got}`;
      break;
    }
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
    answer: text,
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
