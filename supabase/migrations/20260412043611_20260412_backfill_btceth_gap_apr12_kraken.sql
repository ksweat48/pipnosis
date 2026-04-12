/*
  # Backfill Missing BTCUSD and ETHUSD Candles - April 12 Gap

  ## Problem
  A data gap exists in forex_candles for BTCUSD and ETHUSD:
  - Last candle before gap: 2026-04-11 23:50 UTC (BTC ~$73,054, ETH ~$2,285)
  - First candle after gap: 2026-04-12 03:45 UTC (BTC ~$71,709, ETH ~$2,215)
  - Gap duration: ~3 hours 55 minutes

  This gap creates a visual disconnect on the chart because the live price fix
  resulted in a ~$1,400 price jump with no historical candles to bridge it.

  ## Solution
  Use the Kraken public REST OHLC API to fetch the missing candles for:
  - Symbols: BTCUSD (Kraken: XBTUSD), ETHUSD
  - Timeframes: M1 (60s), M5 (300s), M15 (900s), M30 (1800s), H1 (3600s), H4 (14400s)
  - Window: 2026-04-11 23:55 UTC through 2026-04-12 03:50 UTC

  All inserts use ON CONFLICT DO NOTHING to protect existing data.

  ## Tables Modified
  - `forex_candles`: New rows inserted with data_source = 'kraken_backfill'

  ## Security
  - No RLS changes needed (write uses service role context in migration)
  - All inserts are non-destructive (ON CONFLICT DO NOTHING)
*/

DO $$
DECLARE
  v_response http_response;
  v_content  jsonb;
  v_result   jsonb;
  v_candle   jsonb;
  v_open_time  timestamptz;
  v_close_time timestamptz;
  v_open   numeric;
  v_high   numeric;
  v_low    numeric;
  v_close  numeric;
  v_volume numeric;
  v_inserted integer := 0;
  v_skipped  integer := 0;

  -- Gap window: April 11 23:55 UTC to April 12 04:00 UTC
  v_since_unix bigint := 1744415700; -- 2026-04-11 23:55:00 UTC

  -- Timeframe config: (kraken_interval_seconds, tf_label, close_duration_seconds)
  v_timeframes text[][] := ARRAY[
    ARRAY['60',   'M1',  '60'],
    ARRAY['300',  'M5',  '300'],
    ARRAY['900',  'M15', '900'],
    ARRAY['1800', 'M30', '1800'],
    ARRAY['3600', 'H1',  '3600'],
    ARRAY['14400','H4',  '14400']
  ];

  -- Symbols: (kraken_pair, our_symbol)
  v_symbols text[][] := ARRAY[
    ARRAY['XBTUSD', 'BTCUSD'],
    ARRAY['ETHUSD', 'ETHUSD']
  ];

  v_sym      text[];
  v_tf       text[];
  v_url      text;
  v_interval int;
  v_tf_label text;
  v_close_dur int;
  v_our_sym  text;
  v_kraken_pair text;
BEGIN
  -- Loop over symbols
  FOREACH v_sym SLICE 1 IN ARRAY v_symbols LOOP
    v_kraken_pair := v_sym[1];
    v_our_sym     := v_sym[2];

    -- Loop over timeframes
    FOREACH v_tf SLICE 1 IN ARRAY v_timeframes LOOP
      v_interval  := v_tf[1]::int;
      v_tf_label  := v_tf[2];
      v_close_dur := v_tf[3]::int;

      v_url := format(
        'https://api.kraken.com/0/public/OHLC?pair=%s&interval=%s&since=%s',
        v_kraken_pair, v_interval, v_since_unix
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

        v_content := v_response.content::jsonb;

        -- Kraken response: {"error":[], "result": {"XBTUSD": [[time, open, high, low, close, vwap, volume, count], ...], "last": N}}
        IF jsonb_array_length(v_content->'error') > 0 THEN
          RAISE WARNING 'Kraken API error for %/%: %', v_our_sym, v_tf_label, v_content->'error';
          CONTINUE;
        END IF;

        -- The result key varies by pair name
        v_result := v_content->'result'->v_kraken_pair;
        IF v_result IS NULL THEN
          -- Try without X prefix for XBTUSD -> XXBTZUSD alias
          v_result := v_content->'result'->'XXBTZUSD';
        END IF;
        IF v_result IS NULL THEN
          v_result := v_content->'result'->'XETHZUSD';
        END IF;
        IF v_result IS NULL THEN
          RAISE WARNING 'No result data for %/% in Kraken response', v_our_sym, v_tf_label;
          CONTINUE;
        END IF;

        -- Insert each candle
        FOR i IN 0..jsonb_array_length(v_result)-1 LOOP
          v_candle := v_result->i;

          -- Kraken OHLC array: [time, open, high, low, close, vwap, volume, count]
          v_open_time  := to_timestamp((v_candle->>0)::bigint);
          v_close_time := v_open_time + (v_close_dur || ' seconds')::interval;
          v_open       := (v_candle->>1)::numeric;
          v_high       := (v_candle->>2)::numeric;
          v_low        := (v_candle->>3)::numeric;
          v_close      := (v_candle->>4)::numeric;
          v_volume     := (v_candle->>6)::numeric;

          -- Only insert candles within the gap window (up to Apr 12 04:05 UTC)
          IF v_open_time < '2026-04-11 23:55:00+00'::timestamptz 
             OR v_open_time > '2026-04-12 04:05:00+00'::timestamptz THEN
            CONTINUE;
          END IF;

          -- Skip flat candles
          IF v_open = v_high AND v_high = v_low AND v_low = v_close THEN
            v_skipped := v_skipped + 1;
            CONTINUE;
          END IF;

          -- Skip invalid OHLC
          IF v_high < v_low OR v_open <= 0 OR v_close <= 0 THEN
            v_skipped := v_skipped + 1;
            CONTINUE;
          END IF;

          INSERT INTO forex_candles (
            symbol, timeframe, open_time, close_time,
            open, high, low, close, volume,
            data_source, quality_score, deprecated, is_flat_candle,
            tick_count, tick_volume, spread
          ) VALUES (
            v_our_sym, v_tf_label, v_open_time, v_close_time,
            v_open, v_high, v_low, v_close, v_volume,
            'kraken_backfill', 85.0, false, false,
            0, 0, 0
          )
          ON CONFLICT (symbol, timeframe, open_time) DO NOTHING;

          IF FOUND THEN
            v_inserted := v_inserted + 1;
          ELSE
            v_skipped := v_skipped + 1;
          END IF;
        END LOOP;

        RAISE NOTICE 'Processed %/% - inserted: %, skipped: %',
          v_our_sym, v_tf_label, v_inserted, v_skipped;
        v_inserted := 0;
        v_skipped  := 0;

      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Error fetching %/% from Kraken: %', v_our_sym, v_tf_label, SQLERRM;
      END;

      -- Brief pause between requests to respect Kraken rate limits
      PERFORM pg_sleep(0.5);
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Kraken backfill complete for BTCUSD and ETHUSD gap window.';
END $$;
