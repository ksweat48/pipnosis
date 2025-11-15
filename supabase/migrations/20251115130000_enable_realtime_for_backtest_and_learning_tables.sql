/*
  # Enable Realtime for Backtest and Learning Tables

  1. Purpose
    - Enable Supabase Realtime on all backtest and AI learning tables
    - Allow real-time subscriptions to detect when backtests complete
    - Enable live updates for skill progression and learning insights

  2. Tables with Realtime Enabled
    - `backtest_sessions` - Real data backtest sessions
    - `synthetic_backtest_sessions` - Synthetic data backtest sessions
    - `backtest_trades` - Individual trades from backtests
    - `synthetic_backtest_trades` - Trades from synthetic backtests
    - `ai_skill_progression` - AI skill level and progression data
    - `ai_learning_insights` - Learning insights from trades
    - `ai_learning_milestones` - Achievement milestones
    - `ai_indicator_experiments` - Indicator testing experiments

  3. Security
    - Realtime subscriptions respect existing RLS policies
    - Users can only subscribe to their own data
    - No changes to existing security policies
*/

-- Enable realtime for backtest session tables
ALTER PUBLICATION supabase_realtime ADD TABLE backtest_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE synthetic_backtest_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE backtest_trades;
ALTER PUBLICATION supabase_realtime ADD TABLE synthetic_backtest_trades;

-- Enable realtime for AI learning tables
ALTER PUBLICATION supabase_realtime ADD TABLE ai_skill_progression;
ALTER PUBLICATION supabase_realtime ADD TABLE ai_learning_insights;
ALTER PUBLICATION supabase_realtime ADD TABLE ai_learning_milestones;
ALTER PUBLICATION supabase_realtime ADD TABLE ai_indicator_experiments;

-- Enable realtime for pattern and strategy tables
ALTER PUBLICATION supabase_realtime ADD TABLE ai_pattern_ev_tracking;
ALTER PUBLICATION supabase_realtime ADD TABLE ai_discovered_strategies;

-- Add indexes for better realtime performance on user_id filters
CREATE INDEX IF NOT EXISTS idx_backtest_sessions_user_created
  ON backtest_sessions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_synthetic_backtest_sessions_user_created
  ON synthetic_backtest_sessions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_learning_insights_user_created
  ON ai_learning_insights(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_learning_milestones_user_created
  ON ai_learning_milestones(user_id, achieved_at DESC);

-- Verify realtime is working by adding a trigger to log backtest completions
CREATE OR REPLACE FUNCTION log_backtest_completion()
RETURNS TRIGGER AS $$
BEGIN
  RAISE NOTICE 'Backtest session % completed for user %', NEW.id, NEW.user_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Optional: Attach trigger for debugging (can be removed in production)
DROP TRIGGER IF EXISTS trigger_log_backtest_completion ON backtest_sessions;
CREATE TRIGGER trigger_log_backtest_completion
  AFTER INSERT ON backtest_sessions
  FOR EACH ROW
  EXECUTE FUNCTION log_backtest_completion();

DROP TRIGGER IF EXISTS trigger_log_synthetic_backtest_completion ON synthetic_backtest_sessions;
CREATE TRIGGER trigger_log_synthetic_backtest_completion
  AFTER INSERT ON synthetic_backtest_sessions
  FOR EACH ROW
  EXECUTE FUNCTION log_backtest_completion();
