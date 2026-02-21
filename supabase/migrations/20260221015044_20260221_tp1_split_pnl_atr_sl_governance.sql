/*
  # TP1 Split P&L and ATR-Based SL Auto-Move System

  ## Summary
  Adds first-class support for the dual-leg trade story:
  - When TP1 is hit, a configurable percentage of the position is considered "secured"
  - The SL auto-moves to entry + ATR buffer (instrument-specific) so the trade is locked in profit
  - Both legs are stored separately so the closed card can display the full story

  ## New Columns on goal_session_trades

  ### P&L Split Tracking
  - `partial_close_pct` (numeric 5,4, default 0.50) — the fraction of the position
    considered "secured" at TP1. Configurable per-trade by Alpha (not always 50/50).
    Default 0.50 matches the existing schema default but is now formally typed.
  - `tp1_pnl` (numeric) — dollar P&L locked on the TP1 leg (entry → tp1_price on
    partial_close_pct of the lot). Populated by post-trade-analyzer on trade close.
  - `tp2_pnl` (numeric) — dollar P&L on the remaining leg (entry → exit_price on
    remaining (1 - partial_close_pct) of the lot). Populated by post-trade-analyzer.

  ### ATR-Based SL Auto-Move Tracking
  - `tp1_breakeven_price` (numeric) — the exact SL price set after TP1 fires.
    For BUY: entry + atr_buffer. For SELL: entry - atr_buffer.
    Stored for audit / mid-trade display ("SL secured above entry").
  - `sl_moved_to_breakeven_at` (timestamptz) — when the auto SL move was executed.
    NULL means TP1 has not yet been hit on this trade.

  ## Security
  - All new columns are additive (nullable / defaulted) — zero risk to existing rows.
  - No new tables or RLS policies required; columns live on the already-RLS-protected
    goal_session_trades table.

  ## SSOT / CCIP Compliance
  - partial_close_pct is set by Alpha at trade creation; post-trade-analyzer reads it.
  - tp1_pnl / tp2_pnl are written ONCE by post-trade-analyzer when the trade closes.
  - tp1_breakeven_price / sl_moved_to_breakeven_at are written ONCE by
    position-monitoring-authority when the TP1 milestone fires.
  - No other code path may write these columns (enforced by comment contracts).
*/

-- partial_close_pct: fraction of position "secured" at TP1 (0.01 – 0.99)
-- Default 0.50. Alpha may override per-trade.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'partial_close_pct'
  ) THEN
    ALTER TABLE goal_session_trades
      ADD COLUMN partial_close_pct numeric(5,4) DEFAULT 0.50
        CHECK (partial_close_pct > 0 AND partial_close_pct < 1);
  END IF;
END $$;

-- tp1_pnl: dollar P&L locked on the TP1 (secured) leg
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'tp1_pnl'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN tp1_pnl numeric(12,4);
  END IF;
END $$;

-- tp2_pnl: dollar P&L on the remaining (TP2) leg
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'tp2_pnl'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN tp2_pnl numeric(12,4);
  END IF;
END $$;

-- tp1_breakeven_price: the SL price set after TP1 fires (entry ± ATR buffer)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'tp1_breakeven_price'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN tp1_breakeven_price numeric(20,8);
  END IF;
END $$;

-- sl_moved_to_breakeven_at: timestamp when auto SL move was executed
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'sl_moved_to_breakeven_at'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN sl_moved_to_breakeven_at timestamptz;
  END IF;
END $$;

-- Performance index: quickly find trades where TP1 was hit but split P&L not yet computed
CREATE INDEX IF NOT EXISTS idx_goal_session_trades_tp1_split_pnl
  ON goal_session_trades (user_id, tp1_hit, tp1_pnl)
  WHERE tp1_hit = true AND tp1_pnl IS NULL AND status = 'closed';
