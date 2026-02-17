/*
  # Create omega8_hybrid_usage tracking table

  1. New Tables
    - `omega8_hybrid_usage`
      - `id` (uuid, primary key) - unique row identifier
      - `user_id` (uuid, FK to auth.users) - which user triggered this evaluation
      - `symbol` (text) - the symbol evaluated
      - `confidence` (float) - confidence score from omega-8 hybrid brain
      - `used_llm` (boolean, default false) - whether LLM was used vs pure heuristic
      - `tokens_used` (integer, default 0) - LLM tokens consumed
      - `created_at` (timestamptz, default now()) - when this evaluation occurred

  2. Security
    - Enable RLS on `omega8_hybrid_usage` table
    - Authenticated users can insert their own rows
    - Authenticated users can read their own rows
    - Service role has full access for admin/analytics

  3. Indexes
    - user_id + created_at for efficient per-user queries
    - symbol + created_at for per-symbol analytics

  4. Notes
    - This table was missing, causing 404 errors on POST from omega8-hybrid-orderflow.ts
    - Data is non-critical (analytics/tracking only) -- loss does not affect trading
*/

CREATE TABLE IF NOT EXISTS omega8_hybrid_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL DEFAULT '',
  confidence float NOT NULL DEFAULT 0,
  used_llm boolean NOT NULL DEFAULT false,
  tokens_used integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE omega8_hybrid_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own omega8 usage"
  ON omega8_hybrid_usage
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read own omega8 usage"
  ON omega8_hybrid_usage
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access omega8 usage"
  ON omega8_hybrid_usage
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_omega8_hybrid_usage_user_created
  ON omega8_hybrid_usage (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_omega8_hybrid_usage_symbol_created
  ON omega8_hybrid_usage (symbol, created_at DESC);
