/*
  # Add Push Confirmation Zone and Entry Monitor Gate

  ## Summary
  Extends the smart entry waiting system to support two distinct wait modes:
  1. pullback_to_zone — price retraces back to Alpha's target range before execution
  2. push_confirmation_zone — price must push INTO zone AND close an M5 candle inside it

  ## New Columns on entry_intents
  - `intent_mode` — 'pullback_to_zone' | 'push_confirmation_zone', governs which check the monitor uses
  - `zone_invalidation_reason` — human-readable reason when an intent is cancelled
  - `requires_m5_candle_close` — flag set true for push_confirmation_zone intents
  - `last_m5_candle_checked_at` — timestamp of last M5 candle check to prevent re-checking
  - `m5_candle_close_confirmed` — set true once a closed M5 candle inside zone is detected

  ## New Columns on goal_sessions
  - `alpha_entry_monitor_gate_active` — audit column: was the entry monitor toggle ON when Alpha decided?

  ## New Columns on goal_session_scan_results
  - `entry_monitor_gate_active` — records whether the gate was active at scan time

  ## Security
  No RLS changes — existing policies cover the new columns automatically.
*/

-- entry_intents: add intent_mode
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'intent_mode'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN intent_mode text DEFAULT 'pullback_to_zone'
      CHECK (intent_mode IN ('pullback_to_zone', 'push_confirmation_zone'));
  END IF;
END $$;

-- entry_intents: add zone_invalidation_reason
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'zone_invalidation_reason'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN zone_invalidation_reason text;
  END IF;
END $$;

-- entry_intents: add requires_m5_candle_close
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'requires_m5_candle_close'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN requires_m5_candle_close boolean DEFAULT false;
  END IF;
END $$;

-- entry_intents: add last_m5_candle_checked_at
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'last_m5_candle_checked_at'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN last_m5_candle_checked_at timestamptz;
  END IF;
END $$;

-- entry_intents: add m5_candle_close_confirmed
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'm5_candle_close_confirmed'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN m5_candle_close_confirmed boolean DEFAULT false;
  END IF;
END $$;

-- goal_sessions: add alpha_entry_monitor_gate_active
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'alpha_entry_monitor_gate_active'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN alpha_entry_monitor_gate_active boolean DEFAULT false;
  END IF;
END $$;

-- goal_session_scan_results: add entry_monitor_gate_active
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_scan_results' AND column_name = 'entry_monitor_gate_active'
  ) THEN
    ALTER TABLE goal_session_scan_results ADD COLUMN entry_monitor_gate_active boolean DEFAULT false;
  END IF;
END $$;
