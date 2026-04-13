/*
  # CCIP-BROKER-CLOCK-SKEW-2026-04-13 — Governance Contract: Broker Clock Domain

  ## Summary
  Documents the authoritative contract for handling the AAAfx broker's UTC+3 clock
  offset when querying candle data from the database. This migration records the root
  cause analysis, the fix, and the ongoing governance rules so future engineers can
  find the problem immediately if a similar issue recurs.

  ## Root Cause (April 2026)
  AAAfx broker writes `open_time` (and `broker_time`) to the database in UTC+3 (EET/EEST).
  The ChartDataGuarantor was using `new Date()` (UTC) as the upper bound for its DB query.
  All candles created after UTC midnight on any given day had `open_time` values
  approximately 3 hours ahead of UTC, placing them outside the query window.

  Symptom: charts loaded blank after weekends or public holidays because only a
  handful of new candles existed (all with broker-timestamped open_times ~3 h ahead
  of UTC), and the query's `open_time <= now()` filter excluded every one of them.

  ## Fix Applied
  1. Added `TIME_MS.BROKER.CLOCK_SKEW_MS` (14 400 000 ms = 4 h) to `src/config/time-constants.ts`
     as the canonical SSOT constant for all broker clock offset calculations.
  2. ChartDataGuarantor.guaranteeChartData() now computes:
       endTime = new Date(Date.now() + TIME_MS.BROKER.CLOCK_SKEW_MS)
     so the DB query upper bound always encompasses broker-timestamped candles.

  ## Governance Rules (MUST be followed by all future code)
  - Any service querying forex candles with a UTC upper bound MUST add CLOCK_SKEW_MS.
  - Crypto pairs (BTCUSD, ETHUSD) are exempt — they use UTC natively, 24/7.
  - Forming-candle period boundaries: use broker_time from realtime_prices as the
    anchor (see chart-candle-poller.ts CCIP-2026-04-02), NOT Date.now() + offset.
  - Server-side aggregators: probe latestBrokerTime from realtime_prices and work
    entirely in the broker clock domain (see continuous-candle-aggregator.ts).

  ## Diagnostic Query
  Run this to detect candles whose open_time is more than 2 hours ahead of UTC now,
  which would indicate broker-timestamped data that future queries might miss:

    SELECT symbol, timeframe, open_time,
           extract(epoch from (open_time - now())) / 3600 AS hours_ahead
    FROM   forex_candles
    WHERE  open_time > now() + interval '2 hours'
    ORDER  BY open_time DESC
    LIMIT  50;

  A non-empty result is NORMAL and expected during active broker sessions.
  It confirms the broker is writing in UTC+3 and the CLOCK_SKEW_MS buffer is needed.
  If this query is empty during active market hours it may indicate:
    a) The broker changed its clock domain (verify with live price broker_time column), or
    b) The data pipeline stopped writing candles.

  ## Ownership
  - Primary: ChartDataGuarantor (src/services/chart-data-guarantor.ts)
  - SSOT constant: TIME_MS.BROKER.CLOCK_SKEW_MS (src/config/time-constants.ts)
  - Server aggregator: netlify/functions/continuous-candle-aggregator.ts
  - Forming candles: src/services/chart-candle-poller.ts
*/

-- Record this governance event in the ccip_tracking table if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ccip_tracking'
  ) THEN
    INSERT INTO ccip_tracking (
      change_id,
      change_type,
      description,
      affected_components,
      deployed_at
    ) VALUES (
      'CCIP-BROKER-CLOCK-SKEW-2026-04-13',
      'governance_contract',
      'Broker UTC+3 clock skew contract: ChartDataGuarantor endTime must include TIME_MS.BROKER.CLOCK_SKEW_MS (4h) buffer. Constant moved to SSOT time-constants.ts.',
      ARRAY[
        'src/services/chart-data-guarantor.ts',
        'src/config/time-constants.ts',
        'netlify/functions/continuous-candle-aggregator.ts',
        'src/services/chart-candle-poller.ts'
      ],
      now()
    )
    ON CONFLICT (change_id) DO NOTHING;
  END IF;
END $$;

-- Create a helper view that makes the broker clock skew immediately visible
-- to anyone running diagnostics. Drop-and-recreate pattern (idempotent).
DROP VIEW IF EXISTS broker_clock_skew_diagnostic;

CREATE VIEW broker_clock_skew_diagnostic
WITH (security_invoker = true)
AS
SELECT
  symbol,
  timeframe,
  open_time,
  now() AS utc_now,
  open_time - now() AS skew_offset,
  extract(epoch from (open_time - now())) / 3600.0 AS hours_ahead_of_utc,
  CASE
    WHEN extract(epoch from (open_time - now())) > 14400  THEN 'BEYOND_BUFFER — investigate'
    WHEN extract(epoch from (open_time - now())) BETWEEN 7200 AND 14400 THEN 'IN_BUFFER — normal broker UTC+3'
    WHEN extract(epoch from (open_time - now())) BETWEEN 0 AND 7200  THEN 'SLIGHTLY_AHEAD — normal'
    ELSE 'IN_PAST — normal completed candle'
  END AS clock_status,
  data_source
FROM forex_candles
WHERE open_time > now() - interval '4 hours'
ORDER BY open_time DESC;

COMMENT ON VIEW broker_clock_skew_diagnostic IS
'CCIP-BROKER-CLOCK-SKEW-2026-04-13: Shows recent candles relative to UTC now.
 Rows with clock_status=IN_BUFFER confirm the broker is writing in UTC+3.
 If no IN_BUFFER rows appear during active market hours, the pipeline may be stalled
 or the broker changed its clock domain. Run this view when charts show blank on reload.';
