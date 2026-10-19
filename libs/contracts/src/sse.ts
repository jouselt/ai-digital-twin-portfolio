/**
 * The one place that knows how a ChatEvent becomes bytes and comes back.
 *
 * Both apps use it: the API encodes, the Angular client decodes. Keeping the
 * codec here means a frame shape cannot drift between the two without failing
 * a test in this package.
 */

import type { ChatEvent, SourceRef } from './index';

/** Serialise one frame as a Server-Sent Event. */
export function encodeSseEvent(event: ChatEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Parse one `data:` line into a ChatEvent, or null for anything that is not a
 * complete, recognisable frame (blank keep-alive lines, `event:` prefixes,
 * malformed JSON, unknown frame types).
 */
export function parseSseFrame(line: string): ChatEvent | null {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith('data:')) return null;
  const payload = trimmed.slice('data:'.length).trim();
  if (!payload) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const frame = parsed as Record<string, unknown>;

  switch (frame['type']) {
    case 'trace':
      return typeof frame['trace_id'] === 'string'
        ? { type: 'trace', trace_id: frame['trace_id'] }
        : null;
    case 'retrieved': {
      const sources = frame['sources'];
      if (!Array.isArray(sources)) return null;
      if (!sources.every(isSourceRef)) return null;
      return { type: 'retrieved', sources: sources as SourceRef[] };
    }
    case 'delta':
      return typeof frame['text'] === 'string' ? { type: 'delta', text: frame['text'] } : null;
    case 'abstain': {
      const suggestions = frame['suggestions'];
      if (typeof frame['reason'] !== 'string') return null;
      if (!Array.isArray(suggestions)) return null;
      return {
        type: 'abstain',
        reason: frame['reason'] as Extract<ChatEvent, { type: 'abstain' }>['reason'],
        suggestions: suggestions.filter((s): s is string => typeof s === 'string'),
      };
    }
    case 'done':
      return isFiniteNumber(frame['grounded']) &&
        isFiniteNumber(frame['tokens_out']) &&
        isFiniteNumber(frame['elapsed_ms'])
        ? {
            type: 'done',
            grounded: frame['grounded'],
            tokens_out: frame['tokens_out'],
            elapsed_ms: frame['elapsed_ms'],
          }
        : null;
    case 'error':
      return typeof frame['message'] === 'string'
        ? { type: 'error', message: frame['message'] }
        : null;
    default:
      return null;
  }
}

/** Split a decoded stream chunk into complete SSE lines, keeping the remainder. */
export function splitSseBuffer(buffer: string): { frames: string[]; rest: string } {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  return { frames: parts, rest };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSourceRef(value: unknown): value is SourceRef {
  if (typeof value !== 'object' || value === null) return false;
  const source = value as Record<string, unknown>;
  return (
    typeof source['chunkId'] === 'string' &&
    typeof source['projectId'] === 'string' &&
    typeof source['title'] === 'string' &&
    (source['section'] === null || typeof source['section'] === 'string') &&
    typeof source['content'] === 'string' &&
    isFiniteNumber(source['score'])
  );
}
