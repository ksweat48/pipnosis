/*
  # Create Deep Learning Intelligence Dashboard System

  ## Purpose
  Transform Pipnosis into a fully transparent LLM trading intelligence system where
  every decision, every layer, every learning is visible and trackable.

  ## Changes

  1. Enhance Existing Tables
    - Add layer-by-layer decision tracking to `ai_trade_analysis`
    - Add adaptive learning adjustment tracking
    - Add improvement application tracking
    - Add LLM deep analysis to `daily_session_results`

  2. New Tables
    - `improvement_tracking` - Track hypothesis → implementation → validation

  3. Benefits
    - See exactly how each trade was decided (Layers 1-5)
    - Understand why losers lost (forensics)
    - Understand why winners won (pattern extraction)
    - Track if applied improvements actually work
    - Build institutional intelligence over time

  ## Safety
  - All RLS policies maintained
  - No breaking changes to existing data
  - Backward compatible with current system
*/

-- ============================================================================
-- STEP 1: ENHANCE ai_trade_analysis TABLE
-- ============================================================================

-- Add layer-by-layer decision tracking
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_analysis' AND column_name = 'layer_1_decision'
  ) THEN
    ALTER TABLE ai_trade_analysis ADD COLUMN layer_1_decision JSONB DEFAULT NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_analysis' AND column_name = 'layer_2_decision'
  ) THEN
    ALTER TABLE ai_trade_analysis ADD COLUMN layer_2_decision JSONB DEFAULT NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_analysis' AND column_name = 'layer_3_decision'
  ) THEN
    ALTER TABLE ai_trade_analysis ADD COLUMN layer_3_decision JSONB DEFAULT NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_analysis' AND column_name = 'layer_4_decision'
  ) THEN
    ALTER TABLE ai_trade_analysis ADD COLUMN layer_4_decision JSONB DEFAULT NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_analysis' AND column_name = 'layer_5_decision'
  ) THEN
    ALTER TABLE ai_trade_analysis ADD COLUMN layer_5_decision JSONB DEFAULT NULL;
  END IF;
END $$;

-- Add adaptive learning adjustments
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_analysis' AND column_name = 'adjusted_confidence'
  ) THEN
    ALTER TABLE ai_trade_analysis ADD COLUMN adjusted_confidence NUMERIC DEFAULT NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_analysis' AND column_name = 'adjusted_risk_pct'
  ) THEN
    ALTER TABLE ai_trade_analysis ADD COLUMN adjusted_risk_pct NUMERIC DEFAULT NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_analysis' AND column_name = 'adjusted_sl_distance'
  ) THEN
    ALTER TABLE ai_trade_analysis ADD COLUMN adjusted_sl_distance NUMERIC DEFAULT NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_analysis' AND column_name = 'adjusted_tp_distance'
  ) THEN
    ALTER TABLE ai_trade_analysis ADD COLUMN adjusted_tp_distance NUMERIC DEFAULT NULL;
  END IF;
END $$;

-- Add improvement tracking
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_analysis' AND column_name = 'improvements_applied'
  ) THEN
    ALTER TABLE ai_trade_analysis ADD COLUMN improvements_applied TEXT[] DEFAULT '{}';
  END IF;
END $$;

-- Add loss forensics (backend-generated)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_analysis' AND column_name = 'loss_forensics'
  ) THEN
    ALTER TABLE ai_trade_analysis ADD COLUMN loss_forensics JSONB DEFAULT NULL;
  END IF;
END $$;

-- Add win pattern analysis
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_analysis' AND column_name = 'win_pattern'
  ) THEN
    ALTER TABLE ai_trade_analysis ADD COLUMN win_pattern JSONB DEFAULT NULL;
  END IF;
END $$;

-- Add comments for new columns
COMMENT ON COLUMN ai_trade_analysis.layer_1_decision IS
  'Layer 1 (Hard Gate) decision with reasoning and timestamp';

COMMENT ON COLUMN ai_trade_analysis.layer_2_decision IS
  'Layer 2 (Regime Validation) decision with confidence and reasoning';

COMMENT ON COLUMN ai_trade_analysis.layer_3_decision IS
  'Layer 3 (Setup Quality + Adaptive Learning) decision with adjustments';

COMMENT ON COLUMN ai_trade_analysis.layer_4_decision IS
  'Layer 4 (Mistake Prevention) decision with warnings and reasoning';

COMMENT ON COLUMN ai_trade_analysis.layer_5_decision IS
  'Layer 5 (LLM Brain) final decision with full context and reasoning';

COMMENT ON COLUMN ai_trade_analysis.adjusted_confidence IS
  'Confidence after Layer 3 adaptive learning adjustments';

