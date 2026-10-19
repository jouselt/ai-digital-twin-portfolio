import { createHash } from 'node:crypto';

/**
 * Content hash for one chunk.
 *
 * Shape is fixed by design.md: `sha256(project_id | ord | content)`. Note the
 * consequence, which is deliberate: a chunk whose own text is unchanged keeps
 * its hash even when a neighbouring chunk changed, so only the edited chunk is
 * re-embedded.
 */
export function contentHash(projectId: string, ord: number, content: string): string {
  return createHash('sha256').update(`${projectId}|${ord}|${content}`, 'utf8').digest('hex');
}
