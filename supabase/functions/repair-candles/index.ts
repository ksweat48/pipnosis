import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SYMBOLS = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'];
const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

interface RepairResult {
  symbol: string;
  timeframe: string;
  candlesChecked: number;
  candlesRepaired: number;
  issues: string[];
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
    console.log('🔧 Starting candle repair service...');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    const specificSymbol = url.searchParams.get('symbol');
    const specificTimeframe = url.searchParams.get('timeframe');
    const hoursBack = parseInt(url.searchParams.get('hours') || '24', 10);

    const symbolsToCheck = specificSymbol ? [specificSymbol] : SYMBOLS;
    const timeframesToCheck = specificTimeframe ? [specificTimeframe] : TIMEFRAMES;

    const results: RepairResult[] = [];
    let totalChecked = 0;
    let totalRepaired = 0;

    for (const symbol of symbolsToCheck) {
      for (const timeframe of timeframesToCheck) {
        const result = await repairCandlesForSymbol(
          supabase,
          symbol,
          timeframe,
          hoursBack
        );

        results.push(result);
        totalChecked += result.candlesChecked;
        totalRepaired += result.candlesRepaired;
      }
    }

    const duration = Date.now() - startTime;
    const summary = {
      success: true,
      timestamp: new Date().toISOString(),
      totalCandlesChecked: totalChecked,
      totalCandlesRepaired: totalRepaired,
      durationMs: duration,
      results
    };

    console.log(`✅ Repair complete: ${totalChecked} checked, ${totalRepaired} repaired`);

    return new Response(
      JSON.stringify(summary, null, 2),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('❌ Repair failed:', error);

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

async function repairCandlesForSymbol(
  supabase: any,
  symbol: string,
  timeframe: string,
  hoursBack: number
): Promise<RepairResult> {
  const result: RepairResult = {
    symbol,
    timeframe,
    candlesChecked: 0,
    candlesRepaired: 0,
    issues: []
  };

  try {
    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - hoursBack);

    const { data: candles, error } = await supabase
      .from('forex_candles')
      .select('id, symbol, timeframe, open_time, open, high, low, close, tick_count, data_source')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .gte('open_time', cutoffTime.toISOString())
      .order('open_time', { ascending: true });

    if (error) {
      result.issues.push(`Query failed: ${error.message}`);
      return result;
    }

    result.candlesChecked = candles?.length || 0;

    if (!candles || candles.length === 0) {
      return result;
    }

    for (const candle of candles) {
      const issues = identifyCandleIssues(candle);

      if (issues.length > 0) {
        const repaired = await repairCandle(supabase, candle, issues);

        if (repaired) {
          result.candlesRepaired++;
        } else {
          result.issues.push(`Failed to repair candle at ${candle.open_time}`);
        }
      }
    }

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    result.issues.push(errorMsg);
  }

  return result;
}

function identifyCandleIssues(candle: any): string[] {
  const issues: string[] = [];

  if (candle.open === candle.high && candle.high === candle.low && candle.low === candle.close) {
    issues.push('flat_candle');
  }

  if (candle.high < Math.max(candle.open, candle.close)) {
    issues.push('invalid_high');
  }

  if (candle.low > Math.min(candle.open, candle.close)) {
    issues.push('invalid_low');
  }

  if (candle.close <= 0 || candle.open <= 0) {
    issues.push('zero_price');
  }

  return issues;
}

async function repairCandle(supabase: any, candle: any, issues: string[]): Promise<boolean> {
  try {
    let repaired = { ...candle };

    for (const issue of issues) {
      switch (issue) {
        case 'flat_candle':
          repaired = addMicroVariation(repaired);
          break;
        case 'invalid_high':
          repaired.high = Math.max(repaired.open, repaired.close, repaired.high);
          break;
        case 'invalid_low':
          repaired.low = Math.min(repaired.open, repaired.close, repaired.low);
          break;
        case 'zero_price':
          console.error(`Cannot repair zero price for candle ${candle.id}`);
          return false;
      }
    }

    const { error } = await supabase
      .from('forex_candles')
      .update({
        open: repaired.open,
        high: repaired.high,
        low: repaired.low,
        close: repaired.close,
        needs_repair: false,
        completion_score: Math.min(repaired.completion_score || 50, 70)
      })
      .eq('id', candle.id);

    if (error) {
      console.error(`Failed to update candle ${candle.id}:`, error);
      return false;
    }

    console.log(`✅ Repaired candle ${candle.symbol} ${candle.timeframe} at ${candle.open_time}`);
    return true;

  } catch (error) {
    console.error(`Error repairing candle ${candle.id}:`, error);
    return false;
  }
}

function addMicroVariation(candle: any): any {
  const basePrice = candle.close;
  const pipSize = candle.symbol.includes('JPY') ? 0.01 : 0.0001;
  const variation = pipSize * 0.5;

  return {
    ...candle,
    open: basePrice,
    high: basePrice + variation,
    low: basePrice - variation,
    close: basePrice + (Math.random() - 0.5) * variation * 0.5
  };
}