COMMENT ON COLUMN ai_trade_analysis.adjusted_risk_pct IS
  'Risk % after adaptive adjustments (clamped to safety limits)';

COMMENT ON COLUMN ai_trade_analysis.improvements_applied IS
  'Array of improvement IDs that were applied in this trade';

COMMENT ON COLUMN ai_trade_analysis.loss_forensics IS
  'Backend-generated forensic analysis: why the trade lost, what went wrong';

COMMENT ON COLUMN ai_trade_analysis.win_pattern IS
  'Pattern analysis for winning trades: why it worked, what to replicate';

-- ============================================================================
-- STEP 2: ENHANCE daily_session_results TABLE
-- ============================================================================

-- Add LLM deep analysis
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'daily_session_results' AND column_name = 'llm_deep_analysis'
  ) THEN
    ALTER TABLE daily_session_results ADD COLUMN llm_deep_analysis JSONB DEFAULT NULL;
  END IF;
END $$;

-- Add improvements tested
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'daily_session_results' AND column_name = 'improvements_tested'
  ) THEN
    ALTER TABLE daily_session_results ADD COLUMN improvements_tested TEXT[] DEFAULT '{}';
  END IF;
END $$;

-- Add layer 3 adjustment stats
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'daily_session_results' AND column_name = 'layer_3_adjustment_stats'
  ) THEN
    ALTER TABLE daily_session_results ADD COLUMN layer_3_adjustment_stats JSONB DEFAULT NULL;
  END IF;
END $$;

-- Add winning trades count
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'daily_session_results' AND column_name = 'winning_trades'
  ) THEN
    ALTER TABLE daily_session_results ADD COLUMN winning_trades INTEGER DEFAULT 0;
  END IF;
END $$;

-- Add losing trades count
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'daily_session_results' AND column_name = 'losing_trades'
  ) THEN
    ALTER TABLE daily_session_results ADD COLUMN losing_trades INTEGER DEFAULT 0;
  END IF;
END $$;

COMMENT ON COLUMN daily_session_results.llm_deep_analysis IS
  'Full LLM post-session analysis: what was learned, why wins/losses occurred, improvement plan';

COMMENT ON COLUMN daily_session_results.improvements_tested IS
  'Array of improvement IDs that were tested during this session';

COMMENT ON COLUMN daily_session_results.layer_3_adjustment_stats IS
  'Statistics on adaptive learning adjustments made by Layer 3 during session';

-- ============================================================================
-- STEP 3: CREATE improvement_tracking TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS improvement_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Hypothesis Details
  hypothesis TEXT NOT NULL,
  hypothesis_type TEXT NOT NULL CHECK (hypothesis_type IN (
    'confidence_adjustment',
    'risk_adjustment',
    'timing_adjustment',
    'pattern_filter',
    'entry_criteria',
    'exit_criteria',
    'regime_filter',
    'correlation_filter'
  )),

  -- Origin
  created_date DATE NOT NULL DEFAULT CURRENT_DATE,
  generated_from_session_id TEXT,
  llm_reasoning TEXT,

  -- Implementation
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN (
    'proposed',
    'testing',
    'validated',
    'rejected',
    'paused'
  )),
  applied_from_session_id TEXT,
  applied_date DATE,

  -- Before Metrics
  before_win_rate NUMERIC DEFAULT 0,
  before_profit_factor NUMERIC DEFAULT 0,
  before_avg_rr NUMERIC DEFAULT 0,
  before_trades_count INTEGER DEFAULT 0,
  before_pnl NUMERIC DEFAULT 0,

  -- After Metrics
  after_win_rate NUMERIC DEFAULT 0,
  after_profit_factor NUMERIC DEFAULT 0,
  after_avg_rr NUMERIC DEFAULT 0,
  after_trades_count INTEGER DEFAULT 0,
  after_pnl NUMERIC DEFAULT 0,

  -- Effectiveness Analysis
  effectiveness_score NUMERIC DEFAULT 0 CHECK (effectiveness_score >= -100 AND effectiveness_score <= 100),
  win_rate_delta NUMERIC DEFAULT 0,
  profit_factor_delta NUMERIC DEFAULT 0,
  pnl_delta NUMERIC DEFAULT 0,

  -- Implementation Notes
  implementation_notes TEXT,
  sessions_tested INTEGER DEFAULT 0,
  trades_affected INTEGER DEFAULT 0,

  -- Metadata
  tags TEXT[] DEFAULT '{}',
  symbols_affected TEXT[] DEFAULT '{}',
  timeframes_affected TEXT[] DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT valid_effectiveness CHECK (
    (status IN ('validated', 'rejected') AND effectiveness_score IS NOT NULL) OR
    (status NOT IN ('validated', 'rejected'))
  )
);

