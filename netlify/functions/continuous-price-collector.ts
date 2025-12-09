import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const metaApiToken = process.env.METAAPI_TOKEN!;
const metaApiRegion = process.env.METAAPI_REGION || 'london';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const PRIMARY_ACCOUNT = process.env.METAAPI_ACCOUNT_ID || '';

function getWorkingMetaApiAccount(): string {
  return PRIMARY_ACCOUNT;
}

function markAccountFailed(accountId: string, error?: any): void {
  console.warn(`[MetaAPI] Account ${accountId.slice(0, 8)}... failed:`, error?.message || error);
}

function markAccountSuccess(accountId: string): void {
  // No-op for now
}

const ACTIVE_SYMBOLS = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'];

// OPTIMIZATION: Collect multiple ticks within the 1-minute window
// This dramatically improves wick quality by getting 8 ticks instead of 1
const TICKS_PER_MINUTE = 8;
const TICK_INTERVAL_MS = 3000; // 3 seconds between ticks
const MAX_EXECUTION_TIME_MS = 24000; // 24 seconds max (within 26s timeout)

interface MetaApiPrice {
  symbol: string;
  bid: number;
  ask: number;
  time: string;
  brokerTime: string;
}

async function fetchPriceFromMetaApi(symbol: string, accountId: string): Promise<MetaApiPrice | null> {
  try {
    const url = `https://mt-client-api-v1.${metaApiRegion}.agiliumtrade.ai/users/current/accounts/${accountId}/symbols/${symbol}/current-price`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'auth-token': metaApiToken,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const error = new Error(`MetaAPI HTTP ${response.status}`);
      (error as any).response = { status: response.status };
      markAccountFailed(accountId, error);
      console.error(`[PriceCollector] MetaAPI error for ${symbol}: ${response.status}`);
      return null;
    }

    const data = await response.json();

    if (!data.bid || !data.ask) {
      console.error(`[PriceCollector] Invalid price data for ${symbol}`);
      return null;
    }

    // Mark success
    markAccountSuccess(accountId);

    return {
      symbol,
      bid: parseFloat(data.bid),
      ask: parseFloat(data.ask),
      time: data.time || new Date().toISOString(),
      brokerTime: data.brokerTime || data.time || new Date().toISOString()
    };
  } catch (error) {
    markAccountFailed(accountId, error);
    console.error(`[PriceCollector] Error fetching ${symbol}:`, error);
    return null;
  }
}

async function savePriceToDatabase(priceData: MetaApiPrice): Promise<boolean> {
  try {
    const mid = (priceData.bid + priceData.ask) / 2;
    const spread = priceData.ask - priceData.bid;

    const { error } = await supabase
      .from('realtime_prices')
      .insert({
        symbol: priceData.symbol,
        bid: priceData.bid,
        ask: priceData.ask,
        mid: mid,
        spread: spread,
        broker_time: priceData.brokerTime,
        source: 'netlify_continuous_collector',
        created_at: new Date().toISOString()
      });

    if (error) {
      console.error(`[PriceCollector] Database error for ${priceData.symbol}:`, error.message);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`[PriceCollector] Unexpected error saving ${priceData.symbol}:`, error);
    return false;
  }
}

export const handler: Handler = async (event, context) => {
  const executionId = `exec_${Date.now()}`;
  const metaApiAccountId = getWorkingMetaApiAccount();

  console.log(`[PriceCollector:${executionId}] 🚀 Starting continuous price collection...`);
  console.log(`[PriceCollector:${executionId}] Using MetaAPI Account: ${metaApiAccountId.slice(0, 8)}...`);
  console.log(`[PriceCollector:${executionId}] Environment check:`, {
    hasMetaApiToken: !!metaApiToken,
    accountId: metaApiAccountId.slice(0, 8) + '...',
    hasSupabaseUrl: !!supabaseUrl,
    hasSupabaseKey: !!supabaseServiceKey,
    metaApiRegion,
    symbols: ACTIVE_SYMBOLS
  });

  const startTime = Date.now();
  let totalTicksCollected = 0;
  let totalTicksFailed = 0;

  try {
    // BREAKTHROUGH: Collect multiple ticks per minute instead of just 1
    // This gives us 8x more data points for realistic wicks
    console.log(`[PriceCollector:${executionId}] 📊 Collecting ${TICKS_PER_MINUTE} ticks over ${MAX_EXECUTION_TIME_MS / 1000}s...`);

    for (let tickNum = 0; tickNum < TICKS_PER_MINUTE; tickNum++) {
      const tickStartTime = Date.now();

      // Check if we're running out of time
      if (tickStartTime - startTime > MAX_EXECUTION_TIME_MS) {
        console.warn(`[PriceCollector:${executionId}] ⏱️ Approaching timeout, stopping at tick ${tickNum}`);
        break;
      }

      // Collect all symbols in parallel for this tick
      const results = await Promise.allSettled(
        ACTIVE_SYMBOLS.map(async (symbol) => {
          const priceData = await fetchPriceFromMetaApi(symbol, metaApiAccountId);
          if (priceData) {
            const saved = await savePriceToDatabase(priceData);
            return { symbol, success: saved, price: priceData };
          }
          return { symbol, success: false, price: null };
        })
      );

      const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
      const failed = results.length - successful;

      totalTicksCollected += successful;
      totalTicksFailed += failed;

      const tickDuration = Date.now() - tickStartTime;
      console.log(`[PriceCollector:${executionId}] Tick ${tickNum + 1}/${TICKS_PER_MINUTE}: ${successful} prices saved in ${tickDuration}ms`);

      // Wait before next tick (unless it's the last one)
      if (tickNum < TICKS_PER_MINUTE - 1) {
        const remainingTime = TICK_INTERVAL_MS - tickDuration;
        if (remainingTime > 0) {
          await new Promise(resolve => setTimeout(resolve, remainingTime));
        }
      }
    }

    const duration = Date.now() - startTime;
    const avgTicksPerSymbol = totalTicksCollected / ACTIVE_SYMBOLS.length;

    console.log(`[PriceCollector:${executionId}] ✅ Completed in ${duration}ms: ${totalTicksCollected} total ticks saved, ${totalTicksFailed} failed`);
    console.log(`[PriceCollector:${executionId}] 🎯 Summary: ${totalTicksCollected} total ticks (avg ${avgTicksPerSymbol.toFixed(1)} per symbol)`);
    console.log(`[PriceCollector:${executionId}] 📈 Improvement: ${avgTicksPerSymbol}x more ticks than before (was 1 per symbol)`);

    if (totalTicksFailed > 0) {
      console.warn(`[PriceCollector:${executionId}] ⚠️ ${totalTicksFailed} ticks failed - may need attention`);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        executionId,
        totalTicksCollected,
        totalTicksFailed,
        avgTicksPerSymbol: totalTicksCollected / ACTIVE_SYMBOLS.length,
        durationMs: duration,
        timestamp: new Date().toISOString(),
        symbols: ACTIVE_SYMBOLS
      })
    };
  } catch (error) {
    console.error(`[PriceCollector:${executionId}] ❌ Unexpected error:`, error);
    console.error(`[PriceCollector:${executionId}] Error stack:`, error instanceof Error ? error.stack : 'No stack trace');
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        executionId,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      })
    };
  }
};
