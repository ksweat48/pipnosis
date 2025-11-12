import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SYMBOLS = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'];
const TICKS_TO_FETCH = 100;

interface TickData {
  symbol: string;
  time: string;
  brokerTime: string;
  bid: number;
  ask: number;
  bidHigh?: number;
  bidLow?: number;
  askHigh?: number;
  askLow?: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  const startTime = Date.now();

  try {
    console.log('📥 Starting preventive tick pre-fetch...');

    const metaapiToken = Deno.env.get('METAAPI_TOKEN');
    const metaapiAccountId = Deno.env.get('METAAPI_ACCOUNT_ID');
    const metaapiRegion = Deno.env.get('METAAPI_REGION') || 'london';

    if (!metaapiToken || !metaapiAccountId) {
      throw new Error('MetaAPI credentials not configured');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let totalTicksFetched = 0;
    let totalTicksSaved = 0;
    const results: Array<{symbol: string; fetched: number; saved: number}> = [];

    for (const symbol of SYMBOLS) {
      try {
        const { data: lastTick } = await supabase
          .from('realtime_prices')
          .select('broker_time')
          .eq('symbol', symbol)
          .order('broker_time', { ascending: false })
          .limit(1)
          .maybeSingle();

        const startTime = lastTick
          ? new Date(new Date(lastTick.broker_time).getTime() - 60000)
          : new Date(Date.now() - 300000);

        console.log(`  📊 Fetching ticks for ${symbol} from ${startTime.toISOString()}`);

        const ticks = await fetchHistoricalTicks(
          metaapiToken,
          metaapiAccountId,
          metaapiRegion,
          symbol,
          startTime
        );

        totalTicksFetched += ticks.length;

        if (ticks.length > 0) {
          const savedCount = await saveTicksToDatabase(supabase, symbol, ticks);
          totalTicksSaved += savedCount;

          results.push({
            symbol,
            fetched: ticks.length,
            saved: savedCount
          });

          console.log(`  ✅ ${symbol}: ${savedCount}/${ticks.length} ticks saved`);
        } else {
          console.log(`  ℹ️ ${symbol}: No new ticks available`);
          results.push({
            symbol,
            fetched: 0,
            saved: 0
          });
        }

        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (error) {
        console.error(`❌ Error fetching ticks for ${symbol}:`, error);
        results.push({
          symbol,
          fetched: 0,
          saved: 0
        });
      }
    }

    const duration = Date.now() - startTime;
    const summary = {
      success: true,
      timestamp: new Date().toISOString(),
      totalTicksFetched,
      totalTicksSaved,
      durationMs: duration,
      results
    };

    console.log(`✅ Pre-fetch complete: ${totalTicksFetched} fetched, ${totalTicksSaved} saved`);

    return new Response(
      JSON.stringify(summary, null, 2),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('❌ Pre-fetch failed:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

async function fetchHistoricalTicks(
  token: string,
  accountId: string,
  region: string,
  symbol: string,
  startTime: Date
): Promise<TickData[]> {
  const url = `https://mt-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${accountId}/historical-market-data/symbols/${symbol}/ticks?startTime=${startTime.toISOString()}&limit=${TICKS_TO_FETCH}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'auth-token': token,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`MetaAPI error (${response.status}): ${errorText}`);
  }

  const ticks = await response.json();

  if (!Array.isArray(ticks)) {
    throw new Error('Invalid tick data from MetaAPI');
  }

  return ticks;
}

async function saveTicksToDatabase(
  supabase: any,
  symbol: string,
  ticks: TickData[]
): Promise<number> {
  const ticksToSave = ticks.map(tick => ({
    symbol,
    bid: tick.bid.toString(),
    ask: tick.ask.toString(),
    broker_time: tick.brokerTime || tick.time,
    created_at: tick.time
  }));

  const { data, error } = await supabase
    .from('realtime_prices')
    .upsert(ticksToSave, {
      onConflict: 'symbol,broker_time',
      ignoreDuplicates: true
    });

  if (error) {
    console.error(`Error saving ticks for ${symbol}:`, error);
    return 0;
  }

  return ticksToSave.length;
}
