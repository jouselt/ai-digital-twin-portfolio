export interface CorpusMetadata {
  readonly id: string;
  readonly title: string;
  readonly client: string | null;
  readonly role: string | null;
  readonly period: string | null;
  /** At least two entries; a document with fewer is not a project write-up. */
  readonly stack: readonly string[];
}

export class CorpusFrontmatterError extends Error {
  constructor(
    readonly source: string,
    readonly field: string,
    detail: string,
  ) {
    super(`${source}: frontmatter field "${field}" ${detail}`);
    this.name = 'CorpusFrontmatterError';
  }
}

const MIN_STACK = 2;

/**
 * Reads the frontmatter a corpus document must carry.
 *
 * Everything the project card, the filter row and the citation title need comes
 * from here, so a missing field has to fail loudly at ingest rather than become
 * a null in the database that only shows up in the UI.
 */
export function parseCorpusFrontmatter(
  markdown: string,
  source: string,
): { metadata: CorpusMetadata; body: string } {
  const text = markdown.replace(/^\ufeff/, '');
  if (!text.startsWith('---')) {
    throw new CorpusFrontmatterError(source, '---', 'is missing: the document must open with a frontmatter block');
  }
  const end = /\n---\s*\n/.exec(text.slice(3));
  if (end === null) {
    throw new CorpusFrontmatterError(source, '---', 'is never closed: add a closing `---` line');
  }

  const fields = parseFields(text.slice(3, end.index + 3));
  const body = text.slice(end.index + end[0].length + 3);

  const id = requireField(fields, 'id', source);
  const title = requireField(fields, 'title', source);
  const stack = fields['stack'];
  if (stack === undefined || !Array.isArray(stack) || stack.length < MIN_STACK) {
    throw new CorpusFrontmatterError(
      source,
      'stack',
      `must be a list of at least ${MIN_STACK} technologies`,
    );
  }

  return {
    metadata: {
      id,
      title,
      client: optional(fields['client']),
      role: optional(fields['role']),
      period: optional(fields['period']),
      stack: stack.map(String),
    },
    body,
  };
}

function requireField(fields: Record<string, unknown>, key: string, source: string): string {
  const value = optional(fields[key]);
  if (value === null) {
    throw new CorpusFrontmatterError(source, key, 'is required');
  }
  return value;
}

function optional(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
  if (Array.isArray(value)) return null;
  return null;
}

/** Top-level scalars, inline lists and block lists. Nested maps are not used here. */
function parseFields(block: string): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const lines = block.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    if (line.trim().length === 0 || line.trimStart().startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (match === null) continue;

    const key = match[1] as string;
    const raw = (match[2] as string).trim();

    if (raw.startsWith('[') && raw.endsWith(']')) {
      fields[key] = raw
        .slice(1, -1)
        .split(',')
        .map((item) => item.trim().replace(/^["']|["']$/g, ''))
        .filter((item) => item.length > 0);
      continue;
    }

    if (raw.length > 0) {
      fields[key] = raw.replace(/^["']|["']$/g, '');
      continue;
    }

    const items: string[] = [];
    while (index + 1 < lines.length) {
      const next = lines[index + 1] as string;
      if (!next.trimStart().startsWith('- ')) break;
      items.push(next.trimStart().slice(2).trim().replace(/^["']|["']$/g, ''));
      index += 1;
    }
    fields[key] = items.length > 0 ? items : '';
  }
  return fields;
}
