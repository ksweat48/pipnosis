/*
  # Add Comprehensive Analytics to Synthetic Backtest Schema

  1. Schema Changes
    - Add detailed analytics columns to `synthetic_backtest_sessions` table
    - Store comprehensive trade statistics, loss analysis, win analysis
    - Store improvement recommendations and grade breakdowns
    - Enable rich analytics reporting in UI

  2. New Columns Added to synthetic_backtest_sessions
    - Trade Analytics: avg_win_amount, avg_loss_amount, avg_trade_spend, best_trade, worst_trade
    - Loss Analysis: loss_categories (jsonb), loss_patterns, improvement_opportunities
    - Win Analysis: win_categories (jsonb), success_patterns, strength_areas
    - Time Distribution: time_distribution (jsonb)
    - Recommendations: recommendations (jsonb array)
    - Grading: overall_grade, grade_breakdown (jsonb)

  3. Important Notes
    - All new fields are nullable to support backward compatibility
    - JSONB used for complex nested data structures
    - Analytics calculated in application layer then persisted
    - Enables comprehensive reporting without multiple queries
*/

-- Add comprehensive analytics columns to synthetic_backtest_sessions
ALTER TABLE synthetic_backtest_sessions
ADD COLUMN IF NOT EXISTS avg_win_amount numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS avg_loss_amount numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS avg_trade_spend numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS avg_trade_size numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS best_trade jsonb,
ADD COLUMN IF NOT EXISTS worst_trade jsonb,
ADD COLUMN IF NOT EXISTS expectancy numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS avg_win_duration_minutes numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS avg_loss_duration_minutes numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS avg_risk_reward_actual numeric DEFAULT 0;

-- Loss analysis fields
ALTER TABLE synthetic_backtest_sessions
ADD COLUMN IF NOT EXISTS loss_categories jsonb,
ADD COLUMN IF NOT EXISTS loss_common_patterns text[],
ADD COLUMN IF NOT EXISTS loss_improvement_opportunities text[];

-- Win analysis fields
ALTER TABLE synthetic_backtest_sessions
ADD COLUMN IF NOT EXISTS win_categories jsonb,
ADD COLUMN IF NOT EXISTS win_success_patterns text[],
ADD COLUMN IF NOT EXISTS win_strength_areas text[];

-- Time distribution analysis
ALTER TABLE synthetic_backtest_sessions
ADD COLUMN IF NOT EXISTS time_distribution jsonb;

-- Recommendations and grading
ALTER TABLE synthetic_backtest_sessions
ADD COLUMN IF NOT EXISTS recommendations jsonb,
ADD COLUMN IF NOT EXISTS overall_grade text,
ADD COLUMN IF NOT EXISTS grade_breakdown jsonb;

-- Add comments for documentation
COMMENT ON COLUMN synthetic_backtest_sessions.avg_win_amount IS 'Average dollar amount per winning trade';
COMMENT ON COLUMN synthetic_backtest_sessions.avg_loss_amount IS 'Average dollar amount per losing trade (absolute value)';
COMMENT ON COLUMN synthetic_backtest_sessions.avg_trade_spend IS 'Average position size across all trades';
COMMENT ON COLUMN synthetic_backtest_sessions.best_trade IS 'JSON with details of best performing trade {pnl, symbol, time}';
COMMENT ON COLUMN synthetic_backtest_sessions.worst_trade IS 'JSON with details of worst performing trade {pnl, symbol, time}';
COMMENT ON COLUMN synthetic_backtest_sessions.loss_categories IS 'Breakdown of losses by category: stopped_out_early, wrong_direction, poor_timing, market_reversal';
COMMENT ON COLUMN synthetic_backtest_sessions.win_categories IS 'Breakdown of wins by category: quick_wins, patient_wins, perfect_execution, partial_profit';
COMMENT ON COLUMN synthetic_backtest_sessions.time_distribution IS 'Performance analysis by hour and day of week';
COMMENT ON COLUMN synthetic_backtest_sessions.recommendations IS 'Array of improvement recommendations with priority, category, issue, and solution';
COMMENT ON COLUMN synthetic_backtest_sessions.overall_grade IS 'Overall performance grade: A+, A, B, C, D, F';
COMMENT ON COLUMN synthetic_backtest_sessions.grade_breakdown IS 'Scores for profitability, consistency, risk_management, execution';
