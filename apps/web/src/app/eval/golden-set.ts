/**
 * The eval set, not the test suite.
 *
 * The unit tests prove the guards work when a fake model misbehaves. These cases
 * ask whether the product behaves, with the real model, which is the only number
 * worth putting in front of a hiring manager.
 *
 * Each expectation is one of:
 * - cited      the visitor gets a claim with a marker that resolves
 * - uncovered  the question names something the corpus never mentions
 * - canned     a greeting or meta question, answered without the corpus
 * - abstain    a real question the records do not answer
 */
export type Expectation = 'cited' | 'uncovered' | 'canned' | 'abstain';

export interface EvalCase {
  readonly id: string;
  readonly question: string;
  readonly expect: Expectation;
  /** Why this case exists. Printed in the report so the number has a meaning. */
  readonly why: string;
}

export const GOLDEN_SET: readonly EvalCase[] = [
  {
    id: 'covered-observability',
    question: 'How did he handle logging across the commerce APIs?',
    expect: 'cited',
    why: 'A direct hit on a documented project.',
  },
  {
    id: 'covered-carnival',
    question: 'What did he ship for Carnival?',
    expect: 'cited',
    why: 'Named client that the corpus covers.',
  },
  {
    id: 'covered-bff',
    question: 'What is a Node.js BFF and what did he build with it?',
    expect: 'cited',
    why: 'Concept question that one project documents.',
  },
  {
    id: 'covered-performance',
    question: 'How did he cut the initial bundle size?',
    expect: 'cited',
    why: 'A concrete engineering outcome with a number in the record.',
  },
  {
    id: 'covered-stack',
    question: 'Which version of Angular has he worked with in production?',
    expect: 'cited',
    why: 'Stack question, the kind a recruiter actually asks.',
  },
  {
    id: 'covered-websocket',
    question: 'How did the WebSocket bridge to POS terminals work?',
    expect: 'cited',
    why: 'Narrow technical question on one project.',
  },
  {
    id: 'covered-autodesk',
    question: 'What did he ship for autodesk?',
    expect: 'cited',
    why: 'Autodesk is a real client in the CV. Refusing it was a corpus gap, not a feature.',
  },
  {
    id: 'uncovered-spotify',
    question: 'What did he build at Spotify?',
    expect: 'uncovered',
    why: 'A company with no record anywhere in the portfolio.',
  },
  {
    id: 'uncovered-google',
    question: 'What did he do at Google?',
    expect: 'uncovered',
    why: 'A company a visitor might assume from the stack.',
  },
  {
    id: 'uncovered-netflix',
    question: 'Did he work for Netflix?',
    expect: 'uncovered',
    why: 'A yes/no question about a company with no record.',
  },
  {
    id: 'canned-greeting',
    question: 'Hi',
    expect: 'canned',
    why: 'The first thing a visitor types, and it used to return a refusal.',
  },
  {
    id: 'canned-meta',
    question: 'What can you do?',
    expect: 'canned',
    why: 'A visitor asking how the thing works.',
  },
  {
    id: 'abstain-salary',
    question: 'What is his current salary?',
    expect: 'abstain',
    why: 'Personal detail the corpus deliberately does not contain.',
  },
  {
    id: 'abstain-politics',
    question: 'What are his political opinions?',
    expect: 'abstain',
    why: 'Off-topic for a work record, and worth refusing in public.',
  },
  {
    id: 'abstain-future',
    question: 'Will he accept a job in Berlin next year?',
    expect: 'abstain',
    why: 'A prediction no written record can support.',
  },
];
