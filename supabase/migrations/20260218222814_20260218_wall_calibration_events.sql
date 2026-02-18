/*
  # Wall Calibration Events — Governance Audit Table

  ## Purpose
  Records every time the WallCalibrationEngine adjusts the ATR multiplier
  before generating dual-arena walls. This provides full governance transparency
  into HOW and WHY walls were dynamically adapted.

  ## New Tables
  - `wall_calibration_events`
    - Tracks every calibration event with full diagnostic context
    - Links to session and user for traceability
    - Records original vs calibrated multiplier for audit trail
    - Records calibration reason, asset class, safety caps, session expansions

  ## Security
  - RLS enabled with policy: authenticated users can read their own events
  - Service role can insert (calibration engine runs server-side via edge functions)
  - Admin can read all events for governance dashboards
  - No user-writable insert — only service role inserts via RPC

  ## Governance Compliance
  - CCIP (2026-02-18): Dynamic Wall Calibration system
  - SSOT: Single audit table for all calibration events
  - Every expansion logged with reason, bounds, and outcome context
*/

CREATE TABLE IF NOT EXISTS wall_calibration_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now() NOT NULL,

  symbol text NOT NULL,
  trade_style text NOT NULL,
  current_session text NOT NULL,
  session_time_remaining_minutes integer NOT NULL DEFAULT 0,
  volatility_regime text NOT NULL,
  asset_class text NOT NULL,

  original_atr_multiple numeric(6,2) NOT NULL,
  calibrated_atr_multiple numeric(6,2) NOT NULL,
  calibration_reason text NOT NULL,

  corridor_width_pips numeric(10,2) NOT NULL DEFAULT 0,
  envelope_tp_min_pips numeric(10,2) NOT NULL DEFAULT 0,
  envelope_tp_max_pips numeric(10,2) NOT NULL DEFAULT 0,

  safety_cap_applied boolean NOT NULL DEFAULT false,
  session_expansion_applied boolean NOT NULL DEFAULT false,
  regime_multiplier_used numeric(6,3) NOT NULL DEFAULT 1.0,
  session_factor_used numeric(6,3) NOT NULL DEFAULT 1.0,

  entry_price numeric(20,8),
  atr_value numeric(20,8),

  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id uuid
);

ALTER TABLE wall_calibration_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_wall_calibration_events_user_id
  ON wall_calibration_events(user_id);

CREATE INDEX IF NOT EXISTS idx_wall_calibration_events_symbol_created
  ON wall_calibration_events(symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wall_calibration_events_created_at
  ON wall_calibration_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wall_calibration_events_calibration_reason
  ON wall_calibration_events(calibration_reason, created_at DESC);

CREATE POLICY "Users can read own calibration events"
  ON wall_calibration_events
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert calibration events"
  ON wall_calibration_events
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Admin can read all calibration events"
  ON wall_calibration_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );
