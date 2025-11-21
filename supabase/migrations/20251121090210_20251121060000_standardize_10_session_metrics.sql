/*
  # Standardize All Metrics to 10-Session Cycles

  1. Changes to ai_skill_progression
    - Add `last_10_session_wr_avg` - Average win rate over last 10 sessions
    - Add `last_10_session_pf_avg` - Average profit factor over last 10 sessions
    - Add `last_10_session_consistency_pct` - Consistency percentage (% of sessions meeting thresholds)
    - Add `total_losing_trades` - Track total losing trades separately from winning trades

  2. Changes to plateau_detection_log
    - Add `profit_factor_min` - Minimum PF in 10-session window
    - Add `profit_factor_max` - Maximum PF in 10-session window
    - Add `profit_factor_avg` - Average PF in 10-session window
    - Add `profit_factor_spread` - PF range (max - min)

  3. Security
    - Maintain existing RLS policies
    - All columns nullable to allow gradual backfill
*/

-- Add 10-session tracking columns to ai_skill_progression
ALTER TABLE ai_skill_progression
ADD COLUMN IF NOT EXISTS last_10_session_wr_avg numeric(5,2),
ADD COLUMN IF NOT EXISTS last_10_session_pf_avg numeric(5,2),
ADD COLUMN IF NOT EXISTS last_10_session_consistency_pct numeric(5,2),
ADD COLUMN IF NOT EXISTS total_losing_trades integer DEFAULT 0;

-- Add profit factor range tracking to plateau_detection_log
ALTER TABLE plateau_detection_log
ADD COLUMN IF NOT EXISTS profit_factor_min numeric(5,2),
ADD COLUMN IF NOT EXISTS profit_factor_max numeric(5,2),
ADD COLUMN IF NOT EXISTS profit_factor_avg numeric(5,2),
ADD COLUMN IF NOT EXISTS profit_factor_spread numeric(5,2);

-- Create index for efficient 10-session queries
CREATE INDEX IF NOT EXISTS idx_daily_session_results_user_date
ON daily_session_results(user_id, session_date DESC);

CREATE INDEX IF NOT EXISTS idx_synthetic_backtest_sessions_user_date
ON synthetic_backtest_sessions(user_id, created_at DESC);

-- Add comment explaining the 10-session standard
COMMENT ON COLUMN ai_skill_progression.last_10_session_wr_avg IS
'Average win rate over last 10 completed sessions - used for skill level advancement';

COMMENT ON COLUMN ai_skill_progression.last_10_session_pf_avg IS
'Average profit factor over last 10 completed sessions - used for skill level advancement';

COMMENT ON COLUMN ai_skill_progression.last_10_session_consistency_pct IS
'Percentage of last 10 sessions that met minimum performance thresholds (0-100)';

COMMENT ON COLUMN ai_skill_progression.total_losing_trades IS
'Total number of losing trades analyzed - tracked separately from winning trades for transparency';
