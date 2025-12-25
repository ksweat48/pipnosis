import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface SymbolConfig {
  symbol: string;
  daysBack: number;
  timeframes: string[];
}

const SYMBOL_CONFIGS: SymbolConfig[] = [
  {
    symbol: 'BTCUSD',
    daysBack: 7,
    timeframes: ['1m', '5m', '15m', '30m', '1h', '4h', '1d']
  },
  {
    symbol: 'ETHUSD',
    daysBack: 7,
    timeframes: ['1m', '5m', '15m', '30m', '1h', '4h', '1d']
  },
  {
    symbol: 'NAS100',
    daysBack: 7,
    timeframes: ['1m', '5m', '15m', '30m', '1h', '4h', '1d']
  },
  {
    symbol: 'SPX500',
    daysBack: 7,
    timeframes: ['1m', '5m', '15m', '30m', '1h', '4h', '1d']
  },
];

const TIMEFRAME_DURATIONS: Record<string, number> = {
  '1m': 60000,           // 1 minute
  '5m': 300000,          // 5 minutes
  '15m': 900000,         // 15 minutes
  '30m': 1800000,        // 30 minutes
  '1h': 3600000,         // 1 hour
  '4h': 14400000,        // 4 hours
  '1d': 86400000,        // 1 day
};

const TIMEFRAME_TO_DB: Record<string, string> = {
  '1m': 'M1',
  '5m': 'M5',
  '15m': 'M15',
  '30m': 'M30',
  '1h': 'H1',
  '4h': 'H4',
  '1d': 'D1',
};

interface MetaAPICandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume?: number;
  volume?: number;
}

