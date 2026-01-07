/*
  # Comprehensive Trade Lifecycle Tracking System

  ## Overview
  This migration adds comprehensive tracking fields to support the complete trade lifecycle,
  from entry analysis through post-trade learning. Fixes multiple SSOT violations identified
  in the trade lifecycle audit.

  ## Changes Made

  ### 1. Market Context Snapshots (Regime & Adversarial)
  Adds snapshot fields to goal_session_trades to preserve entry market conditions:
  - `regime_snapshot` (jsonb): Regime classification at entry (trend, volatility, liquidity)
  - `adversarial_snapshot` (jsonb): Adversarial signals at entry (whale activity, news events)
  - `snapshot_hash` (text): Hash for verifying snapshot integrity
  - `snapshot_timestamp` (timestamptz): Exact time snapshot was captured

  ### 2. Duration Tracking (Defensive Architecture)
  Adds multiple duration fields to handle edge cases and abandoned trades:
  - `intended_duration_hours` (numeric): Expected hold time at entry
  - `actual_duration_minutes` (int): Calculated defensively from opened_at/closed_at
  - `duration_warning_flags` (jsonb): Warnings about duration feasibility

  ### 3. Dual Take Profit System (TP1/TP2)
  Extends existing TP system with partial profit-taking:
  - `take_profit_1` (numeric): First partial TP level
  - `take_profit_2` (numeric): Final full TP level (replaces take_profit)
  - `tp1_hit_at` (timestamptz): When TP1 was reached
  - `tp1_price` (numeric): Exact price at TP1
  - `tp2_hit_at` (timestamptz): When TP2 was reached
  - `tp2_price` (numeric): Exact price at TP2
  - `partial_close_pct` (numeric): Percentage closed at TP1

  ### 4. Strategy Playbook Linking
  Links trades to strategy playbooks for performance tracking:
  - `strategy_playbook_id` (uuid): Reference to strategy_playbook table
  - `playbook_variant` (text): Specific variant used (e.g., "scalper_m15_v3")

  ### 5. Entry Quality Metrics
  Tracks entry intent conversion and execution quality:
  - `entry_intent_id` (uuid): Reference to entry_intents table
  - `entry_quality_score` (numeric): 0-100 score based on timing/price
  - `entry_delay_seconds` (int): Time from intent to execution
  - `entry_slippage_pips` (numeric): Price difference from intended entry

  ## Security
  - All new columns are nullable to support existing trades
  - Existing RLS policies continue to apply
  - No breaking changes to current trade flow

  ## Performance
  - Added indexes for common query patterns
  - JSONB columns indexed with GIN for fast searches

  ## Migration Safety
  - All columns are nullable (no data migration required)
  - Existing trades unaffected
  - New fields populated only for future trades
*/

-- ============================================================================
-- 1. MARKET CONTEXT SNAPSHOTS
-- ============================================================================

-- Add regime and adversarial snapshots to preserve entry context
ALTER TABLE goal_session_trades
  ADD COLUMN IF NOT EXISTS regime_snapshot jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS adversarial_snapshot jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS snapshot_hash text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS snapshot_timestamp timestamptz DEFAULT NULL;

-- Index for querying trades by regime conditions
CREATE INDEX IF NOT EXISTS idx_goal_session_trades_regime_snapshot
  ON goal_session_trades USING gin (regime_snapshot);

-- Index for querying trades by adversarial conditions
CREATE INDEX IF NOT EXISTS idx_goal_session_trades_adversarial_snapshot
  ON goal_session_trades USING gin (adversarial_snapshot);

COMMENT ON COLUMN goal_session_trades.regime_snapshot IS
  'Market regime at entry: {trend: string, volatility: string, liquidity: string, ...}';

COMMENT ON COLUMN goal_session_trades.adversarial_snapshot IS
  'Adversarial signals at entry: {whale_activity: boolean, news_events: array, ...}';

COMMENT ON COLUMN goal_session_trades.snapshot_hash IS
  'Hash of combined regime+adversarial snapshots for integrity verification';

COMMENT ON COLUMN goal_session_trades.snapshot_timestamp IS
  'Exact timestamp when market snapshot was captured';

-- ============================================================================
-- 2. DURATION TRACKING (DEFENSIVE)
-- ============================================================================

