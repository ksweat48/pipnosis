import { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const WATCHLIST_SYMBOLS = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'GBPJPY',
  'AUDUSD', 'US30', 'BTCUSD', 'ETHUSD'
];

const OMEGA_BRAINS = [
  'trend', 'scalper', 'confirmation', 'reversal',
  'volatility', 'risk', 'orderflow'
];

interface CacheWarmResult {
  symbol: string;
  brainsWarmed: number;
  errors: string[];
}

export const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  console.log('[CacheWarming] Starting cache warming function...');
  const startTime = Date.now();

  try {
    console.log('[CacheWarming] Cleaning up expired cache entries...');
    const { data: cleanupResult, error: cleanupError } = await supabase
      .rpc('cleanup_expired_cache');

    if (cleanupError) {
      console.warn('[CacheWarming] Cleanup warning:', cleanupError.message);
    } else {
      console.log('[CacheWarming] Cleanup complete:', cleanupResult);
    }

    console.log('[CacheWarming] Warming scout state for all symbols...');
    const scoutResults = await warmScoutState();

    console.log('[CacheWarming] Warming omega intelligence for all symbols...');
    const omegaResults = await warmOmegaIntelligence();

    const totalDuration = Date.now() - startTime;
    const successCount = omegaResults.filter(r => r.errors.length === 0).length;
    const totalBrainsWarmed = omegaResults.reduce((sum, r) => sum + r.brainsWarmed, 0);

    console.log(`[CacheWarming] Complete: ${successCount}/${WATCHLIST_SYMBOLS.length} symbols, ${totalBrainsWarmed} brains warmed in ${totalDuration}ms`);

    const response = {
      success: true,
      duration_ms: totalDuration,
      symbols_processed: WATCHLIST_SYMBOLS.length,
      symbols_success: successCount,
      total_brains_warmed: totalBrainsWarmed,
      scout_results: scoutResults,
      omega_results: omegaResults,
      cleanup: cleanupResult || null
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response)
    };
  } catch (error) {
    console.error('[CacheWarming] Fatal error:', error);

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration_ms: Date.now() - startTime
      })
    };
  }
};

async function warmScoutState(): Promise<{ symbol: string; success: boolean }[]> {
  const results: { symbol: string; success: boolean }[] = [];

  for (const symbol of WATCHLIST_SYMBOLS) {
    try {
      const candles = await fetchRecentCandles(symbol, 'M15', 100);
      if (!candles || candles.length < 50) {
        results.push({ symbol, success: false });
        continue;
      }

      const { price, atr, rsi, emaFast, emaSlow } = calculateIndicators(candles);
      const volatilityState = calculateVolatilityBucket(atr, price);
      const trendState = calculateTrendBucket(price, emaFast, emaSlow);
      const marketStateHash = generateSimpleHash(`${symbol}|M15|${Math.floor(price / (0.25 * atr))}|${Math.floor(rsi / 10)}|${trendState}|${volatilityState}`);

      const expiresAt = new Date(Date.now() + 60 * 1000);

      await supabase.from('scout_market_state').upsert({
        symbol,
        timeframe: 'M15',
        improvement_score: 0,
        should_reconvene: false,
        key_changes: [],
        market_summary: `${symbol}: ${trendState} trend, ${volatilityState} volatility, RSI ${rsi.toFixed(0)}`,
        snapshot_hash: marketStateHash,
        price_at_scan: price,
        volatility_state: volatilityState,
        trend_state: trendState,
        expires_at: expiresAt.toISOString()
      }, {
        onConflict: 'symbol,timeframe'
      });

      results.push({ symbol, success: true });
    } catch (error) {
      console.error(`[CacheWarming] Scout error for ${symbol}:`, error);
      results.push({ symbol, success: false });
    }
  }

  return results;
}

