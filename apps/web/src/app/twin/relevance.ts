/**
 * Whether a question and a passage talk about the same thing.
 *
 * Deliberately crude: at least one word of four letters or more in common, with
 * question scaffolding removed. It exists to stop the extractive fallback from
 * quoting an unrelated passage at a personal question, which the eval showed it
 * doing for "What is his current salary?".
 */
const STOPWORDS = new Set([
  'what', 'which', 'when', 'where', 'who', 'whom', 'whose', 'why', 'how',
  'does', 'did', 'was', 'were', 'has', 'have', 'had', 'can', 'could', 'would',
  'should', 'will', 'about', 'with', 'from', 'that', 'this', 'these', 'those',
  'their', 'there', 'them', 'then', 'than', 'into', 'over', 'under', 'between',
  'your', 'yours', 'his', 'her', 'hers', 'its', 'our', 'ours', 'theirs',
  'tell', 'show', 'give', 'some', 'more', 'most', 'much', 'many', 'also',
  'current', 'opinions', 'opinion', 'personal', 'think', 'thoughts',
]);

export function sharesContentWord(question: string, passage: string): boolean {
  const words = question
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word));
  if (words.length === 0) return false;

  const haystack = passage.toLowerCase();
  return words.some((word) => haystack.includes(word));
}
