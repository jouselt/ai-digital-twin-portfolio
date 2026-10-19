/**
 * Not every visitor question is a question about the work.
 *
 * "Hi" used to go through retrieval, match six passages by accident and come back
 * as "the model declined to answer", which reads like a broken product. This is a
 * deterministic classification, testable without a model, and it costs nothing.
 */
export type QuestionIntent = 'greeting' | 'meta' | 'ask';

const GREETING = /^(hi|hey|hello|yo|hola|buenas|good (morning|afternoon|evening)|what'?s up)\b/i;

const META =
  /\b(what can you (do|answer|tell)|what do you know|who are you|how does this work|what is this|help me|qué podés|que puedes)\b/i;

/** A greeting is only a greeting when it is short; "hi, what did he ship?" is a question. */
const MAX_GREETING_WORDS = 4;

export function classifyIntent(question: string): QuestionIntent {
  const text = question.trim();
  if (text.length === 0) return 'meta';
  if (META.test(text)) return 'meta';
  if (GREETING.test(text) && text.split(/\s+/).length <= MAX_GREETING_WORDS) return 'greeting';
  return 'ask';
}

/** What a greeting gets instead of a refusal: the work it can actually answer about. */
export function cannedIntro(projectTitles: readonly string[]): string {
  const examples = projectTitles.slice(0, 3).map((title) => `- ${title}`).join('\n');
  return [
    'I answer from written project records, and every answer cites the passage it came from.',
    'Ask about a specific project or a specific problem, for example:',
    examples,
  ]
    .filter((line) => line.length > 0)
    .join('\n');
}
