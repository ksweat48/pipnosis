/*
  # Style-Aware Omega Weight Governance System

  ## Problem Statement
  Historical analysis of 50 trades revealed critical omega weighting flaws:
  - Scalper omega has 92.3% directional accuracy on SCALP trades but only 0.20 base weight
  - OrderFlow omega gets a special 1.5x boost at 70% confidence but is only 50% accurate at that level
  - No style-aware weighting exists -- SCALP trades don't prioritize the Scalper omega
  - Trend and Reversal voted NO_TRADE on ALL 50 trades, providing zero directional value for SCALP
  - Confirmation omega is 20% accurate on SCALP trades (anti-correlated)

  ## Solution: Data-Driven Style-Aware Weight Profiles

  1. New Tables
    - `omega_weight_profiles`
      - `id` (uuid, primary key)
      - `style` (text) - SCALP, MICRO_INTRADAY, INTRADAY
      - `omega_name` (text) - trend, scalper, confirmation, reversal, volatility, omega8
      - `base_weight` (numeric) - base weight for this omega in this style
      - `confidence_amplification_tiers` (jsonb) - confidence-based multiplier tiers
      - `active` (boolean) - whether this weight profile is active
      - `calibration_source` (text) - how the weights were derived
      - `accuracy_rate` (numeric) - historical accuracy rate for this omega/style combo
      - `last_calibrated_at` (timestamptz)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `omega_weight_audit_log`
      - `id` (uuid, primary key)
      - `user_id` (uuid)
      - `session_id` (uuid)
      - `style` (text) - trade style used
      - `risk_mode` (text) - risk mode active
      - `omega_name` (text) - which omega
      - `base_weight` (numeric)
      - `confidence_multiplier` (numeric)
      - `style_multiplier` (numeric)
      - `regime_multiplier` (numeric)
      - `final_weight` (numeric) - computed final weight
      - `omega_vote` (text) - BUY/SELL/NO_TRADE
      - `omega_confidence` (integer)
      - `weighted_contribution` (numeric)
      - `created_at` (timestamptz)

  2. Security
    - RLS enabled on both tables
    - omega_weight_profiles: read-only for authenticated users, admin-only writes
    - omega_weight_audit_log: users can read/insert own data

  3. Seed Data
    - Pre-populated with data-driven weights from 50-trade analysis
    - Universal confidence amplification tiers (symmetric across all omegas)
*/

-- ============================================
-- TABLE: omega_weight_profiles
-- SSOT Authority for style-aware omega weights
-- ============================================
CREATE TABLE IF NOT EXISTS omega_weight_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  style text NOT NULL,
  omega_name text NOT NULL,
  base_weight numeric NOT NULL DEFAULT 1.0,
  confidence_amplification_tiers jsonb NOT NULL DEFAULT '{
    "below_50": 0.7,
    "50_to_69": 1.0,
    "70_to_79": 1.2,
    "80_to_89": 1.5,
    "90_to_100": 2.0
  }'::jsonb,
  active boolean NOT NULL DEFAULT true,
  calibration_source text NOT NULL DEFAULT 'backtest_50_trades',
  accuracy_rate numeric DEFAULT 0,
  last_calibrated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  CONSTRAINT valid_style CHECK (style IN ('SCALP', 'MICRO_INTRADAY', 'INTRADAY')),
  CONSTRAINT valid_omega_name CHECK (omega_name IN ('trend', 'scalper', 'confirmation', 'reversal', 'volatility', 'omega8', 'risk')),
  CONSTRAINT valid_base_weight CHECK (base_weight >= 0 AND base_weight <= 5.0),
  CONSTRAINT unique_style_omega UNIQUE (style, omega_name)
);

ALTER TABLE omega_weight_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read omega weight profiles"
  ON omega_weight_profiles
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage omega weight profiles"
  ON omega_weight_profiles
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================
-- TABLE: omega_weight_audit_log
-- CCIP tracking for weight decisions
-- ============================================
CREATE TABLE IF NOT EXISTS omega_weight_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  session_id uuid,
  style text NOT NULL,
  risk_mode text NOT NULL DEFAULT 'medium',
  omega_name text NOT NULL,
  base_weight numeric NOT NULL,
  confidence_multiplier numeric NOT NULL DEFAULT 1.0,
  style_multiplier numeric NOT NULL DEFAULT 1.0,
  regime_multiplier numeric NOT NULL DEFAULT 1.0,
  final_weight numeric NOT NULL,
  omega_vote text,
  omega_confidence integer DEFAULT 0,
  weighted_contribution numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),

  CONSTRAINT valid_audit_style CHECK (style IN ('SCALP', 'MICRO_INTRADAY', 'INTRADAY')),
  CONSTRAINT valid_audit_risk_mode CHECK (risk_mode IN ('low', 'medium', 'high')),
  CONSTRAINT valid_audit_omega CHECK (omega_name IN ('trend', 'scalper', 'confirmation', 'reversal', 'volatility', 'omega8', 'risk'))
);

ALTER TABLE omega_weight_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own omega weight audit logs"
  ON omega_weight_audit_log
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own omega weight audit logs"
  ON omega_weight_audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can manage omega weight audit logs"
  ON omega_weight_audit_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================
-- SEED DATA: Style-Aware Weights
-- Derived from 50-trade historical analysis
-- ============================================

-- SCALP weights (data: Scalper 92.3% directional accuracy, OrderFlow 50% at 70% conf)
INSERT INTO omega_weight_profiles (style, omega_name, base_weight, accuracy_rate, calibration_source) VALUES
  ('SCALP', 'scalper', 0.45, 92.3, 'backtest_50_trades_directional_accuracy'),
  ('SCALP', 'omega8', 0.25, 52.1, 'backtest_50_trades_overall_accuracy'),
  ('SCALP', 'volatility', 0.15, 41.7, 'backtest_50_trades_overall_accuracy'),
  ('SCALP', 'trend', 0.05, 0.0, 'backtest_50_trades_zero_directional_votes'),
  ('SCALP', 'confirmation', 0.05, 20.0, 'backtest_50_trades_anti_correlated'),
  ('SCALP', 'reversal', 0.03, 0.0, 'backtest_50_trades_zero_directional_votes'),
  ('SCALP', 'risk', 0.02, 0.0, 'advisory_only')
ON CONFLICT (style, omega_name) DO UPDATE SET
  base_weight = EXCLUDED.base_weight,
  accuracy_rate = EXCLUDED.accuracy_rate,
  calibration_source = EXCLUDED.calibration_source,
  updated_at = now();

-- MICRO_INTRADAY weights (insufficient data, balanced defaults with trend emphasis)
INSERT INTO omega_weight_profiles (style, omega_name, base_weight, accuracy_rate, calibration_source) VALUES
  ('MICRO_INTRADAY', 'trend', 0.30, 0.0, 'design_default_insufficient_data'),
  ('MICRO_INTRADAY', 'confirmation', 0.25, 0.0, 'design_default_insufficient_data'),
  ('MICRO_INTRADAY', 'scalper', 0.15, 0.0, 'design_default_insufficient_data'),
  ('MICRO_INTRADAY', 'omega8', 0.15, 0.0, 'design_default_insufficient_data'),
  ('MICRO_INTRADAY', 'volatility', 0.10, 0.0, 'design_default_insufficient_data'),
  ('MICRO_INTRADAY', 'reversal', 0.03, 0.0, 'design_default_insufficient_data'),
  ('MICRO_INTRADAY', 'risk', 0.02, 0.0, 'advisory_only')
ON CONFLICT (style, omega_name) DO UPDATE SET
  base_weight = EXCLUDED.base_weight,
  accuracy_rate = EXCLUDED.accuracy_rate,
  calibration_source = EXCLUDED.calibration_source,
  updated_at = now();

-- INTRADAY weights (no data, trend-dominant design defaults)
INSERT INTO omega_weight_profiles (style, omega_name, base_weight, accuracy_rate, calibration_source) VALUES
  ('INTRADAY', 'trend', 0.35, 0.0, 'design_default_no_data'),
  ('INTRADAY', 'confirmation', 0.25, 0.0, 'design_default_no_data'),
  ('INTRADAY', 'omega8', 0.15, 0.0, 'design_default_no_data'),
  ('INTRADAY', 'volatility', 0.10, 0.0, 'design_default_no_data'),
  ('INTRADAY', 'scalper', 0.08, 0.0, 'design_default_no_data'),
  ('INTRADAY', 'reversal', 0.05, 0.0, 'design_default_no_data'),
  ('INTRADAY', 'risk', 0.02, 0.0, 'advisory_only')
ON CONFLICT (style, omega_name) DO UPDATE SET
  base_weight = EXCLUDED.base_weight,
  accuracy_rate = EXCLUDED.accuracy_rate,
  calibration_source = EXCLUDED.calibration_source,
  updated_at = now();

-- ============================================
-- RPC: Get style weights (for frontend/service use)
-- ============================================
CREATE OR REPLACE FUNCTION get_omega_weights_for_style(p_style text)
RETURNS TABLE (
  omega_name text,
  base_weight numeric,
  confidence_amplification_tiers jsonb,
  accuracy_rate numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    owp.omega_name,
    owp.base_weight,
    owp.confidence_amplification_tiers,
    owp.accuracy_rate
  FROM omega_weight_profiles owp
  WHERE owp.style = p_style
    AND owp.active = true
  ORDER BY owp.base_weight DESC;
END;
$$;

-- ============================================
-- INDEX: Fast lookups
-- ============================================
CREATE INDEX IF NOT EXISTS idx_omega_weight_profiles_style
  ON omega_weight_profiles (style) WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_omega_weight_audit_log_user_session
  ON omega_weight_audit_log (user_id, session_id);

CREATE INDEX IF NOT EXISTS idx_omega_weight_audit_log_created
  ON omega_weight_audit_log (created_at);