async function warmOmegaIntelligence(): Promise<CacheWarmResult[]> {
  const results: CacheWarmResult[] = [];

  for (const symbol of WATCHLIST_SYMBOLS) {
    const result: CacheWarmResult = { symbol, brainsWarmed: 0, errors: [] };

    try {
      const candles = await fetchRecentCandles(symbol, 'M15', 100);
      if (!candles || candles.length < 50) {
        result.errors.push('Insufficient candle data');
        results.push(result);
        continue;
      }

      const { price, atr, rsi, emaFast, emaSlow } = calculateIndicators(candles);
      const volatilityState = calculateVolatilityBucket(atr, price);
      const trendState = calculateTrendBucket(price, emaFast, emaSlow);
      const priceBucket = Math.floor(price / (0.25 * atr));
      const rsiBucket = Math.floor(rsi / 10);
      const marketStateHash = generateSimpleHash(`${symbol}|M15|${priceBucket}|${rsiBucket}|${trendState}|${volatilityState}`);

      const ttl = 15 * 60 * 1000;
      const expiresAt = new Date(Date.now() + ttl);

      for (const brain of OMEGA_BRAINS) {
        try {
          const { data: existing } = await supabase
            .rpc('get_omega_intelligence', {
              p_symbol: symbol,
              p_timeframe: 'M15',
              p_brain_name: brain,
              p_market_state_hash: marketStateHash
            });

          if (existing && existing.length > 0) {
            result.brainsWarmed++;
            continue;
          }

          const vote = generatePlaceholderVote(brain, trendState, rsi, volatilityState);

          await supabase.from('omega_market_intelligence').upsert({
            symbol,
            timeframe: 'M15',
            brain_name: brain,
            atr_price_bucket: priceBucket,
            market_state_hash: marketStateHash,
            vote: vote.vote,
            confidence: vote.confidence,
            reasoning: vote.reasoning,
            key_factors: vote.keyFactors,
            expires_at: expiresAt.toISOString()
          }, {
            onConflict: 'symbol,timeframe,brain_name,market_state_hash'
          });

          result.brainsWarmed++;
        } catch (brainError) {
          result.errors.push(`${brain}: ${brainError instanceof Error ? brainError.message : 'Unknown'}`);
        }
      }
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'Unknown error');
    }

    results.push(result);
  }

  return results;
}

async function fetchRecentCandles(symbol: string, timeframe: string, limit: number): Promise<any[]> {
  const { data, error } = await supabase
    .from('candles')
    .select('*')
    .eq('symbol', symbol)
    .eq('timeframe', timeframe)
    .order('time', { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`[CacheWarming] Failed to fetch candles for ${symbol}:`, error);
    return [];
  }

  return (data || []).reverse();
}

function calculateIndicators(candles: any[]): {
  price: number;
  atr: number;
  rsi: number;
  emaFast: number;
  emaSlow: number;
} {
  const price = candles[candles.length - 1].close;

  let atrSum = 0;
  for (let i = candles.length - 14; i < candles.length; i++) {
    if (i < 1) continue;
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    atrSum += tr;
  }
  const atr = atrSum / 14;

  let gains = 0;
  let losses = 0;
  for (let i = candles.length - 14; i < candles.length; i++) {
    if (i < 1) continue;
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) gains += change;
    else losses -= change;
  }
  const avgGain = gains / 14;
  const avgLoss = losses / 14;
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));

  const emaFast = calculateEMA(candles, 8);
  const emaSlow = calculateEMA(candles, 21);

  return { price, atr, rsi, emaFast, emaSlow };
}

function calculateEMA(candles: any[], period: number): number {
  if (candles.length < period) return candles[candles.length - 1]?.close || 0;
  const multiplier = 2 / (period + 1);
  let ema = candles[candles.length - period].close;
  for (let i = candles.length - period + 1; i < candles.length; i++) {
    ema = (candles[i].close - ema) * multiplier + ema;
  }
  return ema;
}

function calculateVolatilityBucket(atr: number, price: number): string {
  const atrPercent = (atr / price) * 100;
  if (atrPercent < 0.3) return 'low';
  if (atrPercent < 0.8) return 'medium';
  if (atrPercent < 1.5) return 'high';
  return 'extreme';
}

function calculateTrendBucket(price: number, emaFast: number, emaSlow: number): string {
  const fastAboveSlow = emaFast > emaSlow;
  const priceAboveFast = price > emaFast;
  const priceAboveSlow = price > emaSlow;
  const fastSlowDiff = Math.abs(emaFast - emaSlow) / emaSlow * 100;
  const isStrong = fastSlowDiff > 0.3;

  if (fastAboveSlow && priceAboveFast && priceAboveSlow) {
    return isStrong ? 'strong_bull' : 'bull';
  }
  if (!fastAboveSlow && !priceAboveFast && !priceAboveSlow) {
    return isStrong ? 'strong_bear' : 'bear';
  }
  return 'sideways';
}

function generateSimpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

function generatePlaceholderVote(
  brain: string,
  trendState: string,
  rsi: number,
  volatilityState: string
): { vote: string; confidence: number; reasoning: string; keyFactors: string[] } {
  const isBullish = trendState.includes('bull');
  const isBearish = trendState.includes('bear');
  const isOverbought = rsi > 70;
  const isOversold = rsi < 30;

  let vote = 'NO_TRADE';
  let confidence = 50;
  let reasoning = 'Neutral market conditions';
  const keyFactors: string[] = [];

  switch (brain) {
    case 'trend':
      if (isBullish && !isOverbought) {
        vote = 'BUY';
        confidence = trendState === 'strong_bull' ? 75 : 65;
        reasoning = `Trend aligned bullish, RSI ${rsi.toFixed(0)}`;
        keyFactors.push('EMA alignment bullish', `RSI ${rsi.toFixed(0)}`);
      } else if (isBearish && !isOversold) {
        vote = 'SELL';
        confidence = trendState === 'strong_bear' ? 75 : 65;
        reasoning = `Trend aligned bearish, RSI ${rsi.toFixed(0)}`;
        keyFactors.push('EMA alignment bearish', `RSI ${rsi.toFixed(0)}`);
      } else {
        reasoning = 'Trend unclear or RSI extreme';
        keyFactors.push('Mixed signals');
      }
      break;

    case 'reversal':
      if (isOverbought && isBearish) {
        vote = 'SELL';
        confidence = 60;
        reasoning = 'Overbought with bearish divergence potential';
        keyFactors.push(`RSI overbought ${rsi.toFixed(0)}`, 'Reversal setup');
      } else if (isOversold && isBullish) {
        vote = 'BUY';
        confidence = 60;
        reasoning = 'Oversold with bullish divergence potential';
        keyFactors.push(`RSI oversold ${rsi.toFixed(0)}`, 'Reversal setup');
      } else {
        reasoning = 'No clear reversal signal';
        keyFactors.push('No extreme RSI');
      }
      break;

    case 'volatility':
      if (volatilityState === 'extreme' || volatilityState === 'high') {
        vote = 'WAIT';
        confidence = 70;
        reasoning = `High volatility (${volatilityState}) - caution advised`;
        keyFactors.push(`Volatility: ${volatilityState}`, 'Wide stops needed');
      } else {
        vote = 'NEUTRAL';
        confidence = 55;
        reasoning = `Volatility acceptable (${volatilityState})`;
        keyFactors.push(`Volatility: ${volatilityState}`);
      }
      break;

    case 'risk':
      if (volatilityState === 'extreme') {
        vote = 'NO_TRADE';
        confidence = 80;
        reasoning = 'Risk too high in extreme volatility';
        keyFactors.push('Extreme volatility', 'Risk management');
      } else {
        vote = 'NEUTRAL';
        confidence = 60;
        reasoning = 'Risk within acceptable parameters';
        keyFactors.push(`Volatility: ${volatilityState}`);
      }
      break;

    default:
      if (isBullish) {
        vote = 'BUY';
        confidence = 55;
        reasoning = `General bullish bias from ${brain}`;
        keyFactors.push('Bullish structure');
      } else if (isBearish) {
        vote = 'SELL';
        confidence = 55;
        reasoning = `General bearish bias from ${brain}`;
        keyFactors.push('Bearish structure');
      }
  }

  return { vote, confidence, reasoning, keyFactors };
}
