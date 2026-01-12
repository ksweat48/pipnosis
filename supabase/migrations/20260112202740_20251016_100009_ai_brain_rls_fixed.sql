/*
  # AI Brain RLS Policies - Fixed

  1. Enable RLS on AI brain tables
  2. Create user-scoped policies for:
    - ai_trade_decisions
    - trade_options
    - strategy_comparison
    - ai_learning_metrics
*/

-- Enable RLS
ALTER TABLE ai_trade_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_comparison ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_learning_metrics ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view own AI trade decisions" ON ai_trade_decisions;
DROP POLICY IF EXISTS "Users can create own AI trade decisions" ON ai_trade_decisions;
DROP POLICY IF EXISTS "Users can update own AI trade decisions" ON ai_trade_decisions;
DROP POLICY IF EXISTS "Users can view own trade options" ON trade_options;
DROP POLICY IF EXISTS "Users can create own trade options" ON trade_options;
DROP POLICY IF EXISTS "Users can update own trade options" ON trade_options;
DROP POLICY IF EXISTS "Users can view own strategy comparisons" ON strategy_comparison;
DROP POLICY IF EXISTS "Users can create own strategy comparisons" ON strategy_comparison;
DROP POLICY IF EXISTS "Users can view own AI learning metrics" ON ai_learning_metrics;
DROP POLICY IF EXISTS "Users can create own AI learning metrics" ON ai_learning_metrics;

-- AI Trade Decisions Policies
CREATE POLICY "Users can view own AI trade decisions"
  ON ai_trade_decisions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can create own AI trade decisions"
  ON ai_trade_decisions FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own AI trade decisions"
  ON ai_trade_decisions FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Trade Options Policies
CREATE POLICY "Users can view own trade options"
  ON trade_options FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can create own trade options"
  ON trade_options FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own trade options"
  ON trade_options FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Strategy Comparison Policies
CREATE POLICY "Users can view own strategy comparisons"
  ON strategy_comparison FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can create own strategy comparisons"
  ON strategy_comparison FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- AI Learning Metrics Policies
CREATE POLICY "Users can view own AI learning metrics"
  ON ai_learning_metrics FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can create own AI learning metrics"
  ON ai_learning_metrics FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());