/*
  # Create Adaptation Effectiveness Tracking System

  1. New Tables
    - `adaptation_effectiveness`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to auth.users)
      - `pattern_id` (text) - identifier for the losing pattern that triggered adaptation
      - `adaptation_type` (text) - type of adaptation applied
      - `trade_id` (uuid) - the trade that was adapted
      - `session_id` (uuid) - backtest/live session
      - `original_params` (jsonb) - original trade parameters
      - `adjusted_params` (jsonb) - adjusted trade parameters
      - `similarity_score` (numeric) - pattern similarity score (0-1)
      - `weighted_similarity` (numeric) - age-adjusted similarity score
      - `age_factor` (numeric) - pattern age decay factor
      - `outcome` (text) - 'win', 'loss', 'breakeven'
      - `improvement_delta` (numeric) - performance improvement from adaptation
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on `adaptation_effectiveness` table
    - Add policies for authenticated users to read/write their own data

  3. Indexes
    - Index on user_id and created_at for performance
    - Index on pattern_id for pattern effectiveness queries
    - Index on adaptation_type for analysis
*/

-- Create adaptation effectiveness tracking table
CREATE TABLE IF NOT EXISTS adaptation_effectiveness (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  pattern_id text NOT NULL,
  adaptation_type text NOT NULL,
  trade_id uuid,
  session_id uuid,
  original_params jsonb NOT NULL DEFAULT '{}',
  adjusted_params jsonb NOT NULL DEFAULT '{}',
  similarity_score numeric(5,4) DEFAULT 0,
  weighted_similarity numeric(5,4) DEFAULT 0,
  age_factor numeric(5,4) DEFAULT 1.0,
  outcome text CHECK (outcome IN ('win', 'loss', 'breakeven', 'pending')),
  improvement_delta numeric(10,2) DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE adaptation_effectiveness ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can read own adaptation effectiveness"
  ON adaptation_effectiveness FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own adaptation effectiveness"
  ON adaptation_effectiveness FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own adaptation effectiveness"
  ON adaptation_effectiveness FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_adaptation_effectiveness_user_created 
  ON adaptation_effectiveness(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_adaptation_effectiveness_pattern 
  ON adaptation_effectiveness(pattern_id, outcome);

CREATE INDEX IF NOT EXISTS idx_adaptation_effectiveness_type 
  ON adaptation_effectiveness(adaptation_type, outcome);

CREATE INDEX IF NOT EXISTS idx_adaptation_effectiveness_trade 
  ON adaptation_effectiveness(trade_id) WHERE trade_id IS NOT NULL;