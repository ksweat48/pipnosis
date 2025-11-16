/*
  # Add Exploration Tracking and Pattern Graduation System

  This migration implements a sophisticated exploration learning system where:

  ## 1. Exploration Trade Tracking
     - Marks trades as exploratory vs exploitation
     - Tracks confidence levels for each trade type
     - Records exploration reasoning and outcomes

  ## 2. Weighted Progression System
     - Exploratory trades: 0.25x weight (probationary period)
     - Regular backtest trades: 1.0x weight
     - Live trades: 2.0x weight (already implemented)
     - Graduated patterns: 1.0x weight (promoted from exploratory)

  ## 3. Pattern Graduation
     - Exploratory patterns that prove successful (65%+ WR over 20+ trades)
     - Automatically graduate to core strategy
     - Remove "exploratory" label once validated
     - Track graduation metrics and history

  ## Changes

  1. **trade_history** - Add exploration tracking
     - `is_exploratory` - Boolean flag for exploratory trades
     - `exploration_pattern_id` - Links to pattern being tested
     - `exploration_confidence` - Original confidence before exploration adjustment
     - `exploration_reasoning` - Why this trade was exploratory

  2. **ai_exploratory_patterns** - New table for pattern tracking
     - Tracks patterns being tested through exploration
     - Records success rates and graduation criteria
     - Links to trades that used this pattern

  3. **ai_pattern_graduations** - New table for graduation history
     - Records when patterns graduate from exploratory to core
     - Tracks performance before and after graduation
     - Enables pattern evolution analysis

  ## Security
  - RLS policies applied to all new tables
  - Only authenticated users can access their own data
*/

-- Add exploration tracking columns to trade_history
ALTER TABLE trade_history
ADD COLUMN IF NOT EXISTS is_exploratory BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS exploration_pattern_id UUID,
ADD COLUMN IF NOT EXISTS exploration_confidence DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS exploration_reasoning TEXT;

-- Create index for exploratory trade queries
CREATE INDEX IF NOT EXISTS idx_trade_history_exploratory
  ON trade_history(user_id, is_exploratory)
  WHERE is_exploratory = true;

-- Create ai_exploratory_patterns table
CREATE TABLE IF NOT EXISTS ai_exploratory_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Pattern identification
  pattern_name TEXT NOT NULL,
  pattern_type TEXT NOT NULL, -- 'confidence_range', 'indicator_combo', 'market_regime', etc.
  pattern_description TEXT,

  -- Pattern parameters (stored as JSONB for flexibility)
  pattern_params JSONB NOT NULL DEFAULT '{}',

  -- Performance tracking
  total_trades INTEGER DEFAULT 0,
  winning_trades INTEGER DEFAULT 0,
  losing_trades INTEGER DEFAULT 0,
  win_rate DECIMAL(5,2) DEFAULT 0,
  profit_factor DECIMAL(10,4) DEFAULT 0,
  total_pnl DECIMAL(15,2) DEFAULT 0,

  -- Graduation criteria
  graduation_threshold_wr DECIMAL(5,2) DEFAULT 65.00, -- Default 65% WR to graduate
  graduation_threshold_trades INTEGER DEFAULT 20, -- Minimum 20 trades needed
  is_graduated BOOLEAN DEFAULT false,
  graduated_at TIMESTAMPTZ,

  -- Weighting for progression
  progression_weight DECIMAL(5,4) DEFAULT 0.2500, -- 0.25x weight for exploratory

  -- Status
  is_active BOOLEAN DEFAULT true,
  status TEXT DEFAULT 'testing', -- 'testing', 'graduated', 'failed', 'paused'

  -- Metadata
  first_trade_at TIMESTAMPTZ,
  last_trade_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT unique_user_pattern_name UNIQUE(user_id, pattern_name),
  CONSTRAINT valid_win_rate CHECK (win_rate >= 0 AND win_rate <= 100),
  CONSTRAINT valid_graduation_thresholds CHECK (
    graduation_threshold_wr >= 0 AND
    graduation_threshold_wr <= 100 AND
    graduation_threshold_trades > 0
  )
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_exploratory_patterns_user
  ON ai_exploratory_patterns(user_id);
CREATE INDEX IF NOT EXISTS idx_exploratory_patterns_active
  ON ai_exploratory_patterns(user_id, is_active)
  WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_exploratory_patterns_graduated
  ON ai_exploratory_patterns(user_id, is_graduated);
