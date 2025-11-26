/*
  # Create Recommendations Tracking System

  This migration creates the infrastructure for tracking and applying trading recommendations.
  It closes the learning loop by ensuring that generated recommendations become actionable improvements.

  1. New Tables
    - `recommendations`: Stores all trading recommendations with tracking metadata

  2. Key Features
    - Track recommendation status (pending → active → applied → retired)
    - Measure effectiveness by comparing before/after metrics
    - Auto-apply high-confidence recommendations
    - Link recommendations to source sessions
    - Store effectiveness scores and trade impact

  3. Security
    - Enable RLS on recommendations table
    - Users can only access their own recommendations
*/

-- Create recommendations table
CREATE TABLE IF NOT EXISTS recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Recommendation Details
  recommendation_text text NOT NULL,
  recommendation_type text NOT NULL CHECK (recommendation_type IN (
    'confidence_adjust',
    'risk_adjust',
    'filter_adjust',
    'pattern_avoid',
    'strategy_change'
  )),

  -- Targeting
  target_symbol text,
  target_pattern text,
  adjustment_value numeric,

  -- Status Tracking
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',
    'active',
    'applied',
    'retired'
  )),

  -- Confidence & Source
  confidence_score integer NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 100),
  source_session_id uuid,

  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  retired_at timestamptz,

  -- Effectiveness Tracking
  effectiveness_score numeric,
  trades_affected integer DEFAULT 0,

  -- Metadata
  metadata jsonb DEFAULT '{}'::jsonb
);

-- Create indexes
CREATE INDEX IF NOT EXISTS recommendations_user_status_idx
  ON recommendations(user_id, status);

CREATE INDEX IF NOT EXISTS recommendations_symbol_idx
  ON recommendations(target_symbol)
  WHERE target_symbol IS NOT NULL;

CREATE INDEX IF NOT EXISTS recommendations_confidence_idx
  ON recommendations(confidence_score DESC);

CREATE INDEX IF NOT EXISTS recommendations_created_idx
  ON recommendations(created_at DESC);

-- Enable RLS
ALTER TABLE recommendations ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own recommendations"
  ON recommendations
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own recommendations"
  ON recommendations
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own recommendations"
  ON recommendations
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own recommendations"
  ON recommendations
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
