/**
 * Emergency Price Trigger
 *
 * Manually callable endpoint to diagnose and fix price data issues.
 * Unlike the scheduled function, this is designed to be called via HTTP.
 */

import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { fetchKrakenTicker } from './_shared/kraken-client';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const metaApiToken = process.env.METAAPI_TOKEN!;
const metaApiRegion = process.env.METAAPI_REGION || 'london';
const metaApiAccountId = process.env.METAAPI_ACCOUNT_ID || '';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const FOREX_SYMBOLS = ['USDJPY', 'EURUSD', 'GBPUSD', 'XAUUSD', 'US30'];
const CRYPTO_SYMBOLS = ['BTCUSD', 'ETHUSD'];

interface DiagnosticResult {
  symbol: string;
  success: boolean;
  source?: string;
  bid?: number;
  ask?: number;
  error?: string;
}

async function fetchMetaAPIPrice(symbol: string): Promise<DiagnosticResult> {
  try {
    const url = `https://mt-client-api-v1.${metaApiRegion}.agiliumtrade.ai/users/current/accounts/${metaApiAccountId}/symbols/${symbol}/current-price`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'auth-token': metaApiToken,
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      return {
        symbol,
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`
      };
    }

    const data = await response.json();

    if (!data.bid || !data.ask) {
      return {
        symbol,
        success: false,
        error: 'No bid/ask in response'
      };
    }

    // Save to database
    const { error: dbError } = await supabase
      .from('realtime_prices')
      .insert({
        symbol,
        bid: parseFloat(data.bid),
        ask: parseFloat(data.ask),
        mid: (parseFloat(data.bid) + parseFloat(data.ask)) / 2,
        spread: parseFloat(data.ask) - parseFloat(data.bid),
        broker_time: data.brokerTime || new Date().toISOString(),
        source: 'emergency_metaapi',
        created_at: new Date().toISOString()
      });

    if (dbError) {
      return {
        symbol,
        success: false,
        source: 'metaapi',
        bid: parseFloat(data.bid),
        ask: parseFloat(data.ask),
        error: `DB Error: ${dbError.message}`
      };
    }

    return {
      symbol,
      success: true,
      source: 'metaapi',
      bid: parseFloat(data.bid),
      ask: parseFloat(data.ask)
    };
  } catch (error) {
    return {
      symbol,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

async function fetchKrakenPrice(symbol: string): Promise<DiagnosticResult> {
  try {
    const priceData = await fetchKrakenTicker(symbol);

    // Save to database
    const { error: dbError } = await supabase
      .from('realtime_prices')
      .insert({
        symbol,
        bid: priceData.bid,
        ask: priceData.ask,
        mid: (priceData.bid + priceData.ask) / 2,
        spread: priceData.ask - priceData.bid,
        broker_time: new Date().toISOString(),
        source: 'emergency_kraken',
        created_at: new Date().toISOString()
      });

    if (dbError) {
      return {
        symbol,
        success: false,
        source: 'kraken',
        bid: priceData.bid,
        ask: priceData.ask,
        error: `DB Error: ${dbError.message}`
      };
    }

    return {
      symbol,
      success: true,
      source: 'kraken',
      bid: priceData.bid,
      ask: priceData.ask
    };
  } catch (error) {
    return {
      symbol,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

export const handler: Handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  const startTime = Date.now();
  console.log('[EmergencyPriceTrigger] Starting emergency price collection...');

  try {
    // Step 1: Check current database state
    const { data: existingPrices, error: checkError } = await supabase
      .from('realtime_prices')
      .select('symbol, broker_time, created_at, source')
      .order('broker_time', { ascending: false })
      .limit(20);

    const databaseStatus = {
      hasData: (existingPrices?.length || 0) > 0,
      recordCount: existingPrices?.length || 0,
      latestPrices: existingPrices?.slice(0, 5).map(p => ({
        symbol: p.symbol,
        age: Math.round((Date.now() - new Date(p.broker_time || p.created_at).getTime()) / 1000),
        source: p.source
      })) || []
    };

    console.log('[EmergencyPriceTrigger] Database status:', databaseStatus);

    // Step 2: Fetch fresh prices for all symbols
    const results: DiagnosticResult[] = [];

    // Fetch crypto prices (always available)
    for (const symbol of CRYPTO_SYMBOLS) {
      const result = await fetchKrakenPrice(symbol);
      results.push(result);
    }

    // Fetch forex prices
    for (const symbol of FOREX_SYMBOLS) {
      const result = await fetchMetaAPIPrice(symbol);
      results.push(result);
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    const duration = Date.now() - startTime;

    console.log(`[EmergencyPriceTrigger] Completed: ${successCount} success, ${failureCount} failed in ${duration}ms`);

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        databaseStatus,
        results,
        summary: {
          successCount,
          failureCount,
          totalSymbols: results.length,
          durationMs: duration
        },
        timestamp: new Date().toISOString()
      })
    };
  } catch (error) {
    console.error('[EmergencyPriceTrigger] Fatal error:', error);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      })
    };
  }
};
