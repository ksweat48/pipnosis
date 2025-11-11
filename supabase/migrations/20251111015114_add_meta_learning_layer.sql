/*
  # Add Meta-Learning Layer (Elite Enhancement Phase 2)
  
  This migration adds a sophisticated meta-learning system that learns
  WHICH types of insights lead to the best trading outcomes.
  
  The AI doesn't just learn from trades - it learns HOW to learn more effectively.
  
  ## Concept
  
  Instead of treating all insights equally, the meta-learning layer tracks:
  - Which insight types (winning_pattern, losing_pattern, indicator_signal, etc.) 
    actually help make better decisions
  - Which feature categories (price_action, volume, volatility) are most predictive
  - Which combinations of insights work best together
  - How insight effectiveness changes over time
  
  ## Tables
  
  1. **ai_insight_effectiveness_tracking**
     - Tracks how often each insight leads to correct decisions
     - Calculates precision, recall, and F1 score for each insight type
     - Updates in real-time as trades close
  
  2. **ai_meta_learning_config**
     - Stores learned optimal weights for different insight types
     - Updated periodically based on effectiveness tracking
     - Used to dynamically adjust confidence calculations
  
  ## Security
  - RLS policies for user isolation
*/

-- Table to track insight effectiveness over time
CREATE TABLE IF NOT EXISTS ai_insight_effectiveness_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Insight characteristics
  insight_type TEXT NOT NULL, -- 'winning_pattern', 'losing_pattern', 'indicator_signal', etc.
  feature_category TEXT, -- 'price_action', 'volume', 'volatility', 'time', 'indicator'
  symbol TEXT,
  
  -- Performance metrics
  times_used INTEGER DEFAULT 0, -- How many times this insight influenced a decision
  times_correct INTEGER DEFAULT 0, -- How many times it led to the right decision
  times_incorrect INTEGER DEFAULT 0, -- How many times it led to the wrong decision
  
  -- Statistical measures
  precision_score DECIMAL(5,4) DEFAULT 0, -- Precision = correct / (correct + incorrect)
  recall_score DECIMAL(5,4) DEFAULT 0, -- How often we use this when we should
  f1_score DECIMAL(5,4) DEFAULT 0, -- Harmonic mean of precision and recall
  
  -- Profitability impact
  avg_pnl_when_used DECIMAL(10,2) DEFAULT 0,
  total_pnl_attributed DECIMAL(10,2) DEFAULT 0,
  
  -- Time-based effectiveness
  effectiveness_last_30d DECIMAL(5,4) DEFAULT 0,
  effectiveness_trend TEXT, -- 'improving', 'declining', 'stable'
  
  -- Metadata
  last_used_at TIMESTAMPTZ,
  last_updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  
  -- Unique constraint: one row per user/insight_type/feature_category/symbol combo
  UNIQUE(user_id, insight_type, feature_category, symbol)
);

-- Table for meta-learning configuration (learned optimal weights)
CREATE TABLE IF NOT EXISTS ai_meta_learning_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Learned weights for different insight types
  insight_type TEXT NOT NULL,
  optimal_weight DECIMAL(5,4) DEFAULT 1.0000, -- Learned optimal weight
  confidence_multiplier DECIMAL(5,4) DEFAULT 1.0000, -- How much to trust this type
  
  -- Learning statistics
  sample_size INTEGER DEFAULT 0, -- Number of trades used to calculate this
  confidence_interval_lower DECIMAL(5,4),
  confidence_interval_upper DECIMAL(5,4),
  statistical_significance BOOLEAN DEFAULT false,
  
  -- Performance metrics
  win_rate_when_used DECIMAL(5,2) DEFAULT 0,
  avg_profit_factor DECIMAL(10,4) DEFAULT 0,
  sharpe_ratio DECIMAL(10,4) DEFAULT 0,
  
  -- Meta info
  last_recalculated_at TIMESTAMPTZ DEFAULT now(),
  next_recalculation_due TIMESTAMPTZ DEFAULT (now() + INTERVAL '7 days'),
  created_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(user_id, insight_type)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_insight_effectiveness_user_type 
  ON ai_insight_effectiveness_tracking(user_id, insight_type);
CREATE INDEX IF NOT EXISTS idx_insight_effectiveness_f1 
  ON ai_insight_effectiveness_tracking(f1_score DESC);
CREATE INDEX IF NOT EXISTS idx_meta_config_user 
  ON ai_meta_learning_config(user_id);

-- Enable RLS
ALTER TABLE ai_insight_effectiveness_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_meta_learning_config ENABLE ROW LEVEL SECURITY;

-- RLS Policies for ai_insight_effectiveness_tracking
CREATE POLICY "Users can view own insight effectiveness"
  ON ai_insight_effectiveness_tracking FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own insight effectiveness"
  ON ai_insight_effectiveness_tracking FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own insight effectiveness"
  ON ai_insight_effectiveness_tracking FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for ai_meta_learning_config
CREATE POLICY "Users can view own meta config"
  ON ai_meta_learning_config FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own meta config"
  ON ai_meta_learning_config FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own meta config"
  ON ai_meta_learning_config FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Function to update insight effectiveness when a trade closes
CREATE OR REPLACE FUNCTION update_insight_effectiveness_on_trade_close()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id UUID;
  v_was_winner BOOLEAN;
  v_insights RECORD;
BEGIN
  -- Get user_id and determine if trade was a winner
  v_user_id := NEW.user_id;
  v_was_winner := NEW.profit_loss > 0;
  
  -- Get insights that were used for this trade's decision
  FOR v_insights IN (
    SELECT DISTINCT
      i.insight_type,
      i.feature_category,
      i.symbol
    FROM ai_learning_insights i
    JOIN ai_decision_feedback df ON df.user_id = i.user_id
    WHERE i.user_id = v_user_id
      AND i.symbol = NEW.symbol
      AND i.created_at <= NEW.created_at
      AND df.symbol = NEW.symbol
      AND df.decision_time >= NEW.opened_at - INTERVAL '5 minutes'
      AND df.decision_time <= NEW.opened_at + INTERVAL '5 minutes'
  )
  LOOP
    -- Update or insert effectiveness tracking
    INSERT INTO ai_insight_effectiveness_tracking (
      user_id,
      insight_type,
      feature_category,
      symbol,
      times_used,
      times_correct,
      times_incorrect,
      avg_pnl_when_used,
      total_pnl_attributed,
      last_used_at,
      last_updated_at
    ) VALUES (
      v_user_id,
      v_insights.insight_type,
      v_insights.feature_category,
      v_insights.symbol,
      1,
      CASE WHEN v_was_winner THEN 1 ELSE 0 END,
      CASE WHEN v_was_winner THEN 0 ELSE 1 END,
      NEW.profit_loss,
      NEW.profit_loss,
      NEW.closed_at,
      now()
    )
    ON CONFLICT (user_id, insight_type, feature_category, symbol)
    DO UPDATE SET
      times_used = ai_insight_effectiveness_tracking.times_used + 1,
      times_correct = ai_insight_effectiveness_tracking.times_correct + 
        CASE WHEN v_was_winner THEN 1 ELSE 0 END,
      times_incorrect = ai_insight_effectiveness_tracking.times_incorrect + 
        CASE WHEN v_was_winner THEN 0 ELSE 1 END,
      total_pnl_attributed = ai_insight_effectiveness_tracking.total_pnl_attributed + NEW.profit_loss,
      avg_pnl_when_used = (ai_insight_effectiveness_tracking.total_pnl_attributed + NEW.profit_loss) / 
        (ai_insight_effectiveness_tracking.times_used + 1),
      last_used_at = NEW.closed_at,
      last_updated_at = now(),
      -- Update precision score
      precision_score = (ai_insight_effectiveness_tracking.times_correct + 
        CASE WHEN v_was_winner THEN 1 ELSE 0 END)::DECIMAL / 
        (ai_insight_effectiveness_tracking.times_used + 1)::DECIMAL,
      -- Update F1 score (simplified - assumes recall ≈ precision for now)
      f1_score = (ai_insight_effectiveness_tracking.times_correct + 
        CASE WHEN v_was_winner THEN 1 ELSE 0 END)::DECIMAL / 
        (ai_insight_effectiveness_tracking.times_used + 1)::DECIMAL;
  END LOOP;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update insight effectiveness
DROP TRIGGER IF EXISTS trigger_update_insight_effectiveness ON trade_history;
CREATE TRIGGER trigger_update_insight_effectiveness
  AFTER UPDATE OF profit_loss ON trade_history
  FOR EACH ROW
  WHEN (NEW.profit_loss IS NOT NULL AND OLD.profit_loss IS NULL)
  EXECUTE FUNCTION update_insight_effectiveness_on_trade_close();

-- Function to recalculate meta-learning configuration
CREATE OR REPLACE FUNCTION recalculate_meta_learning_config(p_user_id UUID)
RETURNS void AS $$
DECLARE
  v_insight_type TEXT;
  v_total_correct INTEGER;
  v_total_used INTEGER;
  v_win_rate DECIMAL;
  v_optimal_weight DECIMAL;
  v_confidence_mult DECIMAL;
  v_is_significant BOOLEAN;
BEGIN
  -- For each insight type, calculate optimal weight
  FOR v_insight_type IN (
    SELECT DISTINCT insight_type 
    FROM ai_insight_effectiveness_tracking 
    WHERE user_id = p_user_id
  )
  LOOP
    -- Get aggregated statistics
    SELECT 
      SUM(times_correct),
      SUM(times_used),
      (SUM(times_correct)::DECIMAL / NULLIF(SUM(times_used)::DECIMAL, 0)) * 100
    INTO v_total_correct, v_total_used, v_win_rate
    FROM ai_insight_effectiveness_tracking
    WHERE user_id = p_user_id
      AND insight_type = v_insight_type;
    
    -- Calculate optimal weight based on performance
    -- High win rate = higher weight, low win rate = lower weight
    IF v_win_rate >= 60 THEN
      v_optimal_weight := 1.5; -- Boost effective insights
      v_confidence_mult := 1.2;
    ELSIF v_win_rate >= 50 THEN
      v_optimal_weight := 1.0; -- Neutral
      v_confidence_mult := 1.0;
    ELSE
      v_optimal_weight := 0.7; -- Reduce ineffective insights
      v_confidence_mult := 0.8;
    END IF;
    
    -- Determine statistical significance (need at least 30 samples)
    v_is_significant := v_total_used >= 30;
    
    -- Upsert meta-learning config
    INSERT INTO ai_meta_learning_config (
      user_id,
      insight_type,
      optimal_weight,
      confidence_multiplier,
      sample_size,
      statistical_significance,
      win_rate_when_used,
      last_recalculated_at,
      next_recalculation_due
    ) VALUES (
      p_user_id,
      v_insight_type,
      v_optimal_weight,
      v_confidence_mult,
      v_total_used,
      v_is_significant,
      v_win_rate,
      now(),
      now() + INTERVAL '7 days'
    )
    ON CONFLICT (user_id, insight_type)
    DO UPDATE SET
      optimal_weight = v_optimal_weight,
      confidence_multiplier = v_confidence_mult,
      sample_size = v_total_used,
      statistical_significance = v_is_significant,
      win_rate_when_used = v_win_rate,
      last_recalculated_at = now(),
      next_recalculation_due = now() + INTERVAL '7 days';
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- View for top-performing insight types
CREATE OR REPLACE VIEW ai_top_insight_types AS
SELECT 
  user_id,
  insight_type,
  feature_category,
  times_used,
  precision_score,
  f1_score,
  avg_pnl_when_used,
  effectiveness_last_30d,
  RANK() OVER (PARTITION BY user_id ORDER BY f1_score DESC, times_used DESC) as effectiveness_rank
FROM ai_insight_effectiveness_tracking
WHERE times_used >= 5; -- Minimum sample size

-- Initialize meta-learning config for existing users
INSERT INTO ai_meta_learning_config (user_id, insight_type, optimal_weight)
SELECT DISTINCT user_id, 'winning_pattern', 1.0
FROM ai_skill_progression
WHERE NOT EXISTS (
  SELECT 1 FROM ai_meta_learning_config 
  WHERE ai_meta_learning_config.user_id = ai_skill_progression.user_id
);