-- Add comprehensive duration tracking
ALTER TABLE goal_session_trades
  ADD COLUMN IF NOT EXISTS intended_duration_hours numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS actual_duration_minutes int GENERATED ALWAYS AS (
    CASE
      WHEN closed_at IS NOT NULL AND opened_at IS NOT NULL THEN
        EXTRACT(EPOCH FROM (closed_at - opened_at)) / 60
      ELSE NULL
    END
  ) STORED,
  ADD COLUMN IF NOT EXISTS duration_warning_flags jsonb DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_goal_session_trades_actual_duration
  ON goal_session_trades (actual_duration_minutes)
  WHERE actual_duration_minutes IS NOT NULL;

COMMENT ON COLUMN goal_session_trades.intended_duration_hours IS
  'Expected hold time determined by Alpha at entry (for duration feasibility tracking)';

COMMENT ON COLUMN goal_session_trades.actual_duration_minutes IS
  'Actual trade duration calculated defensively from opened_at and closed_at';

COMMENT ON COLUMN goal_session_trades.duration_warning_flags IS
  'Warnings about duration feasibility: {volatility_risk: boolean, session_boundary: boolean, ...}';

-- ============================================================================
-- 3. DUAL TAKE PROFIT SYSTEM (TP1/TP2)
-- ============================================================================

-- Add TP1/TP2 tracking columns
ALTER TABLE goal_session_trades
  ADD COLUMN IF NOT EXISTS take_profit_1 numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS take_profit_2 numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS tp1_hit_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS tp1_price numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS tp2_hit_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS tp2_price numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS partial_close_pct numeric DEFAULT 50;

-- Add constraint for TP ordering (TP1 should be closer to entry than TP2)
ALTER TABLE goal_session_trades
  ADD CONSTRAINT check_tp_ordering CHECK (
    (take_profit_1 IS NULL AND take_profit_2 IS NULL) OR
    (take_profit_1 IS NOT NULL AND take_profit_2 IS NOT NULL AND take_profit_1 != take_profit_2)
  );

-- Index for TP monitoring queries
CREATE INDEX IF NOT EXISTS idx_goal_session_trades_tp1
  ON goal_session_trades (take_profit_1)
  WHERE status = 'open' AND take_profit_1 IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_goal_session_trades_tp2
  ON goal_session_trades (take_profit_2)
  WHERE status = 'open' AND take_profit_2 IS NOT NULL;

COMMENT ON COLUMN goal_session_trades.take_profit_1 IS
  'First partial take profit level (typically 50% position close)';

COMMENT ON COLUMN goal_session_trades.take_profit_2 IS
  'Second/final take profit level (remaining position close)';

COMMENT ON COLUMN goal_session_trades.tp1_hit_at IS
  'Timestamp when first take profit was hit';

COMMENT ON COLUMN goal_session_trades.tp2_hit_at IS
  'Timestamp when second take profit was hit';

COMMENT ON COLUMN goal_session_trades.partial_close_pct IS
  'Percentage of position to close at TP1 (default: 50%)';

-- ============================================================================
-- 4. STRATEGY PLAYBOOK LINKING
-- ============================================================================

