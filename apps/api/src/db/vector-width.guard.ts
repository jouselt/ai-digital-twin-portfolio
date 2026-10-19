import type { Pool } from 'pg';

/**
 * Refuses to run against a column whose width disagrees with the provider.
 *
 * The failure this prevents is silent: pgvector rejects a 768-wide write into a
 * 1536-wide column only at insert time, one chunk into the ingest, with an error
 * that names neither the model nor the migration. Checking atttypmod once at
 * boot turns it into a message that says what to change.
 */
export class VectorWidthError extends Error {
  constructor(
    readonly table: string,
    readonly column: string,
    readonly expected: number,
    readonly actual: number | null,
  ) {
    super(
      actual === null
        ? `${table}.${column} is not a fixed-width vector column; the provider emits ${expected} dimensions`
        : `${table}.${column} is vector(${actual}), but the embedding provider emits ${expected} dimensions. ` +
          'Fix the column with a migration or change the EMBEDDING_MODEL.',
    );
    this.name = 'VectorWidthError';
  }
}

interface WidthRow {
  atttypmod: number;
  formatted: string;
}

/**
 * Reads the declared vector width. Postgres stores it in atttypmod directly, not
 * offset by 4 the way varchar does: measured on pgvector 0.8.7, `vector(768)`
 * reports atttypmod = 768.
 */
export async function readVectorWidth(
  pool: Pool,
  table: string,
  column: string,
): Promise<number | null> {
  const result = await pool.query<WidthRow>(
    `SELECT a.atttypmod AS atttypmod, format_type(a.atttypid, a.atttypmod) AS formatted
       FROM pg_attribute a
      WHERE a.attrelid = $1::regclass
        AND a.attname = $2
        AND a.attnum > 0
        AND NOT a.attisdropped`,
    [table, column],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return row.formatted.startsWith('vector(') ? row.atttypmod : null;
}

export async function assertVectorWidth(
  pool: Pool,
  table: string,
  column: string,
  expected: number,
): Promise<number> {
  const actual = await readVectorWidth(pool, table, column);
  if (actual !== expected) {
    throw new VectorWidthError(table, column, expected, actual);
  }
  return actual;
}
