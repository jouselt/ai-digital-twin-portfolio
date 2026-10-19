-- HNSW for cosine distance. m and ef_construction are pgvector defaults, set
-- explicitly so a future default change does not silently alter recall.
--
-- Built without concurrent locks because the corpus is fixed-size at ingest
-- time and the table is never written while serving reads.

CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw_idx
  ON chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
