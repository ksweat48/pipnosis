/*
  # Entry Qualification System

  1. New Tables
    - `entry_qualification_logs`
      - Logs all entry qualification decisions for trades
      - Tracks M5 microstructure quality scores
      - Records why entries were accepted, rejected, or delayed

  2. Changes
    - No schema changes to existing tables
    - M5 candles already exist in `forex_candles` table with timeframe='m5'

  3. Security
    - Enable RLS on `entry_qualification_logs` table
    - Add policy for authenticated users to read their own logs

  4. Purpose
    - Track entry quality over time
    - Enable learning from timing decisions
    - Provide audit trail for entry qualification
    - Allow analysis of M5 microstructure impact on performance
*/

-- Create entry qualification logs table
CREATE TABLE IF NOT EXISTS entry_qualification_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  session_id uuid REFERENCES goal_sessions(id) ON DELETE CASCADE,
  trade_id uuid REFERENCES goal_session_trades(id) ON DELETE SET NULL,
  symbol text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('BUY', 'SELL')),

  -- Alpha decision inputs
  entry_price numeric NOT NULL,
  stop_loss numeric NOT NULL,
  take_profit numeric NOT NULL,
  alpha_confidence numeric NOT NULL,

  -- M5 microstructure data
  m5_vwap numeric,
  m5_ema20 numeric,
  m5_rsi numeric,
  m5_volume_avg numeric,
  m5_atr numeric,

  -- Qualification result
  qualification_status text NOT NULL CHECK (qualification_status IN ('ACCEPT_ENTRY', 'WAIT_FOR_BETTER', 'REJECT_ENTRY')),
  quality_score numeric NOT NULL DEFAULT 0,
  microstructure_grade text CHECK (microstructure_grade IN ('A', 'B', 'C', 'D', 'F')),

  -- Metrics
  vwap_aligned boolean DEFAULT false,
  momentum_confirmed boolean DEFAULT false,
  volume_confirmed boolean DEFAULT false,
  range_position text CHECK (range_position IN ('top', 'middle', 'bottom')),
  confluence_score numeric DEFAULT 0,

  -- Blocks and advisories
  hard_blocks jsonb DEFAULT '[]'::jsonb,
  advisories jsonb DEFAULT '[]'::jsonb,

  -- Wait recommendation (if applicable)
  wait_recommendation jsonb,

  -- Timestamps
  created_at timestamptz DEFAULT now(),

  -- Outcome tracking (filled in later)
  was_executed boolean DEFAULT false,
  actual_entry_time timestamptz,
  trade_outcome text CHECK (trade_outcome IN ('win', 'loss', 'breakeven', 'pending')),
  final_pnl numeric
);

-- Enable RLS
ALTER TABLE entry_qualification_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read their own logs
CREATE POLICY "Users can read own entry qualification logs"
  ON entry_qualification_logs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy: Service role can insert logs
CREATE POLICY "Service role can insert entry qualification logs"
  ON entry_qualification_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Policy: Service role can update logs
CREATE POLICY "Service role can update entry qualification logs"
  ON entry_qualification_logs
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_entry_qual_logs_user_id ON entry_qualification_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_entry_qual_logs_session_id ON entry_qualification_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_entry_qual_logs_trade_id ON entry_qualification_logs(trade_id);
CREATE INDEX IF NOT EXISTS idx_entry_qual_logs_symbol ON entry_qualification_logs(symbol);
CREATE INDEX IF NOT EXISTS idx_entry_qual_logs_status ON entry_qualification_logs(qualification_status);
CREATE INDEX IF NOT EXISTS idx_entry_qual_logs_created_at ON entry_qualification_logs(created_at DESC);

-- Create function to analyze entry qualification performance
CREATE OR REPLACE FUNCTION analyze_entry_qualification_performance(
  p_user_id uuid,
  p_days_back integer DEFAULT 30
)
RETURNS TABLE (
  total_qualifications bigint,
  accepted_count bigint,
  rejected_count bigint,
  wait_count bigint,
  avg_quality_score numeric,
  grade_a_count bigint,
  grade_b_count bigint,
  grade_c_count bigint,
  win_rate_accepted numeric,
  win_rate_rejected numeric,
  avg_pnl_accepted numeric,
  avg_pnl_rejected numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH stats AS (
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE qualification_status = 'ACCEPT_ENTRY') as accepted,
      COUNT(*) FILTER (WHERE qualification_status = 'REJECT_ENTRY') as rejected,
      COUNT(*) FILTER (WHERE qualification_status = 'WAIT_FOR_BETTER') as wait,
      AVG(quality_score) as avg_score,
      COUNT(*) FILTER (WHERE microstructure_grade = 'A') as grade_a,
      COUNT(*) FILTER (WHERE microstructure_grade = 'B') as grade_b,
      COUNT(*) FILTER (WHERE microstructure_grade = 'C') as grade_c,

      -- Win rates
      COUNT(*) FILTER (WHERE qualification_status = 'ACCEPT_ENTRY' AND trade_outcome = 'win')::numeric /
        NULLIF(COUNT(*) FILTER (WHERE qualification_status = 'ACCEPT_ENTRY' AND trade_outcome IS NOT NULL), 0) * 100 as wr_accepted,

      COUNT(*) FILTER (WHERE qualification_status = 'REJECT_ENTRY' AND trade_outcome = 'win')::numeric /
        NULLIF(COUNT(*) FILTER (WHERE qualification_status = 'REJECT_ENTRY' AND trade_outcome IS NOT NULL), 0) * 100 as wr_rejected,

      -- Average PnL
      AVG(final_pnl) FILTER (WHERE qualification_status = 'ACCEPT_ENTRY') as avg_pnl_acc,
      AVG(final_pnl) FILTER (WHERE qualification_status = 'REJECT_ENTRY') as avg_pnl_rej
    FROM entry_qualification_logs
    WHERE user_id = p_user_id
      AND created_at >= NOW() - (p_days_back || ' days')::interval
  )
  SELECT
    total,
    accepted,
    rejected,
    wait,
    avg_score,
    grade_a,
    grade_b,
    grade_c,
    wr_accepted,
    wr_rejected,
    avg_pnl_acc,
    avg_pnl_rej
  FROM stats;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION analyze_entry_qualification_performance(uuid, integer) TO authenticated;

-- Add comment
COMMENT ON TABLE entry_qualification_logs IS 'Tracks entry qualification decisions for all trades, including M5 microstructure analysis and quality scores';
COMMENT ON FUNCTION analyze_entry_qualification_performance(uuid, integer) IS 'Analyzes entry qualification performance over time, comparing accepted vs rejected entries';