async function fetchMetaAPICandles(
  accountId: string,
  symbol: string,
  timeframe: string,
  startTime: string,
  token: string
): Promise<MetaAPICandle[]> {
  const url = `https://mt-market-data-client-api-v1.london.agiliumtrade.ai/users/current/accounts/${accountId}/historical-market-data/symbols/${symbol}/timeframes/${timeframe}/candles?startTime=${startTime}`;

  try {
    const response = await fetch(url, {
      headers: {
        'auth-token': token,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`MetaAPI error for ${symbol} ${timeframe}: ${response.status} - ${text}`);
      return [];
    }

    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error(`Error fetching ${symbol} ${timeframe}:`, error);
    return [];
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const metaapiToken = Deno.env.get('METAAPI_TOKEN') || 'eyJhbGciOiJSUzUxMiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiI1MDUzN2VhZWFjOGIyYWMxZmY4ZWQ2MTRhMjkzZjZkOCIsImFjY2Vzc1J1bGVzIjpbeyJpZCI6InRyYWRpbmctYWNjb3VudC1tYW5hZ2VtZW50LWFwaSIsIm1ldGhvZHMiOlsidHJhZGluZy1hY2NvdW50LW1hbmFnZW1lbnQtYXBpOnJlc3Q6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6Im1ldGFhcGktcmVzdC1hcGkiLCJtZXRob2RzIjpbIm1ldGFhcGktYXBpOnJlc3Q6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6Im1ldGFhcGktcnBjLWFwaSIsIm1ldGhvZHMiOlsibWV0YWFwaS1hcGk6d3M6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6Im1ldGFhcGktcmVhbC10aW1lLXN0cmVhbWluZy1hcGkiLCJtZXRob2RzIjpbIm1ldGFhcGktYXBpOndzOnB1YmxpYzoqOioiXSwicm9sZXMiOlsicmVhZGVyIiwid3JpdGVyIl0sInJlc291cmNlcyI6WyIqOiRVU0VSX0lEJDoqIl19LHsiaWQiOiJtZXRhc3RhdHMtYXBpIiwibWV0aG9kcyI6WyJtZXRhc3RhdHMtYXBpOnJlc3Q6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6InJpc2stbWFuYWdlbWVudC1hcGkiLCJtZXRob2RzIjpbInJpc2stbWFuYWdlbWVudC1hcGk6cmVzdDpwdWJsaWM6KjoqIl0sInJvbGVzIjpbInJlYWRlciIsIndyaXRlciJdLCJyZXNvdXJjZXMiOlsiKjokVVNFUl9JRCQ6KiJdfV0sImlnbm9yZVJhdGVMaW1pdHMiOmZhbHNlLCJ0b2tlbklkIjoiMjAyMTAyMTMiLCJpbXBlcnNvbmF0ZWQiOmZhbHNlLCJyZWFsVXNlcklkIjoiNTA1MzdlYWVhYzhiMmFjMWZmOGVkNjE0YTI5M2Y2ZDgiLCJpYXQiOjE3NjE2MjU1NDR9.VKdHTz4ONF639nOSv746-TViY4fvnZRgjQdj0twpE_sfRVgIU2f-6TEykdnZlP0VfUpbVINdbEMzNHgG_eTnPgzbpCmXL1EUZb4lBb7wKkr5GgGjTpWBxrsJZzrnc8bDirJd6uhZfD0v9E7KgNlxQpDhBAPI63ZAxtw9oz6uZ6w4eWt_p2A6gXDjGbQIPgrYnLi8u8qOwZuPJ6C_oD9PHx9HT1T3XRfhLlwoBV83BRTL3EUwldGFBaKWV210kywSWsvDkVtGgq-6dUgeLylfJbLgialnSzUNfHAH0AQGr2BlRA6bgWRR6FmJJwYGxWgcwaaq8WNgaSgkov8QvM1-FU-OXRWzqnmWV0XhSHOIgj9GAWs8FfdApPIrkyVUwsbXsFhtxaWXSBldu1iJcSaAC3WL3OSGCkrfOvhNLBh2MLl0Bx-1y4zoK4tVQR13CNTTt5iRc6GARTPaa1xTaanw0T-XKSSx0Gofim8ci4aQyebbMioLA8-vtkxuoY4Yzl3Xy-MWUyAcTi9n7I8Getp96kbZr2yOtyNlNvZOeoqIuDnufgNvgnHIjWkcnqZ-plI8LB2tr3rBh1KdSOfJQm_TYBvpSkrmMAoSCMG4wqfu4Om7OFi9GDMcj2mNawlkHJaR2YK2bsErJhKeD2XMqZs14gBdCxA8H3i0w25K44b-LoM';
    const accountId = Deno.env.get('METAAPI_ACCOUNT_ID') || '28867898-bcc5-4a8d-969f-1acc6073eae2';

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('Starting MetaAPI multi-timeframe backfill...');
    const startTime = Date.now();

    const results = [];
    const now = new Date();
    let totalCandles = 0;
    let totalSuccessful = 0;
    let totalFailed = 0;

    for (const config of SYMBOL_CONFIGS) {
      console.log(`\n=== Processing ${config.symbol} ===`);

      const symbolResult: any = {
        symbol: config.symbol,
        timeframes: {},
      };

      for (const timeframe of config.timeframes) {
        try {
          console.log(`  Fetching ${timeframe}...`);

          const startDate = new Date(now.getTime() - (config.daysBack * 24 * 60 * 60 * 1000));
          const startTimeStr = startDate.toISOString();

          const candles = await fetchMetaAPICandles(
            accountId,
            config.symbol,
            timeframe,
            startTimeStr,
            metaapiToken
          );

          if (candles.length === 0) {
            symbolResult.timeframes[timeframe] = {
              success: false,
              candles: 0,
              error: 'No data returned',
            };
            totalFailed++;
            continue;
          }

          const duration = TIMEFRAME_DURATIONS[timeframe];
          const dbTimeframe = TIMEFRAME_TO_DB[timeframe];

          const candleData = candles.map((c) => {
            const openTime = new Date(c.time);
            const closeTime = new Date(openTime.getTime() + duration);

            return {
              symbol: config.symbol,
              timeframe: dbTimeframe,
              open_time: openTime.toISOString(),
              close_time: closeTime.toISOString(),
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
              volume: c.volume || c.tickVolume || 0,
              data_source: 'metaapi',
            };
          });

          const { error } = await supabase
            .from('forex_candles')
            .upsert(candleData, {
              onConflict: 'symbol,timeframe,open_time',
              ignoreDuplicates: false,
            });

          if (error) {
            symbolResult.timeframes[timeframe] = {
              success: false,
              candles: 0,
              error: error.message,
            };
            totalFailed++;
          } else {
            symbolResult.timeframes[timeframe] = {
              success: true,
              candles: candleData.length,
            };
            totalCandles += candleData.length;
            totalSuccessful++;
            console.log(`  ✓ ${timeframe}: ${candleData.length} candles`);
          }

          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (error) {
          symbolResult.timeframes[timeframe] = {
            success: false,
            candles: 0,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
          totalFailed++;
        }
      }

      results.push(symbolResult);

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    const response = {
      success: true,
      duration: `${duration}s`,
      summary: {
        totalPairs: SYMBOL_CONFIGS.length,
        totalTimeframeRequests: SYMBOL_CONFIGS.length * SYMBOL_CONFIGS[0].timeframes.length,
        successful: totalSuccessful,
        failed: totalFailed,
        totalCandles,
      },
      results,
    };

    console.log('\n=== Backfill Complete ===');
    console.log(`Duration: ${duration}s`);
    console.log(`Total Candles: ${totalCandles}`);
    console.log(`Successful: ${totalSuccessful}/${response.summary.totalTimeframeRequests}`);

    return new Response(
      JSON.stringify(response, null, 2),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('Backfill error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});