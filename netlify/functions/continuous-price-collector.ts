import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const metaApiToken = process.env.METAAPI_TOKEN!;
const metaApiAccountId = process.env.METAAPI_ACCOUNT_ID!;
const metaApiRegion = process.env.METAAPI_REGION || 'new-york';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const ACTIVE_SYMBOLS = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'];

interface MetaApiPrice {
  symbol: string;
  bid: number;
  ask: number;
  time: string;
  brokerTime: string;
}

async function fetchPriceFromMetaApi(symbol: string): Promise<MetaApiPrice | null> {
  try {
    const url = `https://mt-client-api-v1.${metaApiRegion}.agiliumtrade.ai/users/current/accounts/${metaApiAccountId}/symbols/${symbol}/current-price`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'auth-token': metaApiToken,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error(`[PriceCollector] MetaAPI error for ${symbol}: ${response.status}`);
      return null;
    }

    const data = await response.json();

    if (!data.bid || !data.ask) {
      console.error(`[PriceCollector] Invalid price data for ${symbol}`);
      return null;
    }

    return {
      symbol,
      bid: parseFloat(data.bid),
      ask: parseFloat(data.ask),
      time: data.time || new Date().toISOString(),
      brokerTime: data.brokerTime || data.time || new Date().toISOString()
    };
  } catch (error) {
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
  console.log(`[PriceCollector:${executionId}] 🚀 Starting continuous price collection...`);
  console.log(`[PriceCollector:${executionId}] Environment check:`, {
    hasMetaApiToken: !!metaApiToken,
    hasMetaApiAccountId: !!metaApiAccountId,
    hasSupabaseUrl: !!supabaseUrl,
    hasSupabaseKey: !!supabaseServiceKey,
    metaApiRegion,
    symbols: ACTIVE_SYMBOLS
  });

  const startTime = Date.now();

  try {
    const results = await Promise.allSettled(
      ACTIVE_SYMBOLS.map(async (symbol) => {
        const priceData = await fetchPriceFromMetaApi(symbol);
        if (priceData) {
          const saved = await savePriceToDatabase(priceData);
          return { symbol, success: saved, price: priceData };
        }
        return { symbol, success: false, price: null };
      })
    );

    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failed = results.length - successful;

    const duration = Date.now() - startTime;
    console.log(`[PriceCollector:${executionId}] ✅ Completed in ${duration}ms: ${successful} prices saved, ${failed} failed`);

    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value.success && result.value.price) {
        const { symbol, price } = result.value;
        console.log(`[PriceCollector:${executionId}]   ✓ ${symbol}: ${price.bid}/${price.ask} (spread: ${(price.ask - price.bid).toFixed(5)})`);
      } else if (result.status === 'fulfilled' && !result.value.success) {
        console.error(`[PriceCollector:${executionId}]   ✗ ${result.value.symbol}: Failed to collect/save`);
      } else if (result.status === 'rejected') {
        console.error(`[PriceCollector:${executionId}]   ✗ Promise rejected:`, result.reason);
      }
    });

    if (failed > 0) {
      console.warn(`[PriceCollector:${executionId}] ⚠️ ${failed} symbols failed - may need attention`);
    }

    console.log(`[PriceCollector:${executionId}] 🎯 Summary: ${successful}/${ACTIVE_SYMBOLS.length} symbols successful`);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        executionId,
        pricesCollected: successful,
        pricesFailed: failed,
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
