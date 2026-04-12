/*
  # Backfill Missing BTCUSD and ETHUSD Candles - Direct Insert v2

  ## Problem
  Gap confirmed: 2026-04-11 23:55 UTC to 2026-04-12 03:45 UTC (~3h50m)
  Both BTC and ETH have a hard gap in forex_candles across all timeframes.

  ## Solution
  Fetch from Kraken public OHLC API and insert only candles within the gap.
  Uses a temp table as the job list to iterate over (avoids PL/pgSQL TYPE limitation).

  ## Tables Modified
  - `forex_candles`: Inserts new rows for M1/M5/M15/M30/H1/H4
    ON CONFLICT DO NOTHING protects all existing data.
*/

-- Job list: pair, result_key, our_symbol, interval_minutes, tf_label, close_seconds
CREATE TEMP TABLE _backfill_jobs (
  pair      text,
  rkey      text,
  symbol    text,
  interval  text,
  tf        text,
  close_sec integer
) ON COMMIT DROP;

INSERT INTO _backfill_jobs VALUES
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
  v_interval text;
  v_tf       text;
  v_close_s  integer;

  c_gap_start CONSTANT timestamptz := '2026-04-11 23:55:00+00';
  c_gap_end   CONSTANT timestamptz := '2026-04-12 03:45:00+00';
  c_since     CONSTANT bigint       := 1775951700;
BEGIN
  FOR v_pair, v_rkey, v_symbol, v_interval, v_tf, v_close_s IN
    SELECT pair, rkey, symbol, interval, tf, close_sec FROM _backfill_jobs
  LOOP
    BEGIN
      SELECT * INTO v_resp
      FROM http((
        'GET',
        format('https://api.kraken.com/0/public/OHLC?pair=%s&interval=%s&since=%s',
               v_pair, v_interval, c_since),
        ARRAY[http_header('Accept','application/json')],
        NULL, NULL
      )::http_request);

      IF v_resp.status != 200 THEN
        RAISE WARNING 'HTTP % for %/%', v_resp.status, v_symbol, v_tf;
        CONTINUE;
      END IF;

      v_data := (v_resp.content::jsonb)->'result'->v_rkey;

      IF v_data IS NULL OR jsonb_typeof(v_data) != 'array' THEN
        RAISE WARNING 'No data array for %/% (key: %)', v_symbol, v_tf, v_rkey;
        CONTINUE;
      END IF;

      v_n := 0;

      FOR i IN 0 .. jsonb_array_length(v_data) - 1 LOOP
        v_item := v_data->i;
        v_ot   := to_timestamp((v_item->>0)::bigint);

        -- Skip outside gap window
        CONTINUE WHEN v_ot < c_gap_start OR v_ot >= c_gap_end;

        v_ct := v_ot + (v_close_s || ' seconds')::interval;

        -- Skip flat candles (all OHLC equal)
        CONTINUE WHEN (v_item->>1)::numeric = (v_item->>2)::numeric
                  AND (v_item->>2)::numeric = (v_item->>3)::numeric
                  AND (v_item->>3)::numeric = (v_item->>4)::numeric;

        -- Skip zero/negative prices
        CONTINUE WHEN (v_item->>1)::numeric <= 0
                   OR (v_item->>4)::numeric <= 0;

        INSERT INTO forex_candles (
          symbol, timeframe, open_time, close_time,
          open, high, low, close, volume,
          data_source, quality_score, deprecated, is_flat_candle,
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
          false,
          0, 0, 0
        )
        ON CONFLICT (symbol, timeframe, open_time) DO NOTHING;

        v_n := v_n + 1;
      END LOOP;

      RAISE NOTICE '  %/% -> inserted % candles in gap window', v_symbol, v_tf, v_n;

    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Error on %/%: %', v_symbol, v_tf, SQLERRM;
    END;

    PERFORM pg_sleep(0.8);
  END LOOP;

  RAISE NOTICE 'Backfill complete.';
END $$;
