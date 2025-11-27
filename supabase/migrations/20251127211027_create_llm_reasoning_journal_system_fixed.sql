/*
  # LLM Reasoning Journal & Decision Logging System

  Creates comprehensive system for capturing LLM decisions for transparency and learning.

  ## Tables
  1. ai_trade_journal - User-facing journal with natural language explanations
  2. llm_decision_log - Admin detailed logging across all 5 layers
  3. goal_session_summaries - Session Intelligence for goal-based trades
  4. trade_accuracy_tracking - Confidence calibration and prediction accuracy

  ## Triggers
  - Auto-update goal_session_summaries when trades close
  - Auto-update ai_trader_score from goal-based trades
*/

-- =====================================================
-- 1. AI Trade Journal (User-Facing)
-- =====================================================

CREATE TABLE IF NOT EXISTS ai_trade_journal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trade_id uuid,
  session_id uuid,
  symbol text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('buy', 'sell')),
  entry_time timestamptz NOT NULL DEFAULT now(),
  exit_time timestamptz,
  entry_price numeric NOT NULL,
  exit_price numeric,
  stop_loss numeric,
  take_profit numeric,
  llm_reasoning text,
  market_read text,
  expected_outcome text,
  pattern_identified text,
  conviction_level numeric,
  rank_at_time text,
  actual_outcome text,
  was_prediction_correct boolean,
  accuracy_score numeric,
  lesson_learned text,
  mistake_identified text,
  what_worked text,
  pnl numeric DEFAULT 0,
  outcome text CHECK (outcome IN ('win', 'loss', 'breakeven', 'open')),
  journal_entry_type text DEFAULT 'trade' CHECK (journal_entry_type IN ('trade', 'analysis', 'learning')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_trade_journal_user ON ai_trade_journal(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_trade_journal_session ON ai_trade_journal(session_id);
CREATE INDEX IF NOT EXISTS idx_ai_trade_journal_time ON ai_trade_journal(entry_time DESC);
CREATE INDEX IF NOT EXISTS idx_ai_trade_journal_outcome ON ai_trade_journal(outcome);

ALTER TABLE ai_trade_journal ENABLE ROW LEVEL SECURITY;

CREATE POLICY "journal_select_own" ON ai_trade_journal FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "journal_insert_service" ON ai_trade_journal FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "journal_update_service" ON ai_trade_journal FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "journal_insert_own" ON ai_trade_journal FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "journal_update_own" ON ai_trade_journal FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =====================================================
-- 2. LLM Decision Log (Admin)
-- =====================================================

CREATE TABLE IF NOT EXISTS llm_decision_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trade_id uuid,
  session_id uuid,
  decision_layer text NOT NULL CHECK (decision_layer IN ('layer1_safety', 'layer2_regime', 'layer3_pattern', 'layer4_risk', 'layer5_llm', 'execution', 'monitoring', 'closure')),
  decision_type text NOT NULL CHECK (decision_type IN ('execute', 'skip', 'adjust', 'analyze', 'close', 'monitor')),
  decision_outcome text NOT NULL,
  llm_prompt text,
  llm_response text,
  reasoning_json jsonb,
  model_used text,
  tokens_used integer,
  response_time_ms integer,
  timestamp timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_llm_log_user ON llm_decision_log(user_id);
CREATE INDEX IF NOT EXISTS idx_llm_log_trade ON llm_decision_log(trade_id);
CREATE INDEX IF NOT EXISTS idx_llm_log_layer ON llm_decision_log(decision_layer);

ALTER TABLE llm_decision_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "log_admin_select" ON llm_decision_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin'));
CREATE POLICY "log_service_insert" ON llm_decision_log FOR INSERT TO service_role WITH CHECK (true);

-- =====================================================
-- 3. Goal Session Summaries
-- =====================================================

CREATE TABLE IF NOT EXISTS goal_session_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_session_id uuid NOT NULL REFERENCES goal_sessions(id) ON DELETE CASCADE,
  total_trades integer DEFAULT 0,
  winning_trades integer DEFAULT 0,
  losing_trades integer DEFAULT 0,
  win_rate numeric DEFAULT 0,
  profit_factor numeric DEFAULT 0,
  pnl numeric DEFAULT 0,
  key_learnings jsonb DEFAULT '[]'::jsonb,
  llm_deep_analysis jsonb,
  patterns_identified jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(goal_session_id)
);

CREATE INDEX IF NOT EXISTS idx_goal_summaries_user ON goal_session_summaries(user_id);
CREATE INDEX IF NOT EXISTS idx_goal_summaries_session ON goal_session_summaries(goal_session_id);

ALTER TABLE goal_session_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "summaries_select_own" ON goal_session_summaries FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "summaries_service" ON goal_session_summaries FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "summaries_insert_own" ON goal_session_summaries FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "summaries_update_own" ON goal_session_summaries FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =====================================================
-- 4. Trade Accuracy Tracking
-- =====================================================

CREATE TABLE IF NOT EXISTS trade_accuracy_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trade_id uuid NOT NULL,
  journal_entry_id uuid REFERENCES ai_trade_journal(id),
  predicted_outcome text,
  actual_outcome text,
  prediction_correct boolean,
  llm_confidence numeric,
  pattern_name text,
  pattern_worked boolean,
  trade_date timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accuracy_user ON trade_accuracy_tracking(user_id);
CREATE INDEX IF NOT EXISTS idx_accuracy_trade ON trade_accuracy_tracking(trade_id);

ALTER TABLE trade_accuracy_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "accuracy_select_own" ON trade_accuracy_tracking FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "accuracy_service" ON trade_accuracy_tracking FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =====================================================
-- 5. Realtime
-- =====================================================

ALTER PUBLICATION supabase_realtime ADD TABLE ai_trade_journal;
ALTER PUBLICATION supabase_realtime ADD TABLE goal_session_summaries;

-- =====================================================
-- 6. Triggers
-- =====================================================

CREATE OR REPLACE FUNCTION update_goal_session_summary()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'closed' AND NEW.goal_session_id IS NOT NULL THEN
    INSERT INTO goal_session_summaries (user_id, goal_session_id, total_trades, winning_trades, losing_trades, pnl)
    VALUES (NEW.user_id, NEW.goal_session_id, 1, CASE WHEN NEW.pnl > 0 THEN 1 ELSE 0 END, CASE WHEN NEW.pnl < 0 THEN 1 ELSE 0 END, COALESCE(NEW.pnl, 0))
    ON CONFLICT (goal_session_id) DO UPDATE SET
      total_trades = goal_session_summaries.total_trades + 1,
      winning_trades = goal_session_summaries.winning_trades + CASE WHEN NEW.pnl > 0 THEN 1 ELSE 0 END,
      losing_trades = goal_session_summaries.losing_trades + CASE WHEN NEW.pnl < 0 THEN 1 ELSE 0 END,
      pnl = goal_session_summaries.pnl + COALESCE(NEW.pnl, 0),
      win_rate = CASE WHEN (goal_session_summaries.total_trades + 1) > 0
        THEN ((goal_session_summaries.winning_trades + CASE WHEN NEW.pnl > 0 THEN 1 ELSE 0 END)::numeric / (goal_session_summaries.total_trades + 1)::numeric) * 100
        ELSE 0 END,
      updated_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_goal_summary ON simulated_positions;
CREATE TRIGGER trg_update_goal_summary AFTER UPDATE ON simulated_positions FOR EACH ROW EXECUTE FUNCTION update_goal_session_summary();

CREATE OR REPLACE FUNCTION update_trader_score_from_goal()
RETURNS TRIGGER AS $$
DECLARE
  v_total integer; v_wins integer; v_losses integer; v_rate numeric;
BEGIN
  IF NEW.status = 'closed' AND OLD.status != 'closed' THEN
    SELECT COALESCE(total_trades,0), COALESCE(total_wins,0), COALESCE(total_losses,0)
    INTO v_total, v_wins, v_losses FROM ai_trader_score WHERE user_id = NEW.user_id;
    
    v_total := v_total + 1;
    IF NEW.pnl > 0 THEN v_wins := v_wins + 1; ELSIF NEW.pnl < 0 THEN v_losses := v_losses + 1; END IF;
    v_rate := CASE WHEN v_total > 0 THEN (v_wins::numeric / v_total::numeric) * 100 ELSE 0 END;
    
    INSERT INTO ai_trader_score (user_id, total_trades, total_wins, total_losses, win_rate, lifetime_profit, lifetime_loss, updated_at)
    VALUES (NEW.user_id, v_total, v_wins, v_losses, v_rate, CASE WHEN NEW.pnl > 0 THEN NEW.pnl ELSE 0 END, CASE WHEN NEW.pnl < 0 THEN ABS(NEW.pnl) ELSE 0 END, now())
    ON CONFLICT (user_id) DO UPDATE SET
      total_trades = v_total, total_wins = v_wins, total_losses = v_losses, win_rate = v_rate,
      lifetime_profit = ai_trader_score.lifetime_profit + CASE WHEN NEW.pnl > 0 THEN NEW.pnl ELSE 0 END,
      lifetime_loss = ai_trader_score.lifetime_loss + CASE WHEN NEW.pnl < 0 THEN ABS(NEW.pnl) ELSE 0 END,
      updated_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_trader_score ON simulated_positions;
CREATE TRIGGER trg_update_trader_score AFTER UPDATE ON simulated_positions FOR EACH ROW EXECUTE FUNCTION update_trader_score_from_goal();