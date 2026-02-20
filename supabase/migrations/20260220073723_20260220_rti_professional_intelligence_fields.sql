/*
  # RTI Professional Intelligence Fields

  ## Summary
  Extends the Real-Time Intelligence (RTI) session data layer with professional
  intraday trading intelligence fields. This is a non-destructive additive migration
  that adds new columns to existing structures stored as JSONB in session_intelligence_data.

  ## Changes

  ### 1. New Table: rti_asia_range_tracker
  Tracks the Asia session high/low per symbol per day, reset each trading day at 08:00 UTC.
  Used for London Open sweep detection — the most reliable intraday setup.

  ### 2. New Table: rti_market_structure_events
  Stores detected market structure events per symbol. Records: BOS, ChoCh, FVG, OrderBlock,
  LiquiditySweep, AsiaRangeSweep, AsiaRangeBuilding. These events trigger card generation.

  ### 3. session_intelligence_data: Add kill zone fields
  Adds kill_zone_context JSONB column to store active kill zone name, minutes remaining,
  and window type for each scan run.

  ## Security
  - RLS enabled on all new tables
  - Service role policies for server-side writes
  - Authenticated read policies for users
  - All insert/update restricted to service_role

  ## SSOT / CCIP Compliance
  - All business rules live in config/service files, not in DB triggers
  - No business logic in SQL
  - Migration is purely structural (schema + RLS)
  - CCIP ID: 20260220_rti_professional_intelligence_fields
*/

-- ══════════════════════════════════════════════════════════════════════
-- 1. Asia Range Tracker
-- Stores the forming/locked Asia session high and low per symbol per day.
-- Reset daily at 08:00 UTC (London open). Server scheduler writes this.
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS rti_asia_range_tracker (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol          text NOT NULL,
  trade_date      date NOT NULL DEFAULT CURRENT_DATE,
  asia_high       numeric(20, 8),
  asia_low        numeric(20, 8),
  range_pips      numeric(10, 2),
  is_locked       boolean NOT NULL DEFAULT false,
  locked_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (symbol, trade_date)
);

ALTER TABLE rti_asia_range_tracker ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage asia range tracker"
  ON rti_asia_range_tracker
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can read asia range tracker"
  ON rti_asia_range_tracker
  FOR SELECT
  TO authenticated
  USING (true);

CREATE INDEX IF NOT EXISTS idx_rti_asia_range_symbol_date
  ON rti_asia_range_tracker (symbol, trade_date);

-- ══════════════════════════════════════════════════════════════════════
-- 2. Market Structure Events
-- Records real price-action events that trigger intelligence cards:
--   BOS              - Break of Structure (close beyond prior swing)
--   ChoCh            - Change of Character (first break of opposite swing)
--   FVG              - Fair Value Gap (3-candle imbalance detected)
--   OrderBlock       - Last opposing candle before impulse, retest detected
--   LiquiditySweep   - Wick beyond key level then close back inside
--   AsiaRangeSweep   - London opens and sweeps Asia high or low
--   AsiaRangeBuilding - Asia session range forming (informational)
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS rti_market_structure_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol          text NOT NULL,
  event_type      text NOT NULL CHECK (
    event_type IN (
      'BOS', 'ChoCh', 'FVG', 'OrderBlock',
      'LiquiditySweep', 'AsiaRangeSweep', 'AsiaRangeBuilding'
    )
  ),
  direction       text NOT NULL CHECK (direction IN ('buy', 'sell', 'neutral')),
  timeframe       text NOT NULL,
  event_price     numeric(20, 8),
  key_level       numeric(20, 8),
  confidence      integer NOT NULL DEFAULT 70 CHECK (confidence BETWEEN 0 AND 100),
  kill_zone_active boolean NOT NULL DEFAULT false,
  kill_zone_name  text,
  kill_zone_minutes_remaining integer,
  regime          text,
  liquidity_pool_direction text CHECK (liquidity_pool_direction IN ('above', 'below', 'both', 'none')),
  liquidity_pool_distance_pips numeric(10, 2),
  estimated_rr    numeric(5, 2),
  omega_consensus integer DEFAULT 0 CHECK (omega_consensus BETWEEN 0 AND 8),
  omega_dissent   integer DEFAULT 0 CHECK (omega_dissent BETWEEN 0 AND 8),
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  created_at      timestamptz NOT NULL DEFAULT now(),
  raw_metadata    jsonb DEFAULT '{}'::jsonb
);

ALTER TABLE rti_market_structure_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage market structure events"
  ON rti_market_structure_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can read market structure events"
  ON rti_market_structure_events
  FOR SELECT
  TO authenticated
  USING (true);

CREATE INDEX IF NOT EXISTS idx_rti_mse_symbol_created
  ON rti_market_structure_events (symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rti_mse_expires
  ON rti_market_structure_events (expires_at);

CREATE INDEX IF NOT EXISTS idx_rti_mse_event_type
  ON rti_market_structure_events (event_type);

-- ══════════════════════════════════════════════════════════════════════
-- 3. session_intelligence_data: Add kill zone context column
-- Stores the kill zone metadata for the scan run so the UI card can
-- display which institutional window is active without an extra query.
-- ══════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'session_intelligence_data'
      AND column_name = 'kill_zone_context'
  ) THEN
    ALTER TABLE session_intelligence_data
      ADD COLUMN kill_zone_context jsonb DEFAULT '{}'::jsonb;
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════════════
-- 4. Cleanup function: remove expired market structure events
-- Called by the scheduler to prevent unbounded table growth.
-- ══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION cleanup_expired_market_structure_events()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM rti_market_structure_events
  WHERE expires_at < now() - interval '30 minutes';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
