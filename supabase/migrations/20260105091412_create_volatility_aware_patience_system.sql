/*
  # Volatility-Aware Patience System

  ## Overview
  Implements three-layer intelligent gating for execution discipline:
  - Layer 0 (EEG Precheck): Fail-fast economic validation
  - Layer 1 (Stricter EQE): Microstructure discipline
  - Layer 2 (Tiered TTF + Volatility Wait): Economic graduation

  ## Changes

  1. New Tables
    - `volatility_wait_intents` - Track trades waiting for volatility pickup
    - `eeg_precheck_logs` - Log all precheck decisions for monitoring
    - `entry_patience_metrics` - Track conversion rates and system health

  2. Updated Tables
    - `entry_intents` - Add new intent type 'wait_for_volatility'

  3. Security
    - Enable RLS on all new tables
    - Add user-scoped policies

  4. Indexes
    - Optimize for intent monitoring queries
    - Support analytics queries

  ## Notes
  - 8h intraday boundary maintained (no swing mode creep)
  - All thresholds configurable via frontend
  - Designed for SSOT compliance
*/

-- Create volatility_wait_intents table
CREATE TABLE IF NOT EXISTS volatility_wait_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES goal_sessions(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('long', 'short')),
  original_ttf_minutes integer NOT NULL,
  target_atr numeric NOT NULL,
  current_atr numeric NOT NULL,
  max_wait_hours integer NOT NULL DEFAULT 4,
  recheck_interval_minutes integer NOT NULL DEFAULT 15,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'conditions_met', 'expired', 'canceled')),
  alpha_reasoning text,
  created_at timestamptz DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT valid_ttf CHECK (original_ttf_minutes > 0 AND original_ttf_minutes <= 480),
  CONSTRAINT valid_atr CHECK (target_atr > 0 AND current_atr >= 0),
  CONSTRAINT valid_wait_hours CHECK (max_wait_hours > 0 AND max_wait_hours <= 8)
);

-- Create EEG precheck logs table
CREATE TABLE IF NOT EXISTS eeg_precheck_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES goal_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  action text NOT NULL CHECK (action IN ('EXECUTE_IMMEDIATELY', 'EXECUTE_WITH_ADVISORY', 'CONVERT_TO_VOLATILITY_WAIT', 'HARD_BLOCK')),
  ttf_tier integer CHECK (ttf_tier IN (1, 2, 3, 4)),
  rejection_reason text,
  ttf_minutes numeric NOT NULL,
  atr_value numeric NOT NULL,
  distance_from_entry numeric NOT NULL,
  distance_in_atrs numeric NOT NULL,
  should_create_volatility_intent boolean DEFAULT false,
  message text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create entry patience metrics table
CREATE TABLE IF NOT EXISTS entry_patience_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,

  -- EQE metrics (Layer 1)
  eqe_total_checks integer NOT NULL DEFAULT 0,
  eqe_chase_blocks integer NOT NULL DEFAULT 0,
  eqe_exhaustion_blocks integer NOT NULL DEFAULT 0,
  eqe_vwap_distance_blocks integer NOT NULL DEFAULT 0,

  -- EEG Precheck metrics (Layer 0)
  eeg_total_checks integer NOT NULL DEFAULT 0,
  eeg_tier1_executions integer NOT NULL DEFAULT 0,
  eeg_tier2_executions integer NOT NULL DEFAULT 0,
  eeg_tier3_volatility_waits integer NOT NULL DEFAULT 0,
  eeg_tier4_hard_blocks integer NOT NULL DEFAULT 0,

  -- Volatility wait outcomes
  volatility_waits_created integer NOT NULL DEFAULT 0,
  volatility_waits_conditions_met integer NOT NULL DEFAULT 0,
  volatility_waits_expired integer NOT NULL DEFAULT 0,
  volatility_waits_canceled integer NOT NULL DEFAULT 0,

  -- Performance metrics
  average_ttf_at_rejection numeric,
  average_atr_at_rejection numeric,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  UNIQUE(user_id, date)
);

-- Enable RLS
ALTER TABLE volatility_wait_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE eeg_precheck_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE entry_patience_metrics ENABLE ROW LEVEL SECURITY;

-- RLS Policies for volatility_wait_intents
CREATE POLICY "Users can view own volatility wait intents"
  ON volatility_wait_intents FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own volatility wait intents"
  ON volatility_wait_intents FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own volatility wait intents"
  ON volatility_wait_intents FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for eeg_precheck_logs
CREATE POLICY "Users can view own precheck logs"
  ON eeg_precheck_logs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own precheck logs"
  ON eeg_precheck_logs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for entry_patience_metrics
CREATE POLICY "Users can view own patience metrics"
  ON entry_patience_metrics FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own patience metrics"
  ON entry_patience_metrics FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own patience metrics"
  ON entry_patience_metrics FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_volatility_wait_intents_user_status
  ON volatility_wait_intents(user_id, status)
  WHERE status = 'waiting';

CREATE INDEX IF NOT EXISTS idx_volatility_wait_intents_session
  ON volatility_wait_intents(session_id);

CREATE INDEX IF NOT EXISTS idx_volatility_wait_intents_created
  ON volatility_wait_intents(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_eeg_precheck_logs_session
  ON eeg_precheck_logs(session_id);

CREATE INDEX IF NOT EXISTS idx_eeg_precheck_logs_created
  ON eeg_precheck_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_entry_patience_metrics_user_date
  ON entry_patience_metrics(user_id, date DESC);

-- Create function to auto-expire old volatility wait intents
CREATE OR REPLACE FUNCTION expire_old_volatility_wait_intents()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE volatility_wait_intents
  SET status = 'expired',
      resolved_at = now()
  WHERE status = 'waiting'
    AND created_at < (now() - (max_wait_hours || ' hours')::interval);
END;
$$;

-- Create function to increment patience metrics
CREATE OR REPLACE FUNCTION increment_patience_metric(
  p_user_id uuid,
  p_metric_name text,
  p_increment integer DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO entry_patience_metrics (user_id, date)
  VALUES (p_user_id, CURRENT_DATE)
  ON CONFLICT (user_id, date) DO NOTHING;

  CASE p_metric_name
    WHEN 'eqe_total_checks' THEN
      UPDATE entry_patience_metrics
      SET eqe_total_checks = eqe_total_checks + p_increment,
          updated_at = now()
      WHERE user_id = p_user_id AND date = CURRENT_DATE;

    WHEN 'eqe_chase_blocks' THEN
      UPDATE entry_patience_metrics
      SET eqe_chase_blocks = eqe_chase_blocks + p_increment,
          updated_at = now()
      WHERE user_id = p_user_id AND date = CURRENT_DATE;

    WHEN 'eqe_exhaustion_blocks' THEN
      UPDATE entry_patience_metrics
      SET eqe_exhaustion_blocks = eqe_exhaustion_blocks + p_increment,
          updated_at = now()
      WHERE user_id = p_user_id AND date = CURRENT_DATE;

    WHEN 'eqe_vwap_distance_blocks' THEN
      UPDATE entry_patience_metrics
      SET eqe_vwap_distance_blocks = eqe_vwap_distance_blocks + p_increment,
          updated_at = now()
      WHERE user_id = p_user_id AND date = CURRENT_DATE;

    WHEN 'eeg_total_checks' THEN
      UPDATE entry_patience_metrics
      SET eeg_total_checks = eeg_total_checks + p_increment,
          updated_at = now()
      WHERE user_id = p_user_id AND date = CURRENT_DATE;

    WHEN 'eeg_tier1_executions' THEN
      UPDATE entry_patience_metrics
      SET eeg_tier1_executions = eeg_tier1_executions + p_increment,
          updated_at = now()
      WHERE user_id = p_user_id AND date = CURRENT_DATE;

    WHEN 'eeg_tier2_executions' THEN
      UPDATE entry_patience_metrics
      SET eeg_tier2_executions = eeg_tier2_executions + p_increment,
          updated_at = now()
      WHERE user_id = p_user_id AND date = CURRENT_DATE;

    WHEN 'eeg_tier3_volatility_waits' THEN
      UPDATE entry_patience_metrics
      SET eeg_tier3_volatility_waits = eeg_tier3_volatility_waits + p_increment,
          volatility_waits_created = volatility_waits_created + p_increment,
          updated_at = now()
      WHERE user_id = p_user_id AND date = CURRENT_DATE;

    WHEN 'eeg_tier4_hard_blocks' THEN
      UPDATE entry_patience_metrics
      SET eeg_tier4_hard_blocks = eeg_tier4_hard_blocks + p_increment,
          updated_at = now()
      WHERE user_id = p_user_id AND date = CURRENT_DATE;

    WHEN 'volatility_waits_conditions_met' THEN
      UPDATE entry_patience_metrics
      SET volatility_waits_conditions_met = volatility_waits_conditions_met + p_increment,
          updated_at = now()
      WHERE user_id = p_user_id AND date = CURRENT_DATE;

    WHEN 'volatility_waits_expired' THEN
      UPDATE entry_patience_metrics
      SET volatility_waits_expired = volatility_waits_expired + p_increment,
          updated_at = now()
      WHERE user_id = p_user_id AND date = CURRENT_DATE;

    WHEN 'volatility_waits_canceled' THEN
      UPDATE entry_patience_metrics
      SET volatility_waits_canceled = volatility_waits_canceled + p_increment,
          updated_at = now()
      WHERE user_id = p_user_id AND date = CURRENT_DATE;
  END CASE;
END;
$$;

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON volatility_wait_intents TO authenticated;
GRANT ALL ON eeg_precheck_logs TO authenticated;
GRANT ALL ON entry_patience_metrics TO authenticated;
GRANT EXECUTE ON FUNCTION expire_old_volatility_wait_intents() TO authenticated;
GRANT EXECUTE ON FUNCTION increment_patience_metric(uuid, text, integer) TO authenticated;
