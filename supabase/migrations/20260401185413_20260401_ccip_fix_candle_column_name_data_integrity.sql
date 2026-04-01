/*
  # CCIP Data Integrity Fix — Candle Column Name Bug & Index ATR Floors

  ## Summary
  Critical data integrity fix addressing wrong column names in candle/price queries
  that caused Alpha to receive corrupted ATR values, leading to false "low volatility"
  NO_TRADE decisions during active, high-volatility market sessions.

  ## Root Cause
  The `forex_candles` and `forex_candles_best` tables use `open_time` as the timestamp
  column. Multiple services were querying `.order('timestamp', ...)` — a column that does
  NOT exist on these tables. Supabase returns rows with null for non-existent columns and
  falls back to undefined ordering, scrambling the chronological sequence used to compute
  true range / ATR. The resulting garbage ATR (~3 pips for SPX500 vs live value of ~6 pts)
  triggered false volatility compression warnings in Alpha's analysis.

  ## Files Fixed (frontend code — applied outside this migration)
  1. src/services/m5-swing-analyzer.ts
     - FIXED: .select('timestamp,...') → .select('open_time,...')
     - FIXED: .order('timestamp',...) → .order('open_time',...)
     - REMOVED: Silent getDefaultContext() fallback — now throws loud errors on data failure
     - ADDED: OHLC integrity validation (rejects candles with null/invalid values)

  2. src/services/omega10-scheduler.ts
     - FIXED: alpha_decisions .order('timestamp',...) → .order('created_at',...)

  3. src/services/goal-session-live-engine.ts
     - FIXED: realtime_prices .order('timestamp',...) → .order('created_at',...)

  4. src/config/trading-constants.ts
     - ADDED: SPX500 (1.5 pts), US30 (5.0 pts), NAS100 (3.0 pts) to ATR_MINIMUMS

  ## Governance Principle
  Alpha operates exclusively on LIVE data. There is NO acceptable fallback to static or
  generic defaults when live data fails. All data failures must throw loud, descriptive
  errors that surface immediately in logs.

  ## Evidence from Live Database (queried 2026-04-01)
  Real SPX500 M5 ATR (14-period): 5.96 points | Min TR: 2.00 | Max TR: 13.25
  Alpha was receiving: ~3.19 pips (corrupted due to unordered candle sequence)
*/

DO $$
BEGIN
  INSERT INTO governance_change_log (
    entity_type,
    entity_id,
    operation,
    old_value,
    new_value,
    reason,
    metadata
  )
  VALUES (
    'system_configuration',
    gen_random_uuid(),
    'ccip_ssot_fix',
    jsonb_build_object(
      'bug', 'wrong_column_names_in_candle_queries',
      'affected_files', jsonb_build_array(
        'src/services/m5-swing-analyzer.ts',
        'src/services/omega10-scheduler.ts',
        'src/services/goal-session-live-engine.ts',
        'src/config/trading-constants.ts'
      ),
      'symptom', 'Alpha receiving corrupted ATR (~3.19 pips for SPX500 vs real 5.96 pts), causing false LOW_VOLATILITY NO_TRADE decisions',
      'root_cause', 'Queries using .order("timestamp") on tables with no timestamp column (forex_candles uses open_time, alpha_decisions/realtime_prices use created_at)'
    ),
    jsonb_build_object(
      'fix', 'corrected_column_names_and_removed_silent_fallbacks',
      'm5_swing_analyzer', 'timestamp -> open_time, removed getDefaultContext() fallback, added OHLC integrity validation',
      'omega10_scheduler', 'alpha_decisions.timestamp -> alpha_decisions.created_at',
      'goal_session_live_engine', 'realtime_prices.timestamp -> realtime_prices.created_at',
      'trading_constants', 'added SPX500=1.5, US30=5.0, NAS100=3.0 to ATR_MINIMUMS',
      'live_atr_evidence', 'SPX500 M5 ATR from live data: 5.96 pts (min 2.0, max 13.25)'
    ),
    'CCIP-2026-04-01: Alpha market data integrity audit — column name corruption causing false low-volatility blocks',
    jsonb_build_object(
      'ccip_ref', 'CCIP-2026-04-01',
      'audited_by', 'system_audit',
      'severity', 'critical',
      'impact', 'Alpha producing NO_TRADE decisions based on corrupted ATR data across all instruments'
    )
  );
END $$;
