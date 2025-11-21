import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const FOREX_PAIRS = [
  'XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'
];

interface PriceData {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  timestamp: string;
}

interface MarketStatus {
  isOpen: boolean;
  status: 'Open' | 'Closed';
  currentTime: string;
  dayOfWeek: number;
  hour: number;
  minute: number;
}

function getForexMarketStatus(): MarketStatus {
  const now = new Date();

  const estTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));

  const dayOfWeek = estTime.getDay();
  const hours = estTime.getHours();
  const minutes = estTime.getMinutes();
  const totalMinutes = hours * 60 + minutes;

  const fridayCloseTime = 17 * 60;
  const sundayOpenTime = 17 * 60;

  let isOpen = true;

  if (dayOfWeek === 6) {
    isOpen = false;
  } else if (dayOfWeek === 5 && totalMinutes >= fridayCloseTime) {
    isOpen = false;
  } else if (dayOfWeek === 0 && totalMinutes < sundayOpenTime) {
    isOpen = false;
  }

  return {
    isOpen,
    status: isOpen ? 'Open' : 'Closed',
    currentTime: estTime.toISOString(),
    dayOfWeek,
    hour: hours,
    minute: minutes
  };
}

async function fetchPriceFromMetaApi(symbol: string): Promise<PriceData | null> {
  const metaapiToken = Deno.env.get('METAAPI_TOKEN');
  const metaapiAccountId = Deno.env.get('METAAPI_ACCOUNT_ID');
  const metaapiRegion = Deno.env.get('METAAPI_REGION') || 'london';

  if (!metaapiToken || !metaapiAccountId) {
    console.error('❌ MetaAPI credentials not configured in Edge Function secrets');
    console.error('   Token present:', !!metaapiToken);
    console.error('   Account ID present:', !!metaapiAccountId);
    console.error('   Region:', metaapiRegion);
    return null;
  }

  try {
    const url = `https://mt-client-api-v1.${metaapiRegion}.agiliumtrade.ai/users/current/accounts/${metaapiAccountId}/symbols/${symbol}/current-price`;

    console.log(`🔄 Fetching ${symbol} from MetaAPI (${metaapiRegion})...`);

    const response = await fetch(url, {
      headers: {
        'auth-token': metaapiToken,
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ MetaAPI error for ${symbol}: ${response.status} - ${errorText}`);
      return null;
    }

    const data = await response.json();

    // Validate bid and ask are present and valid numbers
    if (!data.bid || !data.ask) {
      console.error(`❌ MetaAPI ${symbol}: Missing bid or ask in response:`, data);
      return null;
    }

    const bid = parseFloat(data.bid);
    const ask = parseFloat(data.ask);

    // Validate parsed numbers
    if (isNaN(bid) || isNaN(ask) || bid <= 0 || ask <= 0) {
      console.error(`❌ MetaAPI ${symbol}: Invalid bid/ask values: bid=${bid}, ask=${ask}`);
      return null;
    }

    const mid = (bid + ask) / 2;
    const spread = ask - bid;

    console.log(`✅ MetaAPI ${symbol}: ${bid}/${ask} (mid: ${mid})`);

    return {
      symbol,
      bid,
      ask,
      mid,
      spread,
      timestamp: data.time || new Date().toISOString()
    };
  } catch (error) {
    console.error(`❌ Failed to fetch price for ${symbol}:`, error);
    return null;
  }
}

async function savePriceToDatabase(supabase: any, priceData: PriceData, isMock: boolean = false): Promise<boolean> {
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
        source: isMock ? 'mock-fallback' : 'metaapi_edge_function'
      });

    if (error) {
      console.error(`DB error for ${priceData.symbol}:`, error.message);
      return false;
    }

    console.log(`✅ [${priceData.symbol}] Saved: ${priceData.bid}/${priceData.ask} (${isMock ? 'MOCK' : 'MetaAPI'})`);
    return true;
  } catch (error) {
    console.error(`Exception saving ${priceData.symbol}:`, error);
    return false;
  }
}

async function pollAllSymbols(supabase: any): Promise<{ successCount: number; errors: string[] }> {
  let successCount = 0;
  const errors: string[] = [];

  const promises = FOREX_PAIRS.map(async (symbol) => {
    const priceData = await fetchPriceFromMetaApi(symbol);

    if (!priceData) {
      const errorMsg = `${symbol}: MetaAPI connection failed - No live data available`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      return;
    }

    const saved = await savePriceToDatabase(supabase, priceData, false);
    if (saved) {
      successCount++;
    } else {
      errors.push(`${symbol}: Failed to save to database`);
    }
  });

  await Promise.allSettled(promises);

  return { successCount, errors };
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
      const marketStatus = getForexMarketStatus();

      if (!marketStatus.isOpen) {
        console.log(`⏸️ Market is CLOSED - Skipping poll (EST: ${marketStatus.currentTime}, Day: ${marketStatus.dayOfWeek}, Hour: ${marketStatus.hour}:${marketStatus.minute})`);

        await supabase
          .from('price_polling_health')
          .insert({
            poll_timestamp: new Date().toISOString(),
            successful_pairs: 0,
            failed_pairs: 0,
            total_duration_ms: 0,
            error_message: `Market closed - Day ${marketStatus.dayOfWeek}, ${marketStatus.hour}:${String(marketStatus.minute).padStart(2, '0')} EST`
          });

        return new Response(
          JSON.stringify({
            success: true,
            message: 'Market is closed - polling skipped',
            marketStatus: marketStatus.status,
            marketOpen: false,
            currentTime: marketStatus.currentTime,
            dayOfWeek: marketStatus.dayOfWeek,
            hour: marketStatus.hour,
            minute: marketStatus.minute,
            nextOpen: marketStatus.dayOfWeek === 6 || (marketStatus.dayOfWeek === 5 && marketStatus.hour >= 17) || (marketStatus.dayOfWeek === 0 && marketStatus.hour < 17)
              ? 'Sunday 5:00 PM EST'
              : 'Market is open',
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

      console.log(`🔄 Market OPEN - Starting price poll for ${FOREX_PAIRS.length} pairs...`);
      const startTime = Date.now();

      const { successCount, errors } = await pollAllSymbols(supabase);

      const duration = Date.now() - startTime;
      const failedCount = FOREX_PAIRS.length - successCount;

      if (successCount === 0) {
        console.error(`❌ CRITICAL: All price feeds failed!`);
        errors.forEach(err => console.error(`   - ${err}`));
      } else if (failedCount > 0) {
        console.warn(`⚠️  Partial failure: ${failedCount} pairs failed`);
        errors.forEach(err => console.warn(`   - ${err}`));
      } else {
        console.log(`✅ Poll complete: ${successCount}/${FOREX_PAIRS.length} pairs updated in ${duration}ms`);
      }

      await supabase
        .from('price_polling_health')
        .insert({
          poll_timestamp: new Date().toISOString(),
          successful_pairs: successCount,
          failed_pairs: failedCount,
          total_duration_ms: duration,
          error_message: errors.length > 0 ? errors.join('; ') : null
        });

      const responseStatus = successCount === 0 ? 503 : 200;

      return new Response(
        JSON.stringify({
          success: successCount > 0,
          message: successCount === 0 ? 'All price feeds failed - No live data available' :
                   failedCount > 0 ? `Partial success: ${successCount}/${FOREX_PAIRS.length} pairs updated` :
                   'Price polling completed successfully',
          marketStatus: marketStatus.status,
          marketOpen: true,
          totalPairs: FOREX_PAIRS.length,
          successfulUpdates: successCount,
          failedUpdates: failedCount,
          durationMs: duration,
          errors: errors.length > 0 ? errors : undefined,
          dataQuality: successCount === FOREX_PAIRS.length ? 'LIVE' :
                       successCount > 0 ? 'DEGRADED' : 'UNAVAILABLE',
          timestamp: new Date().toISOString()
        }),
        {
          status: responseStatus,
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