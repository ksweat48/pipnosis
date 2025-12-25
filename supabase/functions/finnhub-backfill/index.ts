import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface SymbolConfig {
  pipnosisSymbol: string;
  finnhubSymbol: string;
  resolution: string;
  daysBack: number;
}

const SYMBOL_CONFIGS: SymbolConfig[] = [
  { pipnosisSymbol: 'BTCUSD', finnhubSymbol: 'BINANCE:BTCUSDT', resolution: '60', daysBack: 7 },
  { pipnosisSymbol: 'ETHUSD', finnhubSymbol: 'BINANCE:ETHUSDT', resolution: '60', daysBack: 7 },
  { pipnosisSymbol: 'NAS100', finnhubSymbol: 'IXIC', resolution: '60', daysBack: 7 },
  { pipnosisSymbol: 'SPX500', finnhubSymbol: 'SPX', resolution: '60', daysBack: 7 },
];

interface FinnhubResponse {
  c: number[];
  h: number[];
  l: number[];
  o: number[];
  t: number[];
  v: number[];
  s: string;
}

async function fetchFinnhubCandles(
  symbol: string,
  resolution: string,
  from: number,
  to: number,
  apiKey: string
): Promise<FinnhubResponse | null> {
  const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(
    symbol
  )}&resolution=${resolution}&from=${from}&to=${to}&token=${apiKey}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.s !== 'ok') {
      console.error(`Finnhub error for ${symbol}: ${data.s}`);
      return null;
    }

    return data;
  } catch (error) {
    console.error(`Error fetching ${symbol}:`, error);
    return null;
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
    const finnhubKey = Deno.env.get('FINNHUB_API_KEY') || 'd4ogqohr01quuso9k37gd4ogqohr01quuso9k380';

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('Starting Finnhub backfill...');
    const startTime = Date.now();

    const results = [];
    const now = Math.floor(Date.now() / 1000);

    for (const config of SYMBOL_CONFIGS) {
      try {
        console.log(`Fetching ${config.pipnosisSymbol} (${config.finnhubSymbol})...`);

        const from = now - (config.daysBack * 24 * 60 * 60);
        const to = now;

        const data = await fetchFinnhubCandles(
          config.finnhubSymbol,
          config.resolution,
          from,
          to,
          finnhubKey
        );

        if (!data || !data.c || data.c.length === 0) {
          results.push({
            symbol: config.pipnosisSymbol,
            success: false,
            candles: 0,
            error: 'No data returned',
          });
          continue;
        }

        const candleData = [];
        for (let i = 0; i < data.c.length; i++) {
          const openTime = new Date(data.t[i] * 1000);
          const closeTime = new Date((data.t[i] + 3600) * 1000);

          candleData.push({
            symbol: config.pipnosisSymbol,
            timeframe: 'H1',
            open_time: openTime.toISOString(),
            close_time: closeTime.toISOString(),
            open: data.o[i],
            high: data.h[i],
            low: data.l[i],
            close: data.c[i],
            volume: data.v[i] || 0,
            data_source: 'finnhub',
          });
        }

        const { data: insertData, error } = await supabase
          .from('forex_candles')
          .upsert(candleData, {
            onConflict: 'symbol,timeframe,open_time',
            ignoreDuplicates: false,
          });

        if (error) {
          results.push({
            symbol: config.pipnosisSymbol,
            success: false,
            candles: 0,
            error: error.message,
          });
        } else {
          results.push({
            symbol: config.pipnosisSymbol,
            success: true,
            candles: candleData.length,
          });
        }

        await new Promise((resolve) => setTimeout(resolve, 1200));
      } catch (error) {
        results.push({
          symbol: config.pipnosisSymbol,
          success: false,
          candles: 0,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const successful = results.filter((r) => r.success).length;
    const totalCandles = results.reduce((sum, r) => sum + r.candles, 0);

    return new Response(
      JSON.stringify({
        success: true,
        duration: `${duration}s`,
        summary: {
          total: results.length,
          successful,
          failed: results.length - successful,
          totalCandles,
        },
        results,
      }),
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