import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { WATCHLIST } from '@/config/watchlist';
import { analyzeVWAP } from '@/lib/technical-math/vwap';
import { calculateATR } from '@/lib/technical-math/atr';

// SSOT: VWAP calculation parameters - must match MarketChart.tsx M5 lookback
// MarketChart uses 150 candles for M5 timeframe (12.5 hours of data)
// This ensures VWAP Kiss Monitor displays identical VWAP values as chart visual
const VWAP_LOOKBACK_CANDLES = 150;
const VWAP_MIN_CANDLES = 100; // Minimum candles required for valid VWAP calculation
const VWAP_CACHE_TTL_MS = 60000; // 1 minute cache to reduce DB load during scan cycles

interface VWAPSignal {
  symbol: string;
  currentPrice: number;
  vwapPrice: number;
  distancePercent: number;
  signalStrength: 'hot' | 'good' | 'watch';
  directionBias: 'bullish' | 'bearish' | 'neutral';
  scalpOpportunityScore: number;
  entrySuggestion: number;
  exitSuggestion: number;
  reasoning: string;
}

interface VWAPCache {
  value: number;
  timestamp: number;
}

class VWAPKissDetectorService {
  private vwapCache: Map<string, VWAPCache> = new Map();

  private async calculateVWAP(symbol: string): Promise<number | null> {
    try {
      // Check cache first (Governance: reduce DB load)
      const cached = this.vwapCache.get(symbol);
      if (cached && Date.now() - cached.timestamp < VWAP_CACHE_TTL_MS) {
        return cached.value;
      }

      // SSOT: Use same lookback as MarketChart M5 calculation (150 candles)
      const { data: candles } = await supabase
        .from('forex_candles_best')
        .select('high, low, close, volume')
        .eq('symbol', symbol)
        .eq('timeframe', '5m')
        .order('open_time', { ascending: false })
        .limit(VWAP_LOOKBACK_CANDLES);

      // Governance: Validate minimum data requirement
      if (!candles || candles.length < VWAP_MIN_CANDLES) {
        logger.warn('[VWAPKissDetector] Insufficient candles for VWAP calculation', {
          symbol,
          candlesReceived: candles?.length || 0,
          minimumRequired: VWAP_MIN_CANDLES
        });
        return null;
      }

      let totalTPV = 0;
      let totalVolume = 0;

      // SSOT: Use same typical price formula as MarketChart
      // Formula: (high + low + close) / 3
      for (const candle of candles) {
        const typicalPrice = (parseFloat(candle.high) + parseFloat(candle.low) + parseFloat(candle.close)) / 3;
        const volume = parseFloat(candle.volume) || 1;
        totalTPV += typicalPrice * volume;
        totalVolume += volume;
      }

      const vwap = totalVolume > 0 ? totalTPV / totalVolume : null;

      // Cache result (Performance: reduce redundant calculations)
      if (vwap !== null) {
        this.vwapCache.set(symbol, { value: vwap, timestamp: Date.now() });
      }

      return vwap;
    } catch (error) {
      logger.error('[VWAPKissDetector] Error calculating VWAP', { error, symbol });
      return null;
    }
  }

