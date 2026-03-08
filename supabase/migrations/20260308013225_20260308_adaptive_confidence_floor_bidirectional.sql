/*
  # Adaptive Confidence Floor — Bidirectional Adjustment System

  ## Summary
  Adds persistent database infrastructure for Alpha's adaptive confidence floor.
  Alpha can now move his execution floor both UP and DOWN based on calibration
  data, bounded by hard system rails.

  ## New Columns on goal_sessions
  - `adaptive_confidence_floor` (integer, default 60): Alpha's current live floor
    for this session. Starts at MINIMUM_TRADE_CONFIDENCE (60). Alpha adjusts
    within [50, 75] based on calibration evidence.
  - `confidence_floor_adjusted_at` (timestamptz): When the floor was last moved.
  - `confidence_floor_adjustment_reason` (text): Human-readable reason for last move.
  - `confidence_floor_direction` (text): 'up' | 'down' | null — last movement direction.
  - `confidence_floor_adjustment_count` (integer, default 0): How many times the
    floor has been adjusted in this session (governance audit trail).

  ## New Table: alpha_confidence_floor_adjustments
  Full audit log of every floor adjustment Alpha makes. One row per adjustment.
  Supports governance review, CCIP compliance, and rollback analysis.

  Columns:
  - `id` (uuid, pk)
  - `user_id` (uuid, fk auth.users)
  - `session_id` (uuid, fk goal_sessions)
  - `previous_floor` (integer): Floor value before this adjustment
  - `new_floor` (integer): Floor value after this adjustment
  - `direction` (text): 'up' | 'down'
  - `trigger_bucket` (integer): The confidence bucket (e.g. 65) that triggered this
  - `bucket_actual_win_rate` (numeric): Actual win rate in that bucket (calibration data)
  - `bucket_predicted_win_rate` (numeric): What was predicted for that bucket
  - `bucket_sample_size` (integer): How many trades were in this bucket
  - `calibration_error` (numeric): Magnitude of miscalibration (abs difference)
  - `adjustment_reason` (text): Full reasoning string
  - `sample_size_threshold_used` (integer): The threshold required for this direction
    (15 for up, 10 for down — asymmetric to protect against premature floor raises)
  - `hard_rail_applied` (boolean): Whether the adjustment hit a hard rail boundary
  - `governance_approved` (boolean, default true): Governance sign-off
  - `created_at` (timestamptz)

  ## Security
  - RLS enabled on alpha_confidence_floor_adjustments
  - Users can only read/insert their own rows
  - Service role has full access for server-side adjustment processing

  ## CCIP Compliance
  - Change ID: CCIP-2026-0308A — Adaptive Floor Bidirectional Authority
  - Governance: Approved
  - Breaking changes: None (additive only)
  - SSOT owner: alpha-identity.ts (rails), alpha-adaptive-floor-service.ts (logic)
*/

-- ─── Add adaptive floor columns to goal_sessions ────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'adaptive_confidence_floor'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN adaptive_confidence_floor integer DEFAULT 60;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'confidence_floor_adjusted_at'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN confidence_floor_adjusted_at timestamptz;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'confidence_floor_adjustment_reason'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN confidence_floor_adjustment_reason text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'confidence_floor_direction'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN confidence_floor_direction text;
    ALTER TABLE goal_sessions ADD CONSTRAINT confidence_floor_direction_check
      CHECK (confidence_floor_direction IN ('up', 'down'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'confidence_floor_adjustment_count'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN confidence_floor_adjustment_count integer DEFAULT 0;
  END IF;
END $$;

-- ─── Create audit log table ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS alpha_confidence_floor_adjustments (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id                  uuid REFERENCES goal_sessions(id) ON DELETE SET NULL,
  previous_floor              integer NOT NULL,
  new_floor                   integer NOT NULL,
  direction                   text NOT NULL CHECK (direction IN ('up', 'down')),
  trigger_bucket              integer NOT NULL,
  bucket_actual_win_rate      numeric NOT NULL,
  bucket_predicted_win_rate   numeric NOT NULL,
  bucket_sample_size          integer NOT NULL,
  calibration_error           numeric NOT NULL,
  adjustment_reason           text NOT NULL,
  sample_size_threshold_used  integer NOT NULL,
  hard_rail_applied           boolean NOT NULL DEFAULT false,
  governance_approved         boolean NOT NULL DEFAULT true,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE alpha_confidence_floor_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own floor adjustments"
  ON alpha_confidence_floor_adjustments
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own floor adjustments"
  ON alpha_confidence_floor_adjustments
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access to floor adjustments"
  ON alpha_confidence_floor_adjustments
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ─── Performance index ───────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_floor_adjustments_user_session
  ON alpha_confidence_floor_adjustments (user_id, session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_floor_adjustments_direction
  ON alpha_confidence_floor_adjustments (direction, created_at DESC);
