/*
  # Elite TP System - Performance Tracking

  1. New Tables
    - `tp_quality_logs`
      - Tracks all TP placement decisions and their quality metrics
      - Stores liquidity zone information
      - Records R:R ratios and placement types
      - Links to trades for outcome analysis
  
  2. Columns
    - id (uuid, primary key)
    - user_id (uuid, foreign key to auth.users)
    - trade_id (uuid, nullable - linked after trade creation)
    - session_id (uuid, nullable - for goal session tracking)
    - symbol (text)
    - direction (text: 'long' or 'short')
    - entry_price (numeric)
    - stop_loss (numeric)
    - take_profit (numeric)
    - rr_ratio (numeric)
    - placement_type (text: 'single' or 'partial')
    - liquidity_zones_detected (integer)
    - liquidity_override_used (boolean)
    - primary_liquidity_type (text, nullable)
    - primary_liquidity_strength (text, nullable)
    - tp_distance_pips (numeric)
    - sl_distance_pips (numeric)
    - recommendation_quality (text: 'excellent', 'good', 'acceptable', 'poor')
    - warnings (jsonb, array of warning strings)
    - tp_outcome (text, nullable: 'hit', 'stopped_out', 'partial_hit', 'manual_close', 'timeout')
    - actual_rr (numeric, nullable - recorded when trade closes)
    - time_to_fill_minutes (integer, nullable)
    - created_at (timestamptz)
    - outcome_recorded_at (timestamptz, nullable)
  
  3. Security
    - Enable RLS on tp_quality_logs
    - Users can only view their own TP logs
    - Service role can read all logs for analytics
  
  4. Indexes
    - user_id for fast user queries
    - trade_id for outcome updates
    - created_at for time-based queries
    - recommendation_quality for quality distribution analysis
*/

-- Create tp_quality_logs table
CREATE TABLE IF NOT EXISTS tp_quality_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trade_id uuid,
  session_id uuid,
  
  symbol text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('long', 'short')),
  
  entry_price numeric NOT NULL,
  stop_loss numeric NOT NULL,
  take_profit numeric NOT NULL,
  
  rr_ratio numeric NOT NULL,
  placement_type text NOT NULL CHECK (placement_type IN ('single', 'partial')),
  
  liquidity_zones_detected integer NOT NULL DEFAULT 0,
  liquidity_override_used boolean NOT NULL DEFAULT false,
  primary_liquidity_type text,
  primary_liquidity_strength text,
  
  tp_distance_pips numeric NOT NULL,
  sl_distance_pips numeric NOT NULL,
  
  recommendation_quality text NOT NULL CHECK (recommendation_quality IN ('excellent', 'good', 'acceptable', 'poor')),
  warnings jsonb DEFAULT '[]'::jsonb,
  
  tp_outcome text CHECK (tp_outcome IN ('hit', 'stopped_out', 'partial_hit', 'manual_close', 'timeout')),
  actual_rr numeric,
  time_to_fill_minutes integer,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  outcome_recorded_at timestamptz
);

-- Enable RLS
ALTER TABLE tp_quality_logs ENABLE ROW LEVEL SECURITY;

-- Users can view their own TP logs
CREATE POLICY "Users can view own TP logs"
  ON tp_quality_logs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can insert their own TP logs
CREATE POLICY "Users can insert own TP logs"
  ON tp_quality_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own TP logs (for outcome recording)
CREATE POLICY "Users can update own TP logs"
  ON tp_quality_logs
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role can read all TP logs for analytics
CREATE POLICY "Service role can read all TP logs"
  ON tp_quality_logs
  FOR SELECT
  TO service_role
  USING (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_tp_quality_logs_user_id ON tp_quality_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_tp_quality_logs_trade_id ON tp_quality_logs(trade_id) WHERE trade_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tp_quality_logs_created_at ON tp_quality_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tp_quality_logs_quality ON tp_quality_logs(recommendation_quality);
CREATE INDEX IF NOT EXISTS idx_tp_quality_logs_outcome ON tp_quality_logs(tp_outcome) WHERE tp_outcome IS NOT NULL;

-- Comment on table
COMMENT ON TABLE tp_quality_logs IS 'Elite TP System: Tracks all take-profit placement decisions and their quality metrics for learning and optimization';