  private async getCurrentPrice(symbol: string): Promise<number | null> {
    try {
      const { data } = await supabase
        .from('realtime_prices')
        .select('bid, ask')
        .eq('symbol', symbol)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!data) return null;

      return (parseFloat(data.bid) + parseFloat(data.ask)) / 2;
    } catch (error) {
      logger.error('[VWAPKissDetector] Error fetching price', { error, symbol });
      return null;
    }
  }

  private async getATR(symbol: string): Promise<number> {
    try {
      const { data: candles } = await supabase
        .from('forex_candles_best')
        .select('high, low, close')
        .eq('symbol', symbol)
        .eq('timeframe', '5m')
        .order('open_time', { ascending: false })
        .limit(15);

      if (!candles || candles.length < 14) {
        return 0.001;
      }

      const candleData = candles.map((c) => ({
        high: parseFloat(c.high),
        low: parseFloat(c.low),
        close: parseFloat(c.close),
      }));

      return calculateATR(candleData, 14);
    } catch (error) {
      logger.error('[VWAPKissDetector] Error calculating ATR', { error, symbol });
      return 0.001;
    }
  }

  private async analyzeSignal(symbol: string): Promise<VWAPSignal | null> {
    try {
      const [vwap, currentPrice, atr] = await Promise.all([
        this.calculateVWAP(symbol),
        this.getCurrentPrice(symbol),
        this.getATR(symbol),
      ]);

      if (!vwap || !currentPrice) {
        return null;
      }

      const distancePercent = Math.abs(((currentPrice - vwap) / vwap) * 100);
      let signalStrength: 'hot' | 'good' | 'watch';
      let scalpOpportunityScore: number;

      if (distancePercent < 0.1) {
        signalStrength = 'hot';
        scalpOpportunityScore = 90;
      } else if (distancePercent < 0.2) {
        signalStrength = 'good';
        scalpOpportunityScore = 75;
      } else if (distancePercent < 0.3) {
        signalStrength = 'watch';
        scalpOpportunityScore = 60;
      } else {
        return null;
      }

      const vwapAnalysis = analyzeVWAP(currentPrice, vwap, atr);
      let directionBias: 'bullish' | 'bearish' | 'neutral';
      let entrySuggestion: number;
      let exitSuggestion: number;
      let reasoning: string;

      if (vwapAnalysis.favorableForBuy && vwapAnalysis.zone === 'BELOW') {
        directionBias = 'bullish';
        entrySuggestion = currentPrice;
        exitSuggestion = vwap + atr * 0.5;
        reasoning = `Price ${distancePercent.toFixed(
          2
        )}% below VWAP. Bullish bounce opportunity. Enter near current level, target VWAP retest at ${exitSuggestion.toFixed(
          5
        )}.`;
      } else if (vwapAnalysis.favorableForSell && vwapAnalysis.zone === 'ABOVE') {
        directionBias = 'bearish';
        entrySuggestion = currentPrice;
        exitSuggestion = vwap - atr * 0.5;
        reasoning = `Price ${distancePercent.toFixed(
          2
        )}% above VWAP. Bearish rejection opportunity. Enter near current level, target VWAP retest at ${exitSuggestion.toFixed(
          5
        )}.`;
      } else {
        directionBias = 'neutral';
        entrySuggestion = vwap;
        exitSuggestion = currentPrice > vwap ? vwap + atr : vwap - atr;
        reasoning = `Price kissing VWAP (${distancePercent.toFixed(
          2
        )}% away). Watch for direction confirmation. Quick scalp on breakout or rejection.`;
      }

      return {
        symbol,
        currentPrice,
        vwapPrice: vwap,
        distancePercent,
        signalStrength,
        directionBias,
        scalpOpportunityScore,
        entrySuggestion,
        exitSuggestion,
        reasoning,
      };
    } catch (error) {
      logger.error('[VWAPKissDetector] Error analyzing signal', { error, symbol });
      return null;
    }
  }

  async scanForVWAPKissSignals(): Promise<void> {
    try {
      const signals: VWAPSignal[] = [];

      for (const symbol of WATCHLIST) {
        const signal = await this.analyzeSignal(symbol);
        if (signal) {
          signals.push(signal);
        }
      }

      if (signals.length === 0) {
        logger.info('[VWAPKissDetector] No VWAP kiss signals found');
        return;
      }

      signals.sort((a, b) => b.scalpOpportunityScore - a.scalpOpportunityScore);

      const symbolsToInsert = signals.map((s) => s.symbol);
      await supabase
        .from('vwap_kiss_signals')
        .delete()
        .in('symbol', symbolsToInsert)
        .gt('expires_at', new Date().toISOString());

      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 5);

      const insertData = signals.map((signal) => ({
        symbol: signal.symbol,
        current_price: signal.currentPrice,
        vwap_price: signal.vwapPrice,
        distance_percent: signal.distancePercent,
        signal_strength: signal.signalStrength,
        direction_bias: signal.directionBias,
        scalp_opportunity_score: signal.scalpOpportunityScore,
        entry_suggestion: signal.entrySuggestion,
        exit_suggestion: signal.exitSuggestion,
        reasoning: signal.reasoning,
        expires_at: expiresAt.toISOString(),
      }));

      const { error } = await supabase.from('vwap_kiss_signals').insert(insertData);

      if (error) {
        logger.error('[VWAPKissDetector] Failed to insert signals', { error });
      } else {
        logger.info('[VWAPKissDetector] VWAP kiss signals updated', {
          signalsCount: signals.length,
          topSignal: signals[0].symbol,
        });
      }
    } catch (error) {
      logger.error('[VWAPKissDetector] Error scanning for signals', { error });
    }
  }

  async getActiveSignals(): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('vwap_kiss_signals')
        .select('*')
        .gt('expires_at', new Date().toISOString())
        .order('scalp_opportunity_score', { ascending: false })
        .limit(10);

      if (error) {
        logger.error('[VWAPKissDetector] Failed to fetch active signals', { error });
        return [];
      }

      return data || [];
    } catch (error) {
      logger.error('[VWAPKissDetector] Error fetching active signals', { error });
      return [];
    }
  }
}

export const vwapKissDetectorService = new VWAPKissDetectorService();
