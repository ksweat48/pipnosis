/*
  # Backfill Missing BTCUSD and ETHUSD Candles - Final (Generated Column Fix)

  ## Root Cause of Previous Failures
  `is_flat_candle` is a GENERATED column in forex_candles - it cannot be set
  explicitly. All previous migration attempts silently failed on every INSERT
  because of this constraint violation inside the DO block exception handler.

  ## This Migration
  Inserts without specifying `is_flat_candle` - the database computes it.
  Covers all timeframes (M1, M5, M15, M30, H1, H4) for both BTCUSD and ETHUSD.
  Gap window: 2026-04-11 23:55 UTC to 2026-04-12 03:45 UTC

  ## Tables Modified
  - `forex_candles`: New rows for the gap window, data_source = 'kraken_backfill'
    ON CONFLICT DO NOTHING protects all existing rows.
*/

CREATE TEMP TABLE _bf_jobs (
  pair      text,
  rkey      text,
  symbol    text,
  intv      text,
  tf        text,
  close_sec integer
) ON COMMIT DROP;

INSERT INTO _bf_jobs VALUES
  ('XBTUSD','XXBTZUSD','BTCUSD','1',  'M1',    60),
  ('XBTUSD','XXBTZUSD','BTCUSD','5',  'M5',   300),
  ('XBTUSD','XXBTZUSD','BTCUSD','15', 'M15',  900),
  ('XBTUSD','XXBTZUSD','BTCUSD','30', 'M30', 1800),
  ('XBTUSD','XXBTZUSD','BTCUSD','60', 'H1',  3600),
  ('XBTUSD','XXBTZUSD','BTCUSD','240','H4', 14400),
  ('ETHUSD','XETHZUSD','ETHUSD','1',  'M1',    60),
  ('ETHUSD','XETHZUSD','ETHUSD','5',  'M5',   300),
  ('ETHUSD','XETHZUSD','ETHUSD','15', 'M15',  900),
  ('ETHUSD','XETHZUSD','ETHUSD','30', 'M30', 1800),
  ('ETHUSD','XETHZUSD','ETHUSD','60', 'H1',  3600),
  ('ETHUSD','XETHZUSD','ETHUSD','240','H4', 14400);

DO $$
DECLARE
  v_resp     http_response;
  v_data     jsonb;
  v_item     jsonb;
  v_ot       timestamptz;
  v_ct       timestamptz;
  v_n        integer;
  i          integer;

  v_pair     text;
  v_rkey     text;
  v_symbol   text;
  v_intv     text;
  v_tf       text;
  v_close_s  integer;

  c_gap_start CONSTANT timestamptz := '2026-04-11 23:55:00+00';
  c_gap_end   CONSTANT timestamptz := '2026-04-12 03:45:00+00';
  c_since     CONSTANT bigint       := 1775951700;
BEGIN
  FOR v_pair, v_rkey, v_symbol, v_intv, v_tf, v_close_s IN
    SELECT pair, rkey, symbol, intv, tf, close_sec FROM _bf_jobs
  LOOP
    BEGIN
      SELECT * INTO v_resp
      FROM http((
        'GET',
        format('https://api.kraken.com/0/public/OHLC?pair=%s&interval=%s&since=%s',
               v_pair, v_intv, c_since),
        ARRAY[http_header('Accept','application/json')],
        NULL, NULL
      )::http_request);

      IF v_resp.status != 200 THEN
        RAISE WARNING 'HTTP % for %/%', v_resp.status, v_symbol, v_tf;
        CONTINUE;
      END IF;

      v_data := (v_resp.content::jsonb)->'result'->v_rkey;

      IF v_data IS NULL OR jsonb_typeof(v_data) != 'array' THEN
        RAISE WARNING 'No array for %/%', v_symbol, v_tf;
        CONTINUE;
      END IF;

      v_n := 0;

      FOR i IN 0 .. jsonb_array_length(v_data) - 1 LOOP
        v_item := v_data->i;
        v_ot   := to_timestamp((v_item->>0)::bigint);

        -- Only process candles strictly within the gap
        IF v_ot < c_gap_start OR v_ot >= c_gap_end THEN
          CONTINUE;
        END IF;

        v_ct := v_ot + (v_close_s || ' seconds')::interval;

        -- Skip zero/negative prices
        IF (v_item->>1)::numeric <= 0 OR (v_item->>4)::numeric <= 0 THEN
          CONTINUE;
        END IF;

        -- NOTE: is_flat_candle is omitted - it is a GENERATED column
        INSERT INTO forex_candles (
          symbol, timeframe, open_time, close_time,
          open, high, low, close, volume,
          data_source, quality_score, deprecated,
          tick_count, tick_volume, spread
        ) VALUES (
          v_symbol,
          v_tf,
          v_ot,
          v_ct,
          (v_item->>1)::numeric,
          (v_item->>2)::numeric,
          (v_item->>3)::numeric,
          (v_item->>4)::numeric,
          (v_item->>6)::numeric,
          'kraken_backfill',
          85.0,
          false,
          0, 0, 0
        )
        ON CONFLICT (symbol, timeframe, open_time) DO NOTHING;

        v_n := v_n + 1;
      END LOOP;

      RAISE NOTICE '  %/% -> % rows attempted in gap window', v_symbol, v_tf, v_n;

    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Error on %/%: % (SQLSTATE: %)', v_symbol, v_tf, SQLERRM, SQLSTATE;
    END;

    PERFORM pg_sleep(0.8);
  END LOOP;

  RAISE NOTICE 'Backfill complete.';
END $$;