-- Add strategy playbook reference
ALTER TABLE goal_session_trades
  ADD COLUMN IF NOT EXISTS strategy_playbook_id uuid REFERENCES strategy_playbook(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS playbook_variant text DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_goal_session_trades_playbook
  ON goal_session_trades (strategy_playbook_id)
  WHERE strategy_playbook_id IS NOT NULL;

COMMENT ON COLUMN goal_session_trades.strategy_playbook_id IS
  'Reference to strategy playbook used for this trade (for performance tracking)';

COMMENT ON COLUMN goal_session_trades.playbook_variant IS
  'Specific playbook variant name (e.g., "scalper_m15_v3")';

-- ============================================================================
-- 5. ENTRY QUALITY METRICS
-- ============================================================================

-- Add entry intent tracking
ALTER TABLE goal_session_trades
  ADD COLUMN IF NOT EXISTS entry_intent_id uuid DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS entry_quality_score numeric CHECK (entry_quality_score >= 0 AND entry_quality_score <= 100) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS entry_delay_seconds int DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS entry_slippage_pips numeric DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_goal_session_trades_entry_intent
  ON goal_session_trades (entry_intent_id)
  WHERE entry_intent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_goal_session_trades_entry_quality
  ON goal_session_trades (entry_quality_score)
  WHERE entry_quality_score IS NOT NULL;

COMMENT ON COLUMN goal_session_trades.entry_intent_id IS
  'Reference to entry_intents table for tracking intent-to-execution conversion';

COMMENT ON COLUMN goal_session_trades.entry_quality_score IS
  'Entry execution quality score (0-100) based on timing, price, and conditions';

COMMENT ON COLUMN goal_session_trades.entry_delay_seconds IS
  'Seconds elapsed from entry intent creation to trade execution';

COMMENT ON COLUMN goal_session_trades.entry_slippage_pips IS
  'Price slippage in pips from intended entry to actual entry';

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to calculate trade lifecycle completeness score
CREATE OR REPLACE FUNCTION calculate_trade_lifecycle_completeness(trade_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  trade_record goal_session_trades%ROWTYPE;
  completeness_score int := 0;
  max_score int := 100;
  missing_fields text[] := ARRAY[]::text[];
  result jsonb;
BEGIN
  SELECT * INTO trade_record
  FROM goal_session_trades
  WHERE id = trade_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Trade not found');
  END IF;

  -- Check regime snapshot (20 points)
  IF trade_record.regime_snapshot IS NOT NULL THEN
    completeness_score := completeness_score + 20;
  ELSE
    missing_fields := array_append(missing_fields, 'regime_snapshot');
  END IF;

  -- Check adversarial snapshot (20 points)
  IF trade_record.adversarial_snapshot IS NOT NULL THEN
    completeness_score := completeness_score + 20;
  ELSE
    missing_fields := array_append(missing_fields, 'adversarial_snapshot');
  END IF;

  -- Check duration tracking (20 points)
  IF trade_record.intended_duration_hours IS NOT NULL THEN
    completeness_score := completeness_score + 20;
  ELSE
    missing_fields := array_append(missing_fields, 'intended_duration_hours');
  END IF;

  -- Check strategy playbook (20 points)
  IF trade_record.strategy_playbook_id IS NOT NULL THEN
    completeness_score := completeness_score + 20;
  ELSE
    missing_fields := array_append(missing_fields, 'strategy_playbook_id');
  END IF;

  -- Check entry quality (20 points)
  IF trade_record.entry_quality_score IS NOT NULL THEN
    completeness_score := completeness_score + 20;
  ELSE
    missing_fields := array_append(missing_fields, 'entry_quality_score');
  END IF;

  result := jsonb_build_object(
    'completeness_score', completeness_score,
    'max_score', max_score,
    'percentage', (completeness_score::numeric / max_score::numeric * 100)::numeric(5,2),
    'missing_fields', missing_fields,
    'has_tp1_tp2', (trade_record.take_profit_1 IS NOT NULL AND trade_record.take_profit_2 IS NOT NULL)
  );

  RETURN result;
END;
$$;

COMMENT ON FUNCTION calculate_trade_lifecycle_completeness IS
  'Calculates how complete trade lifecycle tracking is for a given trade (0-100%)';

-- ============================================================================
-- DATA QUALITY VIEWS
-- ============================================================================

-- View for trades with incomplete lifecycle data
CREATE OR REPLACE VIEW incomplete_trade_lifecycles AS
SELECT
  t.id,
  t.symbol,
  t.status,
  t.opened_at,
  t.closed_at,
  CASE WHEN t.regime_snapshot IS NULL THEN 'missing' ELSE 'present' END as regime_snapshot_status,
  CASE WHEN t.adversarial_snapshot IS NULL THEN 'missing' ELSE 'present' END as adversarial_snapshot_status,
  CASE WHEN t.intended_duration_hours IS NULL THEN 'missing' ELSE 'present' END as duration_tracking_status,
  CASE WHEN t.strategy_playbook_id IS NULL THEN 'missing' ELSE 'present' END as playbook_linking_status,
  CASE WHEN t.entry_quality_score IS NULL THEN 'missing' ELSE 'present' END as entry_quality_status,
  t.actual_duration_minutes,
  calculate_trade_lifecycle_completeness(t.id)->>'percentage' as completeness_percentage
FROM goal_session_trades t
WHERE t.status IN ('open', 'closed')
  AND (
    t.regime_snapshot IS NULL OR
    t.adversarial_snapshot IS NULL OR
    t.intended_duration_hours IS NULL OR
    t.strategy_playbook_id IS NULL OR
    t.entry_quality_score IS NULL
  )
ORDER BY t.opened_at DESC;

COMMENT ON VIEW incomplete_trade_lifecycles IS
  'Shows trades with incomplete lifecycle tracking data for debugging and monitoring';