import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface TwelveDataCandle {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
}

interface SymbolConfig {
  pipnosisSymbol: string;
  twelveDataSymbol: string;
  interval: string;
  outputsize: number;
}

const SYMBOL_CONFIGS: SymbolConfig[] = [
  { pipnosisSymbol: 'BTCUSD', twelveDataSymbol: 'BTC/USD', interval: '1h', outputsize: 168 },
  { pipnosisSymbol: 'ETHUSD', twelveDataSymbol: 'ETH/USD', interval: '1h', outputsize: 168 },
  { pipnosisSymbol: 'NAS100', twelveDataSymbol: 'IXIC', interval: '1h', outputsize: 168 },
  { pipnosisSymbol: 'SPX500', twelveDataSymbol: '^GSPC', interval: '1h', outputsize: 168 },
];

const TIMEFRAME_MAP: Record<string, string> = {
  '1h': 'H1',
  '4h': 'H4',
  '1day': 'D1',
};

async function fetchTwelveDataCandles(
  symbol: string,
  interval: string,
  outputsize: number,
  apiKey: string
): Promise<TwelveDataCandle[]> {
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(
    symbol
  )}&interval=${interval}&outputsize=${outputsize}&apikey=${apiKey}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.status === 'error') {
      throw new Error(data.message || 'API error');
    }

    if (!data.values || !Array.isArray(data.values)) {
      throw new Error('Invalid response format');
    }

    return data.values;
  } catch (error) {
    console.error(`Error fetching ${symbol} ${interval}:`, error);
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
    const twelveDataKey = Deno.env.get('TWELVE_DATA_API_KEY') || 'demo';

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('🚀 Starting Twelve Data bootstrap...');
    const startTime = Date.now();

    const results = [];

    for (const config of SYMBOL_CONFIGS) {
      try {
        console.log(`Fetching ${config.pipnosisSymbol} (${config.twelveDataSymbol})...`);

        const candles = await fetchTwelveDataCandles(
          config.twelveDataSymbol,
          config.interval,
          config.outputsize,
          twelveDataKey
        );

        if (candles.length === 0) {
          results.push({
            symbol: config.pipnosisSymbol,
            success: false,
            candles: 0,
            error: 'No data returned',
          });
          continue;
        }

        const timeframe = TIMEFRAME_MAP[config.interval] || 'H1';

        const candleData = candles.map((c) => ({
          symbol: config.pipnosisSymbol,
          timeframe,
          open_time: new Date(c.datetime).toISOString(),
          close_time: new Date(
            new Date(c.datetime).getTime() + 3600000
          ).toISOString(),
          open: parseFloat(c.open),
          high: parseFloat(c.high),
          low: parseFloat(c.low),
          close: parseFloat(c.close),
          volume: c.volume ? parseFloat(c.volume) : 0,
        }));

        const { error } = await supabase.from('forex_candles').upsert(candleData, {
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

        await new Promise((resolve) => setTimeout(resolve, 1000));
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
    console.error('Bootstrap error:', error);
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