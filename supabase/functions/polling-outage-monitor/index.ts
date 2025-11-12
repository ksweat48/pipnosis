import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SYMBOLS = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'];
const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];
const OUTAGE_THRESHOLD_MINUTES = 10;
const MAX_BACKFILL_HOURS = 24;

interface OutageDetection {
  symbol: string;
  timeframe: string;
  lastCandleTime: string;
  gapMinutes: number;
  requiresBackfill: boolean;
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
    console.log('🔍 Starting polling outage detection...');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const outages: OutageDetection[] = [];
    const backfillsTriggered: Array<{symbol: string; timeframe: string; status: string}> = [];

    for (const symbol of SYMBOLS) {
      for (const timeframe of TIMEFRAMES) {
        const detection = await detectOutage(supabase, symbol, timeframe);

        if (detection.requiresBackfill) {
          console.log(`⚠️ Outage detected: ${symbol} ${timeframe} - ${detection.gapMinutes} minute gap`);
          outages.push(detection);

          const backfillResult = await triggerBackfill(
            supabaseUrl,
            supabaseKey,
            symbol,
            timeframe,
            detection.gapMinutes
          );

          backfillsTriggered.push(backfillResult);
        }
      }
    }

    await logMonitoringRun(supabase, outages, backfillsTriggered);

    const duration = Date.now() - startTime;
    const summary = {
      success: true,
      timestamp: new Date().toISOString(),
      outagesDetected: outages.length,
      backfillsTriggered: backfillsTriggered.length,
      durationMs: duration,
      outages,
      backfills: backfillsTriggered
    };

    console.log(`✅ Monitoring complete: ${outages.length} outages detected, ${backfillsTriggered.length} backfills triggered`);

    return new Response(
      JSON.stringify(summary, null, 2),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('❌ Monitoring failed:', error);

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

async function detectOutage(
  supabase: any,
  symbol: string,
  timeframe: string
): Promise<OutageDetection> {
  const { data: lastCandles, error } = await supabase
    .from('forex_candles')
    .select('open_time, close_time, data_source')
    .eq('symbol', symbol)
    .eq('timeframe', timeframe)
    .order('open_time', { ascending: false })
    .limit(5);

  if (error) {
    console.error(`Error checking ${symbol} ${timeframe}:`, error);
    return {
      symbol,
      timeframe,
      lastCandleTime: 'unknown',
      gapMinutes: 0,
      requiresBackfill: false
    };
  }

  if (!lastCandles || lastCandles.length === 0) {
    console.log(`⚠️ No candles found for ${symbol} ${timeframe}`);
    return {
      symbol,
      timeframe,
      lastCandleTime: 'none',
      gapMinutes: 0,
      requiresBackfill: false
    };
  }

  const lastCandle = lastCandles[0];
  const lastCandleTime = new Date(lastCandle.close_time);
  const now = new Date();
  const gapMinutes = Math.floor((now.getTime() - lastCandleTime.getTime()) / 60000);

  const timeframeMinutes = getTimeframeMinutes(timeframe);
  const expectedGap = timeframeMinutes;
  const isOutage = gapMinutes > (expectedGap + OUTAGE_THRESHOLD_MINUTES);

  const recentGapFills = lastCandles.filter(c => c.data_source === 'gap_fill').length;
  const hasRecentGapFills = recentGapFills >= 2;

  const requiresBackfill = isOutage || hasRecentGapFills;

  if (requiresBackfill) {
    console.log(`📊 ${symbol} ${timeframe}: gap=${gapMinutes}min, gap_fills=${recentGapFills}/5`);
  }

  return {
    symbol,
    timeframe,
    lastCandleTime: lastCandleTime.toISOString(),
    gapMinutes,
    requiresBackfill
  };
}

async function triggerBackfill(
  supabaseUrl: string,
  supabaseKey: string,
  symbol: string,
  timeframe: string,
  gapMinutes: number
): Promise<{symbol: string; timeframe: string; status: string}> {
  try {
    const hoursToBackfill = Math.min(
      Math.ceil(gapMinutes / 60) + 1,
      MAX_BACKFILL_HOURS
    );

    const backfillUrl = `${supabaseUrl}/functions/v1/backfill-historical-candles?symbol=${symbol}&timeframe=${timeframe}&limit=300`;

    console.log(`🔄 Triggering backfill: ${symbol} ${timeframe} (${hoursToBackfill} hours)`);

    const response = await fetch(backfillUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Backfill failed for ${symbol} ${timeframe}:`, errorText);
      return {
        symbol,
        timeframe,
        status: `failed: ${errorText.substring(0, 100)}`
      };
    }

    const result = await response.json();

    return {
      symbol,
      timeframe,
      status: `triggered: ${result.totalCandlesSaved || 0} candles`
    };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Error triggering backfill for ${symbol} ${timeframe}:`, errorMsg);
    return {
      symbol,
      timeframe,
      status: `error: ${errorMsg}`
    };
  }
}

async function logMonitoringRun(
  supabase: any,
  outages: OutageDetection[],
  backfills: Array<{symbol: string; timeframe: string; status: string}>
) {
  try {
    const { error } = await supabase
      .from('polling_outage_log')
      .insert({
        run_time: new Date().toISOString(),
        outages_detected: outages.length,
        backfills_triggered: backfills.length,
        outage_details: outages,
        backfill_results: backfills
      });

    if (error) {
      console.error('Failed to log monitoring run:', error);
    }
  } catch (error) {
    console.error('Error logging monitoring run:', error);
  }
}

function getTimeframeMinutes(timeframe: string): number {
  const map: Record<string, number> = {
    'M1': 1,
    'M5': 5,
    'M15': 15,
    'M30': 30,
    'H1': 60,
    'H4': 240,
    'D1': 1440,
    'W1': 10080
  };
  return map[timeframe] || 15;
}
