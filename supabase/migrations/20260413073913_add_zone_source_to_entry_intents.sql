/*
  # Add zone_source column to entry_intents

  ## Summary
  Adds a `zone_source` column to the `entry_intents` table to track how the entry
  zone was derived. This enables the UI to distinguish between:
  - `wait_condition` — Alpha provided an explicit pullback zone via LLM output
  - `entry_advisory` — Zone came from the entry advisory system
  - `entry_intent` — Zone came from a prior entry intent record
  - `entry_price_fallback` — Zone was synthesised by CCIP-2026-0408A from SL geometry

  ## Purpose
  When `zone_source = 'entry_price_fallback'`, the EntryPriceMonitor must NOT show a
  green "Good Entry" banner just because price is currently inside the zone, since the
  fallback zone is directionally offset from entry to force a genuine pullback wait.

  ## Changes
  - `entry_intents.zone_source` (text, nullable) — source identifier for the entry zone

  ## Security
  No RLS changes — inherits existing policies on entry_intents.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'zone_source'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN zone_source text;
  END IF;
END $$;