CREATE INDEX IF NOT EXISTS idx_improvement_tracking_user_id
  ON improvement_tracking(user_id);

CREATE INDEX IF NOT EXISTS idx_improvement_tracking_status
  ON improvement_tracking(user_id, status);

CREATE INDEX IF NOT EXISTS idx_improvement_tracking_created_date
  ON improvement_tracking(user_id, created_date DESC);

CREATE INDEX IF NOT EXISTS idx_improvement_tracking_hypothesis_type
  ON improvement_tracking(user_id, hypothesis_type);

COMMENT ON TABLE improvement_tracking IS
  'Tracks improvement hypotheses from proposal → testing → validation/rejection';

ALTER TABLE improvement_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own improvements"
  ON improvement_tracking FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own improvements"
  ON improvement_tracking FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own improvements"
  ON improvement_tracking FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own improvements"
  ON improvement_tracking FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION update_improvement_tracking_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_improvement_tracking_updated_at ON improvement_tracking;
CREATE TRIGGER trigger_update_improvement_tracking_updated_at
  BEFORE UPDATE ON improvement_tracking
  FOR EACH ROW
  EXECUTE FUNCTION update_improvement_tracking_updated_at();

-- ============================================================================
-- STEP 4: CREATE HELPER FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION calculate_improvement_effectiveness(
  p_improvement_id UUID
)
RETURNS NUMERIC AS $$
DECLARE
  v_improvement RECORD;
  v_effectiveness NUMERIC;
  v_win_rate_weight NUMERIC := 0.4;
  v_pf_weight NUMERIC := 0.3;
  v_pnl_weight NUMERIC := 0.3;
  v_wr_score NUMERIC;
  v_pf_score NUMERIC;
  v_pnl_score NUMERIC;
BEGIN
  SELECT * INTO v_improvement FROM improvement_tracking WHERE id = p_improvement_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  v_wr_score := CASE
    WHEN v_improvement.before_win_rate = 0 THEN 0
    ELSE ((v_improvement.after_win_rate - v_improvement.before_win_rate) / v_improvement.before_win_rate) * 100
  END;
  v_wr_score := GREATEST(-100, LEAST(100, v_wr_score));

  v_pf_score := CASE
    WHEN v_improvement.before_profit_factor = 0 THEN 0
    ELSE ((v_improvement.after_profit_factor - v_improvement.before_profit_factor) / v_improvement.before_profit_factor) * 100
  END;
  v_pf_score := GREATEST(-100, LEAST(100, v_pf_score));

  v_pnl_score := CASE
    WHEN v_improvement.before_pnl = 0 THEN 0
    ELSE ((v_improvement.after_pnl - v_improvement.before_pnl) / ABS(v_improvement.before_pnl)) * 100
  END;
  v_pnl_score := GREATEST(-100, LEAST(100, v_pnl_score));

  v_effectiveness := (v_wr_score * v_win_rate_weight) + (v_pf_score * v_pf_weight) + (v_pnl_score * v_pnl_weight);

  UPDATE improvement_tracking
  SET effectiveness_score = v_effectiveness,
      win_rate_delta = v_improvement.after_win_rate - v_improvement.before_win_rate,
      profit_factor_delta = v_improvement.after_profit_factor - v_improvement.before_profit_factor,
      pnl_delta = v_improvement.after_pnl - v_improvement.before_pnl
  WHERE id = p_improvement_id;

  RETURN v_effectiveness;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 5: CREATE VIEWS
-- ============================================================================

CREATE OR REPLACE VIEW active_improvements AS
SELECT id, user_id, hypothesis, hypothesis_type, status, applied_date,
       sessions_tested, trades_affected, before_win_rate, after_win_rate,
       win_rate_delta, effectiveness_score
FROM improvement_tracking
WHERE status IN ('testing', 'validated')
ORDER BY applied_date DESC;

CREATE OR REPLACE VIEW session_intelligence_summary AS
SELECT dsr.id, dsr.user_id, dsr.session_name, dsr.session_date, dsr.day_number,
       dsr.month_number, dsr.win_rate, dsr.profit_factor, dsr.total_trades,
       dsr.winning_trades, dsr.losing_trades, dsr.pnl, dsr.is_profitable,
       dsr.llm_deep_analysis, dsr.improvements_tested, dsr.layer_3_adjustment_stats,
       dsr.key_learnings, COUNT(ata.id) as analyzed_trades_count
FROM daily_session_results dsr
LEFT JOIN ai_trade_analysis ata ON ata.user_id = dsr.user_id
  AND DATE(ata.entry_time) = DATE(dsr.session_date)
GROUP BY dsr.id
ORDER BY dsr.session_date DESC;
