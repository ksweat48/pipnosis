/*
  # Create Market Analysis Table

  1. New Tables
    - `market_analysis` - Stores AI-powered market analysis results
      - Includes sentiment analysis, trend detection, support/resistance levels
      - Links to specific symbols and timeframes
      - Stores confidence scores and recommendations

  2. Security
    - Enable RLS on market_analysis table
    - Users can only read their own analysis (or public analysis)
    - Only authenticated users can create analysis

  3. Indexes
    - Index on (symbol, timeframe, created_at) for recent analysis queries
    - Index on user_id for user-specific queries
*/

-- Create market_analysis table
CREATE TABLE IF NOT EXISTS market_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  analysis_type text NOT NULL DEFAULT 'comprehensive',
  sentiment text CHECK (sentiment IN ('bullish', 'bearish', 'neutral')),
  confidence_score integer CHECK (confidence_score >= 0 AND confidence_score <= 100),
  trend_direction text CHECK (trend_direction IN ('up', 'down', 'sideways')),
  support_levels numeric[] DEFAULT '{}',
  resistance_levels numeric[] DEFAULT '{}',
  key_insights text[] DEFAULT '{}',
  recommendation text,
  risk_assessment text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_market_analysis_symbol_timeframe
  ON market_analysis(symbol, timeframe, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_analysis_user_id
  ON market_analysis(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_analysis_created_at
  ON market_analysis(created_at DESC);

-- Enable RLS
ALTER TABLE market_analysis ENABLE ROW LEVEL SECURITY;

-- Users can read their own analysis
CREATE POLICY "Users can read own market analysis"
  ON market_analysis FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can insert their own analysis
CREATE POLICY "Users can insert own market analysis"
  ON market_analysis FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own analysis
CREATE POLICY "Users can update own market analysis"
  ON market_analysis FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own analysis
CREATE POLICY "Users can delete own market analysis"
  ON market_analysis FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_market_analysis_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for market_analysis
DROP TRIGGER IF EXISTS market_analysis_updated_at ON market_analysis;
CREATE TRIGGER market_analysis_updated_at
  BEFORE UPDATE ON market_analysis
  FOR EACH ROW
  EXECUTE FUNCTION update_market_analysis_updated_at();