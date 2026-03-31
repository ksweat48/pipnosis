/*
  # CCIP-2026-0331B: Deprecate M5 Candle Close Columns from entry_intents

  ## Summary
  Remove the requires_m5_candle_close and m5_candle_close_confirmed columns
  from the entry_intents table. These columns were used to gate push_confirmation_zone
  trades behind an M5 candle body close requirement. That gate was architecturally
  incorrect — it imposed a hardcoded confirmation requirement that belongs to Alpha's
  judgment (expressed in wait_condition.wait_reasoning), not to the execution layer.

  ## Changes
  - entry_intents.requires_m5_candle_close: column dropped
  - entry_intents.m5_candle_close_confirmed: column dropped
  - entry_intents.last_m5_candle_checked_at: column dropped (related tracking field)

  ## Impact
  push_confirmation_zone intents now execute identically to pullback_to_zone intents
  at the monitor level: when price enters Alpha's stated zone, the trade executes.
  The intent_mode column (pullback_to_zone | push_confirmation_zone) is retained as
  an audit field — it records Alpha's stated entry approach for learning and review.

  ## Security
  No RLS changes. entry_intents RLS policies are unchanged.

  ## SSOT
  Authoritative source: autonomous-entry-monitor.ts (execution gate removed)
  Supporting change: alpha-trade-executor.ts createMonitored() (insert fields removed)
  Supporting change: alpha-identity.ts (ENTRY_MODE prompt updated, CCIP-2026-0331B)
*/

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'requires_m5_candle_close'
  ) THEN
    ALTER TABLE entry_intents DROP COLUMN requires_m5_candle_close;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'm5_candle_close_confirmed'
  ) THEN
    ALTER TABLE entry_intents DROP COLUMN m5_candle_close_confirmed;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'last_m5_candle_checked_at'
  ) THEN
    ALTER TABLE entry_intents DROP COLUMN last_m5_candle_checked_at;
  END IF;
END $$;
