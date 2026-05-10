-- Migration 0001: Add Voyage AI vector index for multimodal semantic search
--
-- Turso/libSQL vector extension:
--   CREATE INDEX ... USING libsql_vector_idx(column)
--
-- This enables vector_top_k('assets_embedding_idx', vector32('[...]'), k)
-- for semantic asset retrieval (Multimodal RAG).
--
-- The embedding column stores raw IEEE-754 float32 bytes (1024 dims).
-- Populated by server/embeddingService.ts → embedAsset().
--
-- Run: pnpm drizzle-kit migrate
-- Or manually: sqlite3 storage-data/imagen.db < this file

CREATE INDEX IF NOT EXISTS assets_embedding_idx
  ON assets(libsql_vector_idx(embedding));
