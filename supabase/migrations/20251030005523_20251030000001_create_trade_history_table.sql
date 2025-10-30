/*
  # Create Trade History Table

  1. New Tables
    - `trade_history`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to user_profiles)
      - `position_id` (uuid, reference to simulated_positions)
      - `symbol` (text, e.g., EURUSD)
      - `position_type` (text, 'buy' or 'sell')
      - `lot_size` (numeric, trade size)
      - `entry_price` (numeric, entry price)
      - `exit_price` (numeric, exit price)
      - `stop_loss` (numeric, stop loss level)
      - `take_profit` (numeric, take profit level)
      - `profit_loss` (numeric, realized P&L)
      - `opened_at` (timestamptz, when position opened)
      - `closed_at` (timestamptz, when position closed)
      - `close_reason` (text, 'manual', 'stop_loss', 'take_profit')
      - `strategy_name` (text, strategy used)
      - `notes` (text, optional user notes)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on trade_history table
    - Users can only view and manage their own trade history
    - Admins can view all trade history

  3. Indexes
    - Index on user_id and closed_at for fast historical queries
    - Index on symbol for filtering by currency pair
    - Index on profit_loss for performance analysis
*/

-- ============================================================================
-- STEP 1: Create trade_history table
-- ============================================================================

CREATE TABLE IF NOT EXISTS trade_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  position_id uuid REFERENCES simulated_positions(id) ON DELETE SET NULL,
  symbol text NOT NULL,
  position_type text NOT NULL CHECK (position_type IN ('buy', 'sell')),
  lot_size numeric(10,2) NOT NULL DEFAULT 0.01,
  entry_price numeric(15,5) NOT NULL,
  exit_price numeric(15,5) NOT NULL,
  stop_loss numeric(15,5),
  take_profit numeric(15,5),
  profit_loss numeric(15,2) NOT NULL DEFAULT 0,
  opened_at timestamptz NOT NULL,
  closed_at timestamptz NOT NULL,
  close_reason text CHECK (close_reason IN ('manual', 'stop_loss', 'take_profit')),
  strategy_name text,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- STEP 2: Create indexes for performance
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_trade_history_user_closed
  ON trade_history(user_id, closed_at DESC);

CREATE INDEX IF NOT EXISTS idx_trade_history_symbol
  ON trade_history(symbol);

CREATE INDEX IF NOT EXISTS idx_trade_history_profit_loss
  ON trade_history(profit_loss DESC);

CREATE INDEX IF NOT EXISTS idx_trade_history_position_type
  ON trade_history(position_type);

-- ============================================================================
-- STEP 3: Enable Row Level Security
-- ============================================================================

ALTER TABLE trade_history ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- STEP 4: Create RLS Policies for trade_history
-- ============================================================================

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view own trade history" ON trade_history;
DROP POLICY IF EXISTS "Users can insert own trade history" ON trade_history;
DROP POLICY IF EXISTS "Users can update own trade history" ON trade_history;
DROP POLICY IF EXISTS "Admins can view all trade history" ON trade_history;

-- Users can view their own trade history
CREATE POLICY "Users can view own trade history"
  ON trade_history FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can insert their own trade history
CREATE POLICY "Users can insert own trade history"
  ON trade_history FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own trade history (for notes, etc.)
CREATE POLICY "Users can update own trade history"
  ON trade_history FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Admins can view all trade history
CREATE POLICY "Admins can view all trade history"
  ON trade_history FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- ============================================================================
-- STEP 5: Create function to get trade statistics
-- ============================================================================

CREATE OR REPLACE FUNCTION get_trade_statistics(p_user_id uuid)
RETURNS TABLE (
  total_trades bigint,
  winning_trades bigint,
  losing_trades bigint,
  win_rate numeric,
  total_profit numeric,
  total_loss numeric,
  net_profit numeric,
  average_win numeric,
  average_loss numeric,
  best_trade numeric,
  worst_trade numeric,
  average_trade_duration interval
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::bigint as total_trades,
    COUNT(CASE WHEN profit_loss > 0 THEN 1 END)::bigint as winning_trades,
    COUNT(CASE WHEN profit_loss < 0 THEN 1 END)::bigint as losing_trades,
    CASE
      WHEN COUNT(*) > 0 THEN
        ROUND((COUNT(CASE WHEN profit_loss > 0 THEN 1 END)::numeric / COUNT(*)::numeric) * 100, 2)
      ELSE 0
    END as win_rate,
    COALESCE(SUM(CASE WHEN profit_loss > 0 THEN profit_loss ELSE 0 END), 0) as total_profit,
    COALESCE(SUM(CASE WHEN profit_loss < 0 THEN ABS(profit_loss) ELSE 0 END), 0) as total_loss,
    COALESCE(SUM(profit_loss), 0) as net_profit,
    COALESCE(AVG(CASE WHEN profit_loss > 0 THEN profit_loss END), 0) as average_win,
    COALESCE(AVG(CASE WHEN profit_loss < 0 THEN ABS(profit_loss) END), 0) as average_loss,
    COALESCE(MAX(profit_loss), 0) as best_trade,
    COALESCE(MIN(profit_loss), 0) as worst_trade,
    COALESCE(AVG(closed_at - opened_at), INTERVAL '0') as average_trade_duration
  FROM trade_history
  WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;