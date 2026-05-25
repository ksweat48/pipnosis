/**
 * VWAP Kiss Scanner - SSOT for VWAP Proximity Detection
 *
 * Authority: Identifies when price is near VWAP for scalp opportunities
 *
 * Runs every 2 minutes to scan all watchlist pairs for VWAP "kiss" signals.
 * VWAP acts as a magnetic price level - when price approaches VWAP,
 * quick scalp opportunities often appear.
 *
 * Architecture:
 * 1. Fetch recent 15-minute candles with volume for each symbol
 * 2. Calculate VWAP (Volume Weighted Average Price)
 * 3. Compare current price to VWAP
 * 4. Generate signals for pairs within 0.5% of VWAP
 * 5. Insert into vwap_kiss_signals with 10-minute expiration
 *
 * Signal Strength:
 * - HOT: Within 0.1% of VWAP (100 points)
 * - GOOD: Within 0.3% of VWAP (75 points)
 * - WATCH: Within 0.5% of VWAP (50 points)
 */

import type { Handler } from '@netlify/functions';
import { getSupabaseAdmin } from './_shared/supabase-admin';

const supabase = getSupabaseAdmin();

// Watchlist symbols to scan
// SSOT: Must match the official 9-pair watchlist from src/config/watchlist.ts
const WATCHLIST = [
  'XAUUSD', 'US30', 'NAS100',
  'EURUSD', 'GBPUSD', 'USDJPY',
];

interface Candle {
  symbol: string;
  open_time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface VWAPSignal {
  symbol: string;
  current_price: number;
  vwap_price: number;
  distance_percent: number;
  signal_strength: 'hot' | 'good' | 'watch';
  direction_bias: 'bullish' | 'bearish' | 'neutral';
  scalp_opportunity_score: number;
  entry_suggestion: number;
  exit_suggestion: number;
  reasoning: string;
}

async function fetchRecentCandles(symbol: string): Promise<Candle[]> {
  // Fetch last 50 x 15-minute candles (approximately 12.5 hours of data)
  // SSOT: Database stores timeframes in MetaTrader format (M15, M5, H1, etc.)
  const { data, error } = await supabase
    .from('forex_candles_best')
    .select('symbol, open_time, open, high, low, close, volume')
    .eq('symbol', symbol)
    .eq('timeframe', 'M15')
    .order('open_time', { ascending: false })
    .limit(50);

  if (error) {
    console.error(`[VWAPKiss] Error fetching candles for ${symbol}:`, error);
    return [];
  }

  return (data || []) as Candle[];
}

function calculateVWAP(candles: Candle[]): number {
  if (candles.length === 0) return 0;

  let sumPriceVolume = 0;
  let sumVolume = 0;

  for (const candle of candles) {
    // Typical price = (high + low + close) / 3
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    const volume = candle.volume || 1; // Fallback to 1 if volume is 0

    sumPriceVolume += typicalPrice * volume;
    sumVolume += volume;
  }

  return sumVolume > 0 ? sumPriceVolume / sumVolume : 0;
}

async function getCurrentPrice(symbol: string): Promise<number> {
  // Get most recent price from realtime_prices
  const { data, error } = await supabase
    .from('realtime_prices')
    .select('bid, ask')
    .eq('symbol', symbol)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    console.error(`[VWAPKiss] Error fetching price for ${symbol}:`, error);
    return 0;
  }

  // Use mid price
  return (data.bid + data.ask) / 2;
}

function analyzeVWAPSignal(
  symbol: string,
  currentPrice: number,
  vwapPrice: number
): VWAPSignal | null {
  if (currentPrice === 0 || vwapPrice === 0) return null;

  // Calculate distance from VWAP as percentage
  const distancePercent = Math.abs((currentPrice - vwapPrice) / vwapPrice) * 100;

  // Only generate signals if within 0.5% of VWAP
  if (distancePercent > 0.5) return null;

  // Determine signal strength
  let signalStrength: 'hot' | 'good' | 'watch';
  let scalpScore: number;

  if (distancePercent <= 0.1) {
    signalStrength = 'hot';
    scalpScore = 100 - (distancePercent * 100); // 90-100 range
  } else if (distancePercent <= 0.3) {
    signalStrength = 'good';
    scalpScore = 75 - (distancePercent * 50); // 60-75 range
  } else {
    signalStrength = 'watch';
    scalpScore = 50 - (distancePercent * 25); // 35-50 range
  }

  // Determine direction bias
  let directionBias: 'bullish' | 'bearish' | 'neutral';
  let entrySuggestion: number;
  let exitSuggestion: number;
  let reasoning: string;

  if (currentPrice < vwapPrice) {
    // Price below VWAP - bullish bias (buy the dip)
    directionBias = 'bullish';
    entrySuggestion = currentPrice;
    exitSuggestion = vwapPrice + (vwapPrice * 0.001); // VWAP + 0.1%
    reasoning = `Price ${distancePercent.toFixed(2)}% below VWAP. Consider buying near VWAP for mean reversion scalp targeting VWAP + 10 pips.`;
  } else if (currentPrice > vwapPrice) {
    // Price above VWAP - bearish bias (sell the rally)
    directionBias = 'bearish';
    entrySuggestion = currentPrice;
    exitSuggestion = vwapPrice - (vwapPrice * 0.001); // VWAP - 0.1%
    reasoning = `Price ${distancePercent.toFixed(2)}% above VWAP. Consider selling near VWAP for mean reversion scalp targeting VWAP - 10 pips.`;
  } else {
    // At VWAP - neutral
    directionBias = 'neutral';
    entrySuggestion = vwapPrice;
    exitSuggestion = vwapPrice;
    reasoning = `Price exactly at VWAP. Wait for price to move away from VWAP before entering.`;
  }

  return {
    symbol,
    current_price: currentPrice,
    vwap_price: vwapPrice,
    distance_percent: distancePercent,
    signal_strength: signalStrength,
    direction_bias: directionBias,
    scalp_opportunity_score: Math.round(scalpScore),
    entry_suggestion: entrySuggestion,
    exit_suggestion: exitSuggestion,
    reasoning
  };
}

export const handler: Handler = async (event) => {
  console.log('[VWAPKiss] Starting VWAP kiss scan...');

  try {
    const signals: VWAPSignal[] = [];

    // Scan each symbol in watchlist
    for (const symbol of WATCHLIST) {
      // Fetch recent candles
      const candles = await fetchRecentCandles(symbol);
      if (candles.length === 0) {
        console.log(`[VWAPKiss] No candles found for ${symbol}, skipping`);
        continue;
      }

      // Calculate VWAP
      const vwapPrice = calculateVWAP(candles);
      if (vwapPrice === 0) {
        console.log(`[VWAPKiss] Invalid VWAP for ${symbol}, skipping`);
        continue;
      }

      // Get current price
      const currentPrice = await getCurrentPrice(symbol);
      if (currentPrice === 0) {
        console.log(`[VWAPKiss] No current price for ${symbol}, skipping`);
        continue;
      }

      // Analyze for VWAP kiss signal
      const signal = analyzeVWAPSignal(symbol, currentPrice, vwapPrice);
      if (signal) {
        signals.push(signal);
        console.log(`[VWAPKiss] Signal detected: ${symbol} - ${signal.signal_strength} (${signal.scalp_opportunity_score})`);
      }
    }

    console.log(`[VWAPKiss] Found ${signals.length} VWAP kiss signals`);

    // Delete old signals (older than 15 minutes)
    const fifteenMinutesAgo = new Date();
    fifteenMinutesAgo.setMinutes(fifteenMinutesAgo.getMinutes() - 15);

    await supabase
      .from('vwap_kiss_signals')
      .delete()
      .lt('created_at', fifteenMinutesAgo.toISOString());

    // Insert new signals
    if (signals.length > 0) {
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 10); // Expire in 10 minutes

      const signalsToInsert = signals.map(signal => ({
        ...signal,
        expires_at: expiresAt.toISOString()
      }));

      const { error: insertError } = await supabase
        .from('vwap_kiss_signals')
        .insert(signalsToInsert);

      if (insertError) {
        console.error('[VWAPKiss] Error inserting signals:', insertError);
        return {
          statusCode: 500,
          body: JSON.stringify({ error: 'Failed to insert signals' })
        };
      }
    }

    console.log('[VWAPKiss] Successfully completed VWAP kiss scan');

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        signalsFound: signals.length,
        topSignals: signals.slice(0, 3).map(s => ({
          symbol: s.symbol,
          strength: s.signal_strength,
          score: s.scalp_opportunity_score
        }))
      })
    };

  } catch (error) {
    console.error('[VWAPKiss] Fatal error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};