CREATE INDEX IF NOT EXISTS idx_exploratory_patterns_status
  ON ai_exploratory_patterns(user_id, status);

-- Enable RLS
ALTER TABLE ai_exploratory_patterns ENABLE ROW LEVEL SECURITY;

-- RLS Policies for ai_exploratory_patterns
CREATE POLICY "Users can view own exploratory patterns"
  ON ai_exploratory_patterns FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own exploratory patterns"
  ON ai_exploratory_patterns FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own exploratory patterns"
  ON ai_exploratory_patterns FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own exploratory patterns"
  ON ai_exploratory_patterns FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Create ai_pattern_graduations table (history of pattern promotions)
CREATE TABLE IF NOT EXISTS ai_pattern_graduations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pattern_id UUID NOT NULL REFERENCES ai_exploratory_patterns(id) ON DELETE CASCADE,

  -- Pattern details at graduation
  pattern_name TEXT NOT NULL,
  pattern_type TEXT NOT NULL,

  -- Performance at graduation
  trades_at_graduation INTEGER NOT NULL,
  win_rate_at_graduation DECIMAL(5,2) NOT NULL,
  profit_factor_at_graduation DECIMAL(10,4) NOT NULL,
  total_pnl_at_graduation DECIMAL(15,2) NOT NULL,

  -- Post-graduation tracking
  trades_after_graduation INTEGER DEFAULT 0,
  win_rate_after_graduation DECIMAL(5,2) DEFAULT 0,
  profit_factor_after_graduation DECIMAL(10,4) DEFAULT 0,
  still_performing_well BOOLEAN DEFAULT true,

  -- Weight changes
  weight_before_graduation DECIMAL(5,4) DEFAULT 0.2500, -- 0.25x
  weight_after_graduation DECIMAL(5,4) DEFAULT 1.0000, -- 1.0x (full backtest weight)

  -- Metadata
  graduated_at TIMESTAMPTZ DEFAULT now(),
  last_performance_check TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT valid_graduation_metrics CHECK (
    trades_at_graduation >= 20 AND
    win_rate_at_graduation >= 0 AND
    win_rate_at_graduation <= 100
  )
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_pattern_graduations_user
  ON ai_pattern_graduations(user_id);
CREATE INDEX IF NOT EXISTS idx_pattern_graduations_pattern
  ON ai_pattern_graduations(pattern_id);
CREATE INDEX IF NOT EXISTS idx_pattern_graduations_date
  ON ai_pattern_graduations(graduated_at DESC);

-- Enable RLS
ALTER TABLE ai_pattern_graduations ENABLE ROW LEVEL SECURITY;

-- RLS Policies for ai_pattern_graduations
CREATE POLICY "Users can view own pattern graduations"
  ON ai_pattern_graduations FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own pattern graduations"
  ON ai_pattern_graduations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own pattern graduations"
  ON ai_pattern_graduations FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Function to update exploratory pattern performance
CREATE OR REPLACE FUNCTION update_exploratory_pattern_performance()
RETURNS TRIGGER AS $$
BEGIN
  -- Only process if this is an exploratory trade with a pattern_id
  IF NEW.is_exploratory AND NEW.exploration_pattern_id IS NOT NULL THEN
    UPDATE ai_exploratory_patterns
    SET
      total_trades = total_trades + 1,
      winning_trades = winning_trades + CASE WHEN NEW.profit_loss > 0 THEN 1 ELSE 0 END,
      losing_trades = losing_trades + CASE WHEN NEW.profit_loss < 0 THEN 1 ELSE 0 END,
      win_rate = (
        (winning_trades + CASE WHEN NEW.profit_loss > 0 THEN 1 ELSE 0 END)::DECIMAL /
        NULLIF((total_trades + 1), 0)
      ) * 100,
      total_pnl = total_pnl + COALESCE(NEW.profit_loss, 0),
      last_trade_at = NEW.created_at,
      first_trade_at = COALESCE(first_trade_at, NEW.created_at),
      updated_at = now()
    WHERE id = NEW.exploration_pattern_id;

    -- Check if pattern should graduate
    PERFORM check_pattern_graduation(NEW.exploration_pattern_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic pattern performance updates
DROP TRIGGER IF EXISTS update_exploratory_pattern_on_trade ON trade_history;
CREATE TRIGGER update_exploratory_pattern_on_trade
  AFTER INSERT OR UPDATE ON trade_history
  FOR EACH ROW
  WHEN (NEW.is_exploratory = true AND NEW.exploration_pattern_id IS NOT NULL AND NEW.profit_loss IS NOT NULL)
  EXECUTE FUNCTION update_exploratory_pattern_performance();

-- Function to check if a pattern should graduate
CREATE OR REPLACE FUNCTION check_pattern_graduation(p_pattern_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_pattern RECORD;
  v_should_graduate BOOLEAN := false;
BEGIN
  -- Get pattern details
  SELECT * INTO v_pattern
  FROM ai_exploratory_patterns
  WHERE id = p_pattern_id
    AND is_active = true
    AND is_graduated = false;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Check graduation criteria
  IF v_pattern.total_trades >= v_pattern.graduation_threshold_trades AND
     v_pattern.win_rate >= v_pattern.graduation_threshold_wr THEN

    -- Graduate the pattern!
    UPDATE ai_exploratory_patterns
    SET
      is_graduated = true,
      graduated_at = now(),
      status = 'graduated',
      progression_weight = 1.0000, -- Full weight after graduation
      updated_at = now()
    WHERE id = p_pattern_id;

    -- Record graduation
    INSERT INTO ai_pattern_graduations (
      user_id,
      pattern_id,
      pattern_name,
      pattern_type,
      trades_at_graduation,
      win_rate_at_graduation,
      profit_factor_at_graduation,
      total_pnl_at_graduation,
      weight_before_graduation,
      weight_after_graduation
    ) VALUES (
      v_pattern.user_id,
      v_pattern.id,
      v_pattern.pattern_name,
      v_pattern.pattern_type,
      v_pattern.total_trades,
      v_pattern.win_rate,
      v_pattern.profit_factor,
      v_pattern.total_pnl,
      0.2500,
      1.0000
    );

    v_should_graduate := true;

    RAISE NOTICE 'Pattern % graduated! WR: %, Trades: %',
      v_pattern.pattern_name, v_pattern.win_rate, v_pattern.total_trades;
  END IF;

  RETURN v_should_graduate;
END;
$$ LANGUAGE plpgsql;

-- Function to get exploration statistics for a user
CREATE OR REPLACE FUNCTION get_exploration_stats(p_user_id UUID)
RETURNS TABLE (
  total_patterns INTEGER,
  active_patterns INTEGER,
  graduated_patterns INTEGER,
  failed_patterns INTEGER,
  total_exploratory_trades INTEGER,
  exploratory_win_rate DECIMAL,
  best_pattern_name TEXT,
  best_pattern_wr DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::INTEGER as total_patterns,
    COUNT(*) FILTER (WHERE is_active = true)::INTEGER as active_patterns,
    COUNT(*) FILTER (WHERE is_graduated = true)::INTEGER as graduated_patterns,
    COUNT(*) FILTER (WHERE status = 'failed')::INTEGER as failed_patterns,
    COALESCE(SUM(total_trades), 0)::INTEGER as total_exploratory_trades,
    COALESCE(
      AVG(win_rate) FILTER (WHERE total_trades > 0),
      0
    )::DECIMAL as exploratory_win_rate,
    (SELECT pattern_name FROM ai_exploratory_patterns
     WHERE user_id = p_user_id
     ORDER BY win_rate DESC, total_trades DESC
     LIMIT 1) as best_pattern_name,
    (SELECT win_rate FROM ai_exploratory_patterns
     WHERE user_id = p_user_id
     ORDER BY win_rate DESC, total_trades DESC
     LIMIT 1) as best_pattern_wr
  FROM ai_exploratory_patterns
  WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql STABLE;

-- Create view for active exploratory patterns with progress
CREATE OR REPLACE VIEW ai_exploratory_patterns_progress AS
SELECT
  p.*,
  (p.total_trades::DECIMAL / NULLIF(p.graduation_threshold_trades, 0)) * 100 as progress_to_graduation_percent,
  p.graduation_threshold_wr - p.win_rate as wr_gap_to_graduation,
  CASE
    WHEN p.total_trades >= p.graduation_threshold_trades AND p.win_rate >= p.graduation_threshold_wr THEN 'ready'
    WHEN p.total_trades >= p.graduation_threshold_trades * 0.5 THEN 'halfway'
    ELSE 'early'
  END as graduation_readiness
FROM ai_exploratory_patterns p
WHERE p.is_active = true AND p.is_graduated = false;

COMMENT ON VIEW ai_exploratory_patterns_progress IS 'Shows active exploratory patterns with graduation progress metrics';
