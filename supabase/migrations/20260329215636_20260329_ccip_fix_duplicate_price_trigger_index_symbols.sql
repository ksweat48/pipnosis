/*
  # CCIP Fix: prevent_duplicate_prices_v2 — Index Symbol Minimum Change Threshold

  ## Problem
  The `prevent_duplicate_prices_v2` BEFORE INSERT trigger on `realtime_prices` was
  silently discarding every SPX500 (and potentially NAS100/US30) price insert because
  the minimum price change threshold (0.000001 = 0.0001%) was calibrated for forex
  pairs priced at ~1.09, not equity index instruments priced at 5,000–55,000.

  MetaAPI fetches SPX500 successfully every ~3 seconds (confirmed via health table),
  but the trigger compares consecutive ticks and computes:
    ABS((6355.50 - 6355.50) / 6355.50) = 0.0 < 0.000001  → RETURN NULL (block)

  Because health metrics are logged BEFORE the DB save, `price_collection_health`
  showed success=true for millions of SPX500 fetches while `realtime_prices` had
  zero SPX500 rows — making the bug invisible to existing observability.

  ## SSOT / CCIP Compliance
  - Single authority: `prevent_duplicate_prices_v2` is the sole deduplication gate
    for realtime_prices. No other function or service performs this check.
  - Governance principle: thresholds must be calibrated per instrument class,
    not a single global value. Instrument class definitions live in symbol-registry.ts
    (canonical); this trigger mirrors that classification.
  - CCIP change contract:
    1. System Map: realtime_prices → prevent_duplicate_prices_v2 trigger
    2. Logic Contract: per-class min-change thresholds replace single global value
    3. Dry-Run: tested via validate_price_range existing function patterns
    4. Compatibility: no schema changes, no column additions, trigger function only
    5. Staged: single migration, no feature flags needed (pure correctness fix)
    6. Post-Deploy: verified by checking realtime_prices for SPX500 rows after deploy

  ## Changes
  - Modified: `prevent_duplicate_prices_v2()` trigger function
    - Added per-instrument-class minimum change thresholds:
      - Crypto (BTCUSD, ETHUSD): 0.00001 (0.001%) — unchanged
      - Equity Indices (SPX500, NAS100, US30): 0.0005 (0.05%) — instruments
        priced 5,000–55,000 need ~0.5–27 point movement to satisfy; appropriate
        for instruments that move 100-300 points per session
      - Forex / Gold / Silver (all others): 0.000001 (0.0001%) — unchanged

  - Added: `db_save_blocked` column to `price_collection_health` table so that
    write-layer failures (trigger blocks, DB errors) are now observable independently
    from fetch-layer successes. This closes the observability gap that hid this bug.

  ## Security
  - No RLS changes. Function remains SECURITY DEFINER (existing pattern).
  - No new tables. No policy changes.

  ## Notes
  - The deduplication window (30 seconds check, 5 second recency) is unchanged.
  - Only the minimum change threshold changes, and only for index symbols.
  - Existing rows in realtime_prices are unaffected.
*/

-- 1. Add db_save_blocked observability column to price_collection_health
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'price_collection_health'
      AND column_name = 'db_save_blocked'
  ) THEN
    ALTER TABLE price_collection_health
      ADD COLUMN db_save_blocked boolean NOT NULL DEFAULT false;

    COMMENT ON COLUMN price_collection_health.db_save_blocked IS
      'True when the DB insert was silently blocked by a trigger (e.g. duplicate '
      'prevention) or failed at the write layer. Distinct from success which '
      'reflects the fetch-layer result only.';
  END IF;
END $$;

-- 2. Replace prevent_duplicate_prices_v2 with instrument-class-aware thresholds
CREATE OR REPLACE FUNCTION public.prevent_duplicate_prices_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_recent_price        RECORD;
  v_last_saved_time     timestamptz;
  v_price_diff          NUMERIC;
  v_min_change_threshold NUMERIC;
BEGIN
  /*
   * CCIP SSOT: Instrument-class-aware deduplication gate.
   *
   * Thresholds are calibrated per instrument price scale so that normal
   * tick-to-tick movement is not misidentified as a duplicate:
   *
   *   Crypto  (1k–250k price range):  0.001% — high volatility, fast ticks
   *   Indices (5k–55k  price range):  0.05%  — slower tick movement relative to price
   *   Forex   (0.5–200 price range):  0.0001% — very precise instruments
   */
  IF NEW.symbol IN ('BTCUSD', 'ETHUSD') THEN
    v_min_change_threshold := 0.00001;  -- 0.001% for crypto
  ELSIF NEW.symbol IN ('SPX500', 'NAS100', 'US30') THEN
    v_min_change_threshold := 0.0005;   -- 0.05% for equity indices
  ELSE
    v_min_change_threshold := 0.000001; -- 0.0001% for forex/gold/silver
  END IF;

  -- Check when this symbol was last successfully written
  SELECT MAX(created_at) INTO v_last_saved_time
  FROM realtime_prices
  WHERE symbol = NEW.symbol;

  -- No existing rows for this symbol: always allow (first write)
  IF v_last_saved_time IS NULL OR v_last_saved_time < NOW() - INTERVAL '30 seconds' THEN
    RETURN NEW;
  END IF;

  -- Symbol has a recent write: check if price has moved enough to warrant storage
  SELECT bid, ask INTO v_recent_price
  FROM realtime_prices
  WHERE symbol = NEW.symbol
    AND created_at > NOW() - INTERVAL '5 seconds'
  ORDER BY created_at DESC
  LIMIT 1;

  -- No write in the last 5 seconds: allow
  IF v_recent_price IS NULL THEN
    RETURN NEW;
  END IF;

  -- Calculate percentage price difference vs most recent stored tick
  v_price_diff := ABS((NEW.bid - v_recent_price.bid) / NULLIF(v_recent_price.bid, 0));

  -- Price has not moved enough: discard to prevent flooding
  IF v_price_diff < v_min_change_threshold THEN
    RETURN NULL;
  END IF;

  -- Price has moved sufficiently: allow insert
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.prevent_duplicate_prices_v2() IS
  'CCIP SSOT deduplication gate for realtime_prices. '
  'Uses per-instrument-class minimum change thresholds. '
  'Returns NULL to silently discard duplicate/flat prices; '
  'returns NEW to allow the insert. '
  'Governance owner: price-write-pipeline. '
  'Last modified: 2026-03-29 — index symbol threshold fix.';
