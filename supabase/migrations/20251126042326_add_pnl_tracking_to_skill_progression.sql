/*
  # Add PnL Tracking to Skill Progression System

  1. New Columns to `ai_skill_progression`
    - `starting_balance` (numeric) - Initial balance when tracking started
    - `current_balance` (numeric) - Latest account balance
    - `total_pnl` (numeric) - Cumulative profit/loss from all trades
    - `total_pnl_winning_trades` (numeric) - Sum of PnL from winning trades only
    - `average_pnl_per_winning_trade` (numeric) - Average profit per winning trade
    - `last_5_sessions_pnl` (numeric) - Rolling sum of last 5 session profits
    - `balance_growth_percent` (numeric) - Percentage growth from starting balance

  2. Purpose
    - Track actual profit growth, not just trade count
    - Show balance progression over time
    - Require minimum profitability to level up
    - Quality over quantity (prevent gaming with tiny wins)

  3. Security
    - Uses existing RLS policies from ai_skill_progression table
*/

-- Add PnL tracking columns to ai_skill_progression
ALTER TABLE ai_skill_progression
ADD COLUMN IF NOT EXISTS starting_balance numeric DEFAULT 10000,
ADD COLUMN IF NOT EXISTS current_balance numeric DEFAULT 10000,
ADD COLUMN IF NOT EXISTS total_pnl numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_pnl_winning_trades numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS average_pnl_per_winning_trade numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_5_sessions_pnl numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS balance_growth_percent numeric DEFAULT 0;

-- Add index for balance queries
CREATE INDEX IF NOT EXISTS idx_skill_progression_balance_growth
ON ai_skill_progression(user_id, balance_growth_percent DESC);

-- Add index for PnL queries
CREATE INDEX IF NOT EXISTS idx_skill_progression_total_pnl
ON ai_skill_progression(user_id, total_pnl DESC);

-- Add comments
COMMENT ON COLUMN ai_skill_progression.starting_balance IS 'Initial account balance when tracking started';
COMMENT ON COLUMN ai_skill_progression.current_balance IS 'Current account balance after all trades';
COMMENT ON COLUMN ai_skill_progression.total_pnl IS 'Cumulative profit/loss from all trades';
COMMENT ON COLUMN ai_skill_progression.total_pnl_winning_trades IS 'Sum of PnL from winning trades only';
COMMENT ON COLUMN ai_skill_progression.average_pnl_per_winning_trade IS 'Average profit per winning trade';
COMMENT ON COLUMN ai_skill_progression.last_5_sessions_pnl IS 'Rolling sum of last 5 sessions PnL';
COMMENT ON COLUMN ai_skill_progression.balance_growth_percent IS 'Percentage growth from starting balance';
