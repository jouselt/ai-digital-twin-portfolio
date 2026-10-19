import type { SourceRef } from '@twin/contracts';

/** The exact token the model must emit when the sources do not answer the question. */
export const ABSENT_TOKEN = 'ABSENT';

/**
 * Short on purpose. A long prompt competes with the sources for a 4096-token
 * window, and every extra sentence is another instruction the model can trade
 * against the citation rule.
 *
 * Source of truth: design.md, "Grounding, citation, abstention".
 */
export function buildSystemPrompt(sources: readonly SourceRef[]): string {
  return [
    'You are answering questions about Jouselt A. Fernandez, a senior fullstack developer with 10 years of experience, based in Santiago, Chile.',
    '',
    'Answer using ONLY the numbered sources below. Every sentence that states a fact must end with a citation like [1] or [2][3]. Cite the lowest-numbered source that supports the claim.',
    '',
    'If the sources do not contain the answer, reply with exactly:',
    ABSENT_TOKEN,
    '',
    'Do not guess. Do not use prior knowledge about this person or his employers.',
    '',
    'SOURCES',
    '',
    formatSources(sources),
  ].join('\n');
}

function formatSources(sources: readonly SourceRef[]): string {
  return sources
    .map((source, index) => {
      const heading = source.section === null ? source.title : `${source.title} / ${source.section}`;
      return `[${index + 1}] ${heading}\n${source.content.trim()}`;
    })
    .join('\n\n');
}
