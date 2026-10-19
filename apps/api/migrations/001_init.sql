-- Initial schema. Idempotent on purpose: the acceptance check runs it twice
-- against the same database and the second run must be clean.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  title text NOT NULL,
  client text,
  role text,
  period text,
  stack text[] NOT NULL DEFAULT '{}',
  source_uri text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Dimensions are fixed at 768 because nomic-embed-text emits 768; the API checks
-- the column width against the provider at boot and refuses to start on a mismatch.
CREATE TABLE IF NOT EXISTS chunks (
  id bigserial PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ord integer NOT NULL CHECK (ord >= 0),
  section text,
  content text NOT NULL,
  content_hash char(64) NOT NULL,
  token_est integer NOT NULL CHECK (token_est >= 0),
  embedding vector(768) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, ord)
);

CREATE INDEX IF NOT EXISTS chunks_project_ord_idx ON chunks (project_id, ord);
