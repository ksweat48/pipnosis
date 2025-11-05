import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const FOREX_PAIRS = [
  'XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF',
  'AUDUSD', 'USDCAD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY'
];

interface PriceData {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  timestamp: string;
}

async function fetchPriceFromMetaApi(symbol: string): Promise<PriceData | null> {
  const metaapiToken = Deno.env.get('METAAPI_TOKEN');
  const metaapiAccountId = Deno.env.get('METAAPI_ACCOUNT_ID');
  const metaapiRegion = Deno.env.get('METAAPI_REGION') || 'new-york';

  if (!metaapiToken || !metaapiAccountId) {
    console.error('MetaAPI credentials not configured');
    return null;
  }

  try {
    const url = `https://mt-client-api-v1.${metaapiRegion}.agiliumtrade.ai/users/current/accounts/${metaapiAccountId}/symbols/${symbol}/current-price`;

    const response = await fetch(url, {
      headers: {
        'auth-token': metaapiToken,
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      console.error(`MetaAPI error for ${symbol}: ${response.status}`);
      return null;
    }

    const data = await response.json();

    const bid = parseFloat(data.bid);
    const ask = parseFloat(data.ask);
    const mid = (bid + ask) / 2;
    const spread = ask - bid;

    return {
      symbol,
      bid,
      ask,
      mid,
      spread,
      timestamp: data.time || new Date().toISOString()
    };
  } catch (error) {
    console.error(`Failed to fetch price for ${symbol}:`, error);
    return null;
  }
}

async function savePriceToDatabase(supabase: any, priceData: PriceData): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('realtime_prices')
      .insert({
        symbol: priceData.symbol,
        bid: priceData.bid,
        ask: priceData.ask,
        mid: priceData.mid,
        spread: priceData.spread,
        broker_time: priceData.timestamp,
        source: 'metaapi_edge_function'
      });

    if (error) {
      console.error(`DB error for ${priceData.symbol}:`, error.message);
      return false;
    }

    console.log(`✅ [${priceData.symbol}] Saved: ${priceData.bid}/${priceData.ask}`);
    return true;
  } catch (error) {
    console.error(`Exception saving ${priceData.symbol}:`, error);
    return false;
  }
}

async function pollAllSymbols(supabase: any): Promise<number> {
  let successCount = 0;

  const promises = FOREX_PAIRS.map(async (symbol) => {
    const priceData = await fetchPriceFromMetaApi(symbol);

    if (priceData) {
      const saved = await savePriceToDatabase(supabase, priceData);
      if (saved) {
        successCount++;
      }
    }
  });

  await Promise.allSettled(promises);

  return successCount;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'poll';

    if (action === 'poll') {
      console.log(`🔄 Starting price poll for ${FOREX_PAIRS.length} pairs...`);
      const startTime = Date.now();

      const successCount = await pollAllSymbols(supabase);

      const duration = Date.now() - startTime;
      console.log(`✅ Poll complete: ${successCount}/${FOREX_PAIRS.length} pairs updated in ${duration}ms`);

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Price polling completed',
          totalPairs: FOREX_PAIRS.length,
          successfulUpdates: successCount,
          failedUpdates: FOREX_PAIRS.length - successCount,
          durationMs: duration,
          timestamp: new Date().toISOString()
        }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (action === 'status') {
      const { data: recentPrices, error } = await supabase
        .from('realtime_prices')
        .select('symbol, created_at')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) {
        throw error;
      }

      const symbolLastUpdate = new Map<string, Date>();
      recentPrices?.forEach((price: any) => {
        if (!symbolLastUpdate.has(price.symbol)) {
          symbolLastUpdate.set(price.symbol, new Date(price.created_at));
        }
      });

      const statusBySymbol = FOREX_PAIRS.map(symbol => {
        const lastUpdate = symbolLastUpdate.get(symbol);
        const ageMs = lastUpdate ? Date.now() - lastUpdate.getTime() : null;

        return {
          symbol,
          lastUpdate: lastUpdate?.toISOString() || null,
          ageSeconds: ageMs ? Math.floor(ageMs / 1000) : null,
          status: !lastUpdate ? 'no_data' :
                  ageMs! < 10000 ? 'active' :
                  ageMs! < 60000 ? 'stale' :
                  'inactive'
        };
      });

      return new Response(
        JSON.stringify({
          success: true,
          totalSymbols: FOREX_PAIRS.length,
          symbols: statusBySymbol,
          timestamp: new Date().toISOString()
        }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    return new Response(
      JSON.stringify({
        error: 'Invalid action. Use ?action=poll or ?action=status'
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );

  } catch (error) {
    console.error('Function error:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});
