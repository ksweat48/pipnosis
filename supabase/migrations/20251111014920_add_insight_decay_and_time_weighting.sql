/*
  # Add Insight Decay and Time-Weighted Metrics (Elite Enhancement Phase 1)
  
  This migration adds sophisticated temporal weighting to the AI learning system:
  
  ## 1. Insight Decay Function
     - Insights lose relevance over time (market regimes change)
     - Base weight halves every 60 days
     - Prevents stale patterns from skewing current decisions
  
  ## 2. Time-Weighted Profit Factor
     - Recent performance weighted more heavily than old performance
     - Uses exponential smoothing to favor current market regime
     - Keeps skill progression reflective of current capability
  
  ## 3. Feature Attribution Tracking
     - Track which factors contributed to each insight
     - Enables SHAP-like interpretability
     - Foundation for meta-learning layer
  
  ## Changes
  
  1. **ai_learning_insights** - Add decay tracking
     - `base_weight` - Original weight before decay
     - `last_decay_calculated_at` - When decay was last computed
  
  2. **ai_skill_progression** - Add time-weighted metrics
     - `time_weighted_profit_factor` - Exponentially smoothed profit factor
     - `recent_30d_win_rate` - Last 30 days win rate
     - `recent_30d_profit_factor` - Last 30 days profit factor
     - `learning_velocity_30d` - Recent learning speed
  
  3. **ai_feature_attribution** - New table for interpretability
     - Tracks which features contributed to each insight
     - Enables meta-learning and pattern analysis
  
  ## Security
  - RLS policies applied to all new tables
  - Only authenticated users can access their own data
*/

-- Add decay tracking columns to ai_learning_insights
ALTER TABLE ai_learning_insights
ADD COLUMN IF NOT EXISTS base_weight DECIMAL(5,4) DEFAULT 1.0000,
ADD COLUMN IF NOT EXISTS last_decay_calculated_at TIMESTAMPTZ DEFAULT now();

-- Add time-weighted metrics to ai_skill_progression
ALTER TABLE ai_skill_progression
ADD COLUMN IF NOT EXISTS time_weighted_profit_factor DECIMAL(10,4) DEFAULT 0,
ADD COLUMN IF NOT EXISTS recent_30d_win_rate DECIMAL(5,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS recent_30d_profit_factor DECIMAL(10,4) DEFAULT 0,
ADD COLUMN IF NOT EXISTS learning_velocity_30d DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_time_weight_update TIMESTAMPTZ DEFAULT now();

-- Create feature attribution table for interpretability
CREATE TABLE IF NOT EXISTS ai_feature_attribution (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  insight_id UUID REFERENCES ai_learning_insights(id) ON DELETE CASCADE,
  trade_id UUID REFERENCES trade_history(id) ON DELETE CASCADE,
  
  -- Feature details
  feature_name TEXT NOT NULL, -- e.g., 'ema_cross', 'rsi_oversold', 'volume_spike'
  feature_value TEXT, -- The actual value or state
  contribution_score DECIMAL(5,4) NOT NULL, -- 0-1, how much this feature contributed
  importance_rank INTEGER, -- Ranking among features for this insight
  
  -- Context
  feature_category TEXT, -- 'indicator', 'price_action', 'volume', 'volatility', 'time'
  positive_contribution BOOLEAN DEFAULT true, -- Did it contribute to success or failure?
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT valid_contribution_score CHECK (contribution_score >= 0 AND contribution_score <= 1)
);

-- Create index for fast feature lookups
CREATE INDEX IF NOT EXISTS idx_feature_attribution_insight 
  ON ai_feature_attribution(insight_id);
CREATE INDEX IF NOT EXISTS idx_feature_attribution_user_feature 
  ON ai_feature_attribution(user_id, feature_name);
CREATE INDEX IF NOT EXISTS idx_feature_attribution_trade 
  ON ai_feature_attribution(trade_id);

-- Enable RLS
ALTER TABLE ai_feature_attribution ENABLE ROW LEVEL SECURITY;

-- RLS Policies for ai_feature_attribution
CREATE POLICY "Users can view own feature attributions"
  ON ai_feature_attribution FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own feature attributions"
  ON ai_feature_attribution FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own feature attributions"
  ON ai_feature_attribution FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own feature attributions"
  ON ai_feature_attribution FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Function to calculate insight decay weight
CREATE OR REPLACE FUNCTION calculate_insight_decay_weight(
  p_created_at TIMESTAMPTZ,
  p_base_weight DECIMAL DEFAULT 1.0,
  p_half_life_days INTEGER DEFAULT 60
) RETURNS DECIMAL AS $$
DECLARE
  v_age_days DECIMAL;
  v_decay_factor DECIMAL;
  v_current_weight DECIMAL;
BEGIN
  -- Calculate age in days (as decimal for precision)
  v_age_days := EXTRACT(EPOCH FROM (now() - p_created_at)) / 86400.0;
  
  -- Calculate decay factor using exponential decay: weight = base_weight * (0.5 ^ (age / half_life))
  v_decay_factor := POWER(0.5, v_age_days / p_half_life_days);
  
  -- Apply decay to base weight
  v_current_weight := p_base_weight * v_decay_factor;
  
  -- Ensure minimum weight of 0.01 (insights never completely worthless, just very low weight)
  v_current_weight := GREATEST(v_current_weight, 0.01);
  
  RETURN v_current_weight;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to calculate time-weighted profit factor (exponential smoothing)
CREATE OR REPLACE FUNCTION calculate_time_weighted_profit_factor(
  p_user_id UUID,
  p_smoothing_alpha DECIMAL DEFAULT 0.3 -- Higher = more weight on recent data
) RETURNS DECIMAL AS $$
DECLARE
  v_total_wins DECIMAL := 0;
  v_total_losses DECIMAL := 0;
  v_weight DECIMAL;
  v_age_days DECIMAL;
  rec RECORD;
BEGIN
  -- Get trades ordered by recency
  FOR rec IN (
    SELECT 
      profit_loss,
      created_at,
      EXTRACT(EPOCH FROM (now() - created_at)) / 86400.0 as age_days
    FROM trade_history
    WHERE user_id = p_user_id
      AND profit_loss IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 200 -- Last 200 trades
  )
  LOOP
    -- Calculate exponential weight: weight = e^(-alpha * age_days / 30)
    v_weight := EXP(-p_smoothing_alpha * rec.age_days / 30.0);
    
    -- Accumulate weighted wins and losses
    IF rec.profit_loss > 0 THEN
      v_total_wins := v_total_wins + (rec.profit_loss * v_weight);
    ELSIF rec.profit_loss < 0 THEN
      v_total_losses := v_total_losses + (ABS(rec.profit_loss) * v_weight);
    END IF;
  END LOOP;
  
  -- Return weighted profit factor
  IF v_total_losses > 0 THEN
    RETURN v_total_wins / v_total_losses;
  ELSIF v_total_wins > 0 THEN
    RETURN 999.99; -- All wins, no losses
  ELSE
    RETURN 0;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to update time-weighted metrics for all users
CREATE OR REPLACE FUNCTION update_time_weighted_metrics()
RETURNS void AS $$
DECLARE
  rec RECORD;
  v_recent_win_rate DECIMAL;
  v_recent_profit_factor DECIMAL;
  v_time_weighted_pf DECIMAL;
  v_total_wins DECIMAL;
  v_total_losses DECIMAL;
BEGIN
  FOR rec IN (SELECT DISTINCT user_id FROM ai_skill_progression)
  LOOP
    -- Calculate recent 30-day win rate
    SELECT 
      COALESCE(
        COUNT(*) FILTER (WHERE profit_loss > 0)::DECIMAL / NULLIF(COUNT(*)::DECIMAL, 0) * 100,
        0
      )
    INTO v_recent_win_rate
    FROM trade_history
    WHERE user_id = rec.user_id
      AND created_at >= now() - INTERVAL '30 days'
      AND profit_loss IS NOT NULL;
    
    -- Calculate recent 30-day profit factor
    SELECT 
      SUM(profit_loss) FILTER (WHERE profit_loss > 0),
      ABS(SUM(profit_loss) FILTER (WHERE profit_loss < 0))
    INTO v_total_wins, v_total_losses
    FROM trade_history
    WHERE user_id = rec.user_id
      AND created_at >= now() - INTERVAL '30 days'
      AND profit_loss IS NOT NULL;
    
    IF v_total_losses > 0 THEN
      v_recent_profit_factor := v_total_wins / v_total_losses;
    ELSIF v_total_wins > 0 THEN
      v_recent_profit_factor := 999.99;
    ELSE
      v_recent_profit_factor := 0;
    END IF;
    
    -- Calculate time-weighted profit factor
    v_time_weighted_pf := calculate_time_weighted_profit_factor(rec.user_id);
    
    -- Update skill progression
    UPDATE ai_skill_progression
    SET 
      recent_30d_win_rate = v_recent_win_rate,
      recent_30d_profit_factor = v_recent_profit_factor,
      time_weighted_profit_factor = v_time_weighted_pf,
      last_time_weight_update = now()
    WHERE user_id = rec.user_id;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Create view for insights with current decay-adjusted weights
CREATE OR REPLACE VIEW ai_insights_with_decay AS
SELECT 
  i.*,
  EXTRACT(EPOCH FROM (now() - i.created_at)) / 86400.0 as insight_age_days,
  calculate_insight_decay_weight(i.created_at, i.base_weight, 60) as current_decayed_weight,
  CASE 
    WHEN EXTRACT(EPOCH FROM (now() - i.created_at)) / 86400.0 < 30 THEN 'fresh'
    WHEN EXTRACT(EPOCH FROM (now() - i.created_at)) / 86400.0 < 60 THEN 'moderate'
    WHEN EXTRACT(EPOCH FROM (now() - i.created_at)) / 86400.0 < 120 THEN 'aging'
    ELSE 'stale'
  END as insight_freshness
FROM ai_learning_insights i;

-- Initialize base_weight for existing insights
UPDATE ai_learning_insights
SET base_weight = 1.0000
WHERE base_weight IS NULL;

-- Run initial time-weighted metrics calculation
SELECT update_time_weighted_metrics();
