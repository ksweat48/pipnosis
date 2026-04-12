/*
  # Backfill Missing BTCUSD and ETHUSD Candles - April 12 Gap (Corrected)

  ## Problem
  A data gap exists in forex_candles for BTCUSD and ETHUSD:
  - Last candle before gap: 2026-04-11 23:50 UTC (BTC ~$73,054)
  - First candle after gap: 2026-04-12 03:45 UTC (BTC ~$71,709)
  - Gap duration: ~3 hours 55 minutes

  ## Corrections from first attempt
  - Kraken interval parameter is in MINUTES (not seconds): 1, 5, 15, 30, 60, 240
  - Kraken response key for BTC is XXBTZUSD (not XBTUSD)
  - Kraken response key for ETH is XETHZUSD (not ETHUSD)
  - Unix timestamps corrected for 2026 dates

  ## Gap window
  - since: 1775951700 = 2026-04-11 23:55:00 UTC
  - until: 1775966700 = 2026-04-12 04:05:00 UTC

  ## Tables Modified
  - `forex_candles`: New rows inserted with data_source = 'kraken_backfill'
    Uses ON CONFLICT DO NOTHING - no existing data is modified.
*/

DO $$
DECLARE
  v_response    http_response;
  v_content     jsonb;
  v_result      jsonb;
  v_candle      jsonb;
  v_open_time   timestamptz;
  v_close_time  timestamptz;
  v_open        numeric;
  v_high        numeric;
  v_low         numeric;
  v_close_p     numeric;
  v_volume      numeric;
  v_inserted    integer := 0;
  v_total       integer := 0;

  -- Gap window unix timestamps (2026, not 2025)
  v_since_unix  bigint := 1775951700; -- 2026-04-11 23:55:00 UTC
  v_until_ts    timestamptz := '2026-04-12 04:10:00+00'::timestamptz;

  -- (kraken_interval_minutes, tf_label, close_seconds)
  v_timeframes  text[][] := ARRAY[
    ARRAY['1',   'M1',  '60'],
    ARRAY['5',   'M5',  '300'],
    ARRAY['15',  'M15', '900'],
    ARRAY['30',  'M30', '1800'],
    ARRAY['60',  'H1',  '3600'],
    ARRAY['240', 'H4',  '14400']
  ];

  -- (kraken_pair_request, kraken_result_key, our_symbol)
  v_symbols     text[][] := ARRAY[
    ARRAY['XBTUSD', 'XXBTZUSD', 'BTCUSD'],
    ARRAY['ETHUSD', 'XETHZUSD', 'ETHUSD']
  ];

  v_sym         text[];
  v_tf          text[];
  v_url         text;
  v_interval    text;
  v_tf_label    text;
  v_close_secs  integer;
  v_our_sym     text;
  v_kraken_req  text;
  v_kraken_key  text;
  i             integer;
BEGIN
  FOREACH v_sym SLICE 1 IN ARRAY v_symbols LOOP
    v_kraken_req := v_sym[1];
    v_kraken_key := v_sym[2];
    v_our_sym    := v_sym[3];

    FOREACH v_tf SLICE 1 IN ARRAY v_timeframes LOOP
      v_interval   := v_tf[1];
      v_tf_label   := v_tf[2];
      v_close_secs := v_tf[3]::integer;

      v_url := format(
        'https://api.kraken.com/0/public/OHLC?pair=%s&interval=%s&since=%s',
        v_kraken_req, v_interval, v_since_unix
      );

      BEGIN
        SELECT * INTO v_response
        FROM http((
          'GET',
          v_url,
          ARRAY[http_header('Accept', 'application/json')],
          NULL,
          NULL
        )::http_request);

        IF v_response.status != 200 THEN
          RAISE WARNING 'HTTP % for %/%', v_response.status, v_our_sym, v_tf_label;
          CONTINUE;
        END IF;

        v_content := v_response.content::jsonb;

        IF jsonb_array_length(v_content->'error') > 0 THEN
          RAISE WARNING 'Kraken error for %/%: %', v_our_sym, v_tf_label, v_content->'error';
          CONTINUE;
        END IF;

        v_result := v_content->'result'->v_kraken_key;

        IF v_result IS NULL OR jsonb_typeof(v_result) != 'array' THEN
          RAISE WARNING 'No result array for %/% with key %', v_our_sym, v_tf_label, v_kraken_key;
          CONTINUE;
        END IF;

        v_inserted := 0;

        FOR i IN 0..jsonb_array_length(v_result)-1 LOOP
          v_candle    := v_result->i;

          -- Kraken OHLC: [time, open, high, low, close, vwap, volume, count]
          v_open_time  := to_timestamp((v_candle->>0)::bigint);
          v_close_time := v_open_time + (v_close_secs || ' seconds')::interval;
          v_open       := (v_candle->>1)::numeric;
          v_high       := (v_candle->>2)::numeric;
          v_low        := (v_candle->>3)::numeric;
          v_close_p    := (v_candle->>4)::numeric;
          v_volume     := (v_candle->>6)::numeric;

          -- Only insert within the gap window
          IF v_open_time < '2026-04-11 23:55:00+00'::timestamptz
             OR v_open_time >= v_until_ts THEN
            CONTINUE;
          END IF;

          -- Skip flat candles
          IF v_open = v_high AND v_high = v_low AND v_low = v_close_p THEN
            CONTINUE;
          END IF;

          -- Skip invalid OHLC
          IF v_high < v_low OR v_open <= 0 OR v_close_p <= 0 THEN
            CONTINUE;
          END IF;

          INSERT INTO forex_candles (
            symbol, timeframe, open_time, close_time,
            open, high, low, close, volume,
            data_source, quality_score, deprecated, is_flat_candle,
            tick_count, tick_volume, spread
          ) VALUES (
            v_our_sym, v_tf_label, v_open_time, v_close_time,
            v_open, v_high, v_low, v_close_p, v_volume,
            'kraken_backfill', 85.0, false, false,
            0, 0, 0
          )
          ON CONFLICT (symbol, timeframe, open_time) DO NOTHING;

          IF FOUND THEN
            v_inserted := v_inserted + 1;
            v_total    := v_total + 1;
          END IF;
        END LOOP;

        RAISE NOTICE 'Inserted % candles for %/%', v_inserted, v_our_sym, v_tf_label;

      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Error processing %/%: %', v_our_sym, v_tf_label, SQLERRM;
      END;

      -- Respect Kraken public API rate limits (~1 req/sec)
      PERFORM pg_sleep(1);
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Kraken backfill complete. Total candles inserted: %', v_total;
END $$;
