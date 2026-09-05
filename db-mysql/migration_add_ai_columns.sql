-- Run this ONLY if you already ran the old schema.sql before AI features
-- were added. Fresh installs don't need this — db/schema.sql already
-- includes these columns.
--
-- Usage:
--   mysql -u root -p jansatu < db/migration_add_ai_columns.sql

USE jansatu;

ALTER TABLE problems
  ADD COLUMN IF NOT EXISTS ai_summary TEXT,
  ADD COLUMN IF NOT EXISTS ai_summary_at DATETIME;
