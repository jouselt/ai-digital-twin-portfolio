/**
 * The retrieval floor cannot tell a covered question from an uncovered one.
 *
 * Measured in a real browser: "What did he ship for Carnival?" (covered) scored
 * 0.73 and "What did he ship for autodesk?" (Autodesk appears nowhere in the
 * corpus) scored 0.71 to 0.74. Dense cosine similarity on a nine-document corpus
 * is simply not that discriminating, so no threshold separates them.
 *
 * What does separate them is the entity the question names. If the visitor asks
 * about a company that appears nowhere in the corpus, no passage can answer it,
 * and calling the model only invites a fabrication. This check is deterministic,
 * costs nothing, and is testable without a model.
 */

/** Capitalised words that start questions and mean nothing on their own. */
const QUESTION_WORDS = new Set([
  'what', 'who', 'when', 'where', 'why', 'how', 'which', 'whose', 'whom',
  'can', 'could', 'would', 'should', 'does', 'did', 'do', 'is', 'are', 'was', 'were',
  'tell', 'show', 'give', 'list', 'explain', 'describe', 'summarise', 'summarize',
  'the', 'and', 'but', 'for', 'with', 'about', 'his', 'her', 'their', 'your', 'you',
  'please', 'hi', 'hello', 'hey', 'in', 'on', 'at', 'to', 'of', 'a', 'an', 'i',
  'will', 'would', 'shall', 'may', 'might', 'must', 'ought', 'has', 'have', 'had',
  'there', 'they', 'he', 'she', 'it', 'we', 'this', 'that', 'these', 'those',
  'chile', 'english', 'spanish',
]);

/** One to three capitalised words, allowing the shapes companies actually use. */
const PROPER_NOUN = /[A-Z][A-Za-z0-9.&'-]{1,}(?:\s+[A-Z][A-Za-z0-9.&'-]{1,}){0,2}/g;

/**
 * The slot where a company name sits: "for autodesk", "at google", "with latam".
 * Real questions are usually typed in lower case, and a name the corpus never
 * mentions is exactly the case worth catching, so capitalisation alone is not
 * enough. This is a heuristic, and it errs toward abstaining on a name nobody
 * wrote about, which is the safe side of a portfolio about a real person.
 */
const COMPANY_SLOT = /\b(?:for|at|from|with|about)\s+([a-z][a-z0-9.&'-]{2,})/gi;

/**
 * Proper nouns in the question that the corpus never mentions.
 *
 * Returns the offending names so the caller can say which one it has no record
 * of, instead of a vague refusal.
 */
export function uncoveredEntities(question: string, corpusText: string): string[] {
  const haystack = corpusText.toLowerCase();
  const found: string[] = [];

  const candidates = [
    ...(question.match(PROPER_NOUN) ?? []),
    ...(question.matchAll(COMPANY_SLOT) ?? []),
  ].map((match) => (typeof match === 'string' ? match : (match[1] ?? '')));

  for (const raw of candidates) {
    const candidate = raw.trim();
    const lowered = candidate.toLowerCase();
    if (QUESTION_WORDS.has(lowered.split(/\s+/)[0] ?? '')) continue;
    if (candidate.length < 3) continue;
    if (QUESTION_WORDS.has(candidate.toLowerCase())) continue;
    if (haystack.includes(lowered)) continue;
    if (found.some((name) => name.toLowerCase() === lowered)) continue;
    found.push(candidate);
  }

  return found;
}
