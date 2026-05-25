/**
 * @deprecated CCIP 2026-02-21: This calculator powered the old dual-system IM.
 *
 * The 8-indicator weighted calculator here produced DIFFERENT confidence scores than
 * Alpha's Omega Council pipeline, causing the dual-system problem where IM showed
 * a symbol at 75% but Alpha gave NO_TRADE.
 *
 * Replaced by: src/services/alpha-preview-scanner.ts (runs the identical Alpha pipeline).
 * This file is kept for audit trail only. No new code should import from it.
 *
 * Real-Time Intelligence Calculator - SSOT Authority
 *
 * RESPONSIBILITY: Calculate real-time probability for all watchlist pairs
 * based on weighted indicator alignment RIGHT NOW.
 *
 * CCIP Compliant:
 * - Single source of truth for real-time probability calculations
 * - No duplicate logic elsewhere
 * - Uses session-trade-probability-analyzer indicator methods
 * - Applies intelligent weights from config
 *
 * CCIP GOVERNANCE FIX (2026-01-29):
 * - ISSUE: Calculator was querying with wrong schema references (timestamp -> open_time, 15m -> M15, 1h -> H1)
 * - ROOT CAUSE: Hardcoded schema assumptions that didn't match actual database schema
 * - FIX: Updated all forex_candles_best queries to use correct column names and timeframe formats
 * - IMPACT: Fixes "Insufficient candles" errors that prevented all pairs from showing (0 pairs before fix)
 * - SSOT PRINCIPLE: Database schema is authoritative source of truth
 *
 * CCIP GOVERNANCE FIX (2026-02-17):
 * - ISSUE: All 8 indicator checks had overly loose thresholds causing near-universal 100% / 8-of-8 alignment
 * - ROOT CAUSE: VWAP allowed 0.5% wrong-side tolerance, EMA20 allowed 1%, RSI used 30-point windows,
 *   volume only needed 2/5 candles with self-referencing average, pattern just checked candle direction,
 *   structure used alternating-index comparison, momentum threshold was 0.1%
 * - FIX: Tightened all 8 indicators to institutional-grade discrimination:
 *   1. VWAP: Strict side-of-VWAP (no tolerance for wrong-side positions)
 *   2. EMA20: Strict side-of-EMA (removed 1% wrong-side allowance)
 *   3. EMA50: Added EMA20/EMA50 cross confirmation (trend alignment)
 *   4. RSI: Narrowed to 15-point windows (buy: 50-65, sell: 35-50)
 *   5. Volume: 20-candle baseline, 3/5 directional candles with above-average volume, missing data = fail
 *   6. Pattern: Requires >50% body ratio AND close beyond previous candle extreme (engulfing-grade)
 *   7. Structure: Consecutive transition counting (3/4 HH + 2/4 HL for buy, inverse for sell)
 *   8. Momentum: 0.3% threshold (3x previous) + short-term momentum confirmation
 * - IMPACT: 8/8 alignment now represents genuine institutional-grade confluence, not noise
 * - SSOT PRINCIPLE: This calculator is sole authority for real-time intelligence thresholds
 *
 * Governance:
 * - No database business logic
 * - Pure calculation service
 * - Results stored for display only
 */

import { getSupabaseAdmin } from './supabase-admin';
import type {
  Session,
  MarketRegime,
  IndicatorWeights,
} from '../../../src/config/intelligent-indicator-weights';
import {
  getIntelligentWeights,
  getCurrentSession,
} from '../../../src/config/intelligent-indicator-weights';
import { detectConstraintSandwich, type EnvelopeAssetClass } from '../../../src/config/style-execution-envelopes';
import { getSymbolConfig } from '../../../src/config/symbol-registry';
import { getCurrencyPipInfo } from '../../../src/utils/currencyHelpers';
import {
  getKillZoneContext,
  applyKillZoneConfidenceBonus,
  type KillZoneContext,
} from '../../../src/config/kill-zone-config';
import {
  analyzeMarketStructure,
  computeAsiaRange,
  type StructureEvent,
  type StructureEventType,
  type AsiaRangeData,
} from './market-structure-detector';

const supabase = getSupabaseAdmin();

interface IndicatorResult {
  vwap: boolean;
  ema20: boolean;
  ema50: boolean;
  rsi: boolean;
  volumePressure: boolean;
  candlePattern: boolean;
  structure: boolean;
  momentum: boolean;
}

export type TradeStyle = 'scalper' | 'micro' | 'intraday';
export type TradeDirection = 'buy' | 'sell';

export const STYLE_TIMEFRAME_MAP: Record<TradeStyle, string> = {
  scalp: 'M5',
  micro: 'M15',
  intraday: 'H1',
};

const STYLE_TO_ENVELOPE: Record<TradeStyle, string> = {
  scalp: 'SCALP',
  micro: 'MICRO_INTRADAY',
  intraday: 'INTRADAY',
};

export type ScalpSubMode = 'momentum_continuation' | 'pullback_entry' | 'consolidation_breakout';
export type ScalpPattern =
  | 'momentum_breakout'
  | 'bos_retest'
  | 'ema_rejection'
  | 'double_bottom'
  | 'double_top'
  | 'range_breakout'
  | 'liquidity_sweep'
  | 'engulfing_at_structure'
  | 'trend_pullback_ema'
  | 'none';
export type MomentumPhase = 'starting' | 'developing' | 'exhausted';

export interface IntelligencePairResult {
  symbol: string;
  confidence: number;
  alignedIndicators: number;
  totalIndicators: number;
  indicatorBreakdown: Record<string, { aligned: boolean; weight: number }>;
  reasoning: string[];
  lastCalculated: string;
  tradeStyle: TradeStyle;
  timeframe: string;
  direction: TradeDirection;
  constraintFeasible: boolean;
  constraintWarning?: string;
  scalpSubMode?: ScalpSubMode;
  scalpPattern?: ScalpPattern;
  momentumPhase?: MomentumPhase;
  atrTraveled?: number;
  structureEventType?: StructureEventType;
  structureEventDescription?: string;
  structureEventRR?: number;
  structureEventConfidence?: number;
  killZoneActive: boolean;
  killZoneName?: string;
  killZoneLabel?: string;
  killZoneQuality?: string;
  killZoneMinutesRemaining?: number;
  killZoneBadgeColor?: string;
  liquidityPoolDirection?: 'above' | 'below' | 'both' | 'none';
  liquidityPoolDistancePips?: number;
  asiaRangeHigh?: number;
  asiaRangeLow?: number;
  asiaRangePips?: number;
  asiaRangeLocked?: boolean;
}

interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export class RealTimeIntelligenceCalculator {
  private readonly MIN_CANDLES = 50;
  private readonly PROBABILITY_THRESHOLD = 70;
  private readonly INDICATOR_COUNT = 8;

  async calculateForAllPairs(symbols: string[]): Promise<{
    pairs: IntelligencePairResult[];
    marketCondition: MarketRegime;
    calculatedAt: string;
  }> {
    console.log(`[RealTimeIntelligence] Calculating for ${symbols.length} symbols...`);

    const session = getCurrentSession();
    const marketCondition = await this.detectMarketRegime(symbols);

    const results: IntelligencePairResult[] = [];

    for (const symbol of symbols) {
      try {
        const result = await this.calculateForSymbol(symbol, session, marketCondition, 'micro');

        if (result.confidence >= this.PROBABILITY_THRESHOLD) {
          results.push(result);
        }
      } catch (error) {
        console.error(`[RealTimeIntelligence] Error calculating ${symbol}:`, error);
      }
    }

    results.sort((a, b) => b.confidence - a.confidence);

    console.log(
      `[RealTimeIntelligence] Found ${results.length} high-probability pairs (≥${this.PROBABILITY_THRESHOLD}%)`
    );

    return {
      pairs: results,
      marketCondition,
      calculatedAt: new Date().toISOString(),
    };
  }

  async calculateForAllPairsWithAllScores(symbols: string[]): Promise<{
    allPairs: IntelligencePairResult[];
    topPairs: IntelligencePairResult[];
    highConfidencePairs: IntelligencePairResult[];
    heatingPairs: IntelligencePairResult[];
    marketCondition: MarketRegime;
    calculatedAt: string;
    diagnostics?: {
      symbolsAttempted: number;
      symbolsSuccessful: number;
      symbolsFailed: number;
      failureReasons: Record<string, string>;
    };
  }> {
    const styles: TradeStyle[] = ['scalper', 'micro', 'intraday'];
    const totalAnalyses = symbols.length * styles.length;
    console.log(`[RealTimeIntelligence] Calculating ALL pair scores: ${symbols.length} symbols x ${styles.length} styles = ${totalAnalyses} analyses...`);

    const session = getCurrentSession();
    const marketCondition = await this.detectMarketRegime(symbols);

    const allResults: IntelligencePairResult[] = [];
    const failureReasons: Record<string, string> = {};

    for (const symbol of symbols) {
      const stylePromises = styles.map(async (style) => {
        try {
          const result = await this.calculateForSymbol(symbol, session, marketCondition, style);
          return { result, error: null, style };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return { result: null, error: errorMessage, style };
        }
      });

      const styleResults = await Promise.all(stylePromises);

      for (const { result, error, style } of styleResults) {
        if (result) {
          allResults.push(result);
        } else if (error) {
          const key = `${symbol}:${style}`;
          failureReasons[key] = error;
        }
      }
    }

    allResults.sort((a, b) => b.confidence - a.confidence);

    const highConfidencePairs = allResults.filter((p) => p.confidence >= this.PROBABILITY_THRESHOLD);
    const heatingPairs = allResults.filter((p) => p.confidence >= 50 && p.confidence < this.PROBABILITY_THRESHOLD);
    const topPairs = allResults.slice(0, 5);

    console.log(
      `[RealTimeIntelligence] Multi-style analysis complete: ${allResults.length} total | ${highConfidencePairs.length} ≥70% | ${heatingPairs.length} heating (50-70%)`
    );

    if (Object.keys(failureReasons).length > 0) {
      console.warn(
        `[RealTimeIntelligence] Failed analyses: ${Object.keys(failureReasons).join(', ')}`
      );
    }

    return {
      allPairs: allResults,
      topPairs,
      highConfidencePairs,
      heatingPairs,
      marketCondition,
      calculatedAt: new Date().toISOString(),
      diagnostics: {
        symbolsAttempted: symbols.length,
        symbolsSuccessful: allResults.length,
        symbolsFailed: Object.keys(failureReasons).length,
        failureReasons,
      },
    };
  }

  private async calculateForSymbol(
    symbol: string,
    session: Session,
    regime: MarketRegime,
    style: TradeStyle = 'micro'
  ): Promise<IntelligencePairResult> {
    const timeframe = STYLE_TIMEFRAME_MAP[style];

    const { data: priceData } = await supabase
      .from('realtime_prices')
      .select('mid, created_at')
      .eq('symbol', symbol)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!priceData) {
      throw new Error(`No price data for ${symbol}`);
    }

    const currentPrice = parseFloat(priceData.mid);

    const { data: candlesData } = await supabase
      .from('forex_candles_best')
      .select('open_time, open, high, low, close, volume')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .order('open_time', { ascending: false })
      .limit(200);

    if (!candlesData || candlesData.length < this.MIN_CANDLES) {
      throw new Error(`Insufficient ${timeframe} candles for ${symbol}: ${candlesData?.length || 0}`);
    }

    const candles: Candle[] = candlesData.reverse().map((c) => ({
      timestamp:
        typeof c.open_time === 'number' ? c.open_time : new Date(c.open_time).getTime() / 1000,
      open: parseFloat(String(c.open)),
      high: parseFloat(String(c.high)),
      low: parseFloat(String(c.low)),
      close: parseFloat(String(c.close)),
      volume: c.volume ? parseFloat(String(c.volume)) : undefined,
    }));

    const direction = this.determineDirection(candles);

    const indicators = this.evaluateIndicators(currentPrice, candles, direction);

    const weights = getIntelligentWeights(symbol, session, regime);

    const { confidence, alignedCount } = this.calculateWeightedConfidence(indicators, weights);

    const indicatorBreakdown = this.buildIndicatorBreakdown(indicators, weights);

    const reasoning = this.generateReasoning(symbol, alignedCount, indicators, confidence);

    const envelopeStyle = STYLE_TO_ENVELOPE[style];
    const envelopeAssetClass = this.getEnvelopeAssetClass(symbol);
    const pipInfo = getCurrencyPipInfo(symbol);
    const noiseFloorPips = this.calculateNoiseFloorPips(candles, pipInfo.pipValue);
    const sandwichCheck = detectConstraintSandwich(envelopeStyle, envelopeAssetClass, noiseFloorPips, symbol, currentPrice);
    const constraintFeasible = !sandwichCheck.sandwiched;

    let adjustedConfidence = confidence;
    if (!constraintFeasible) {
      adjustedConfidence = Math.min(confidence, 50);
      reasoning.push(`Style blocked by constraint geometry at current price (confidence capped from ${Math.round(confidence)}% to ${Math.round(adjustedConfidence)}%)`);
    }

    const scalpAnalysis = style === 'scalper'
      ? this.analyzeScalpOpportunity(candles, direction, currentPrice, pipInfo.pipValue)
      : undefined;

    const killZoneCtx = getKillZoneContext();
    const killZoneAdjustedConfidence = applyKillZoneConfidenceBonus(adjustedConfidence, killZoneCtx);

    if (killZoneCtx.killZoneActive && killZoneCtx.confidenceBonus > 0) {
      reasoning.push(`${killZoneCtx.killZoneLabel} active — session confidence +${killZoneCtx.confidenceBonus}%`);
    } else if (killZoneCtx.confidenceBonus < 0) {
      reasoning.push(`Outside prime session window — confidence adjusted ${killZoneCtx.confidenceBonus}%`);
    }

    const asiaRange = computeAsiaRange(candles, pipInfo.pipValue);
    const structureAnalysis = analyzeMarketStructure(candles, pipInfo.pipValue, asiaRange);
    const primaryEvent = structureAnalysis.primaryEvent;

    if (primaryEvent) {
      reasoning.push(primaryEvent.description);
    }

    return {
      symbol,
      confidence: Math.round(killZoneAdjustedConfidence),
      alignedIndicators: alignedCount,
      totalIndicators: this.INDICATOR_COUNT,
      indicatorBreakdown,
      reasoning,
      lastCalculated: new Date().toISOString(),
      tradeStyle: style,
      timeframe,
      direction,
      constraintFeasible,
      constraintWarning: sandwichCheck.advisory || undefined,
      ...(scalpAnalysis ?? {}),
      structureEventType: primaryEvent?.eventType,
      structureEventDescription: primaryEvent?.description,
      structureEventRR: primaryEvent?.estimatedRR,
      structureEventConfidence: primaryEvent?.confidence,
      killZoneActive: killZoneCtx.killZoneActive,
      killZoneName: killZoneCtx.killZoneName ?? undefined,
      killZoneLabel: killZoneCtx.killZoneLabel ?? undefined,
      killZoneQuality: killZoneCtx.killZoneQuality ?? undefined,
      killZoneMinutesRemaining: killZoneCtx.minutesRemaining,
      killZoneBadgeColor: killZoneCtx.badgeColor,
      liquidityPoolDirection: primaryEvent?.liquidityPoolDirection,
      liquidityPoolDistancePips: primaryEvent?.liquidityPoolDistancePips,
      asiaRangeHigh: asiaRange.asiaHigh ?? undefined,
      asiaRangeLow: asiaRange.asiaLow ?? undefined,
      asiaRangePips: asiaRange.rangePips,
      asiaRangeLocked: asiaRange.isLocked,
    };
  }

  private analyzeScalpOpportunity(
    candles: Candle[],
    direction: 'buy' | 'sell',
    currentPrice: number,
    pipValue: number
  ): { scalpSubMode: ScalpSubMode; scalpPattern: ScalpPattern; momentumPhase: MomentumPhase; atrTraveled: number } {
    const atr = this.calculateATR(candles, 14);
    const momentumPhase = this.detectMomentumPhase(candles, atr, direction);
    const scalpPattern = this.detectScalpPattern(candles, direction, atr, pipValue);
    const scalpSubMode = this.detectScalpSubMode(candles, direction, momentumPhase);
    const atrTraveled = this.calculateATRTraveled(candles, direction, atr);

    return { scalpSubMode, scalpPattern, momentumPhase, atrTraveled };
  }

  private calculateATR(candles: Candle[], period: number): number {
    if (candles.length < period + 1) return 0;
    const recent = candles.slice(-(period + 1));
    let sum = 0;
    for (let i = 1; i < recent.length; i++) {
      const tr = Math.max(
        recent[i].high - recent[i].low,
        Math.abs(recent[i].high - recent[i - 1].close),
        Math.abs(recent[i].low - recent[i - 1].close)
      );
      sum += tr;
    }
    return sum / period;
  }

  private calculateATRTraveled(candles: Candle[], direction: 'buy' | 'sell', atr: number): number {
    if (atr === 0 || candles.length < 10) return 0;
    const recent = candles.slice(-10);
    const swingLow = Math.min(...recent.map(c => c.low));
    const swingHigh = Math.max(...recent.map(c => c.high));
    const currentClose = candles[candles.length - 1].close;

    if (direction === 'buy') {
      const moveFromLow = currentClose - swingLow;
      return moveFromLow / atr;
    } else {
      const moveFromHigh = swingHigh - currentClose;
      return moveFromHigh / atr;
    }
  }

  private detectMomentumPhase(candles: Candle[], atr: number, direction: 'buy' | 'sell'): MomentumPhase {
    const atrTraveled = this.calculateATRTraveled(candles, direction, atr);

    if (atrTraveled > 1.5) return 'exhausted';
    if (atrTraveled > 0.75) return 'developing';
    return 'starting';
  }

  private detectScalpSubMode(
    candles: Candle[],
    direction: 'buy' | 'sell',
    momentumPhase: MomentumPhase
  ): ScalpSubMode {
    if (candles.length < 10) return 'momentum_continuation';

    const recent5 = candles.slice(-5);
    const recentBodies = recent5.map(c => ({ bullish: c.close > c.open, size: Math.abs(c.close - c.open) }));
    const allSameDir = recentBodies.every(b => direction === 'buy' ? b.bullish : !b.bullish);

    if (allSameDir && momentumPhase === 'starting') return 'momentum_continuation';

    const isConsolidating = this.detectConsolidation(candles.slice(-6));
    if (isConsolidating) return 'consolidation_breakout';

    return 'pullback_entry';
  }

  private detectConsolidation(candles: Candle[]): boolean {
    if (candles.length < 4) return false;
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const rangeHigh = Math.max(...highs);
    const rangeLow = Math.min(...lows);
    const totalRange = rangeHigh - rangeLow;
    const avgBodySize = candles.reduce((sum, c) => sum + Math.abs(c.close - c.open), 0) / candles.length;
    return avgBodySize < totalRange * 0.25;
  }

  private detectScalpPattern(
    candles: Candle[],
    direction: 'buy' | 'sell',
    atr: number,
    pipValue: number
  ): ScalpPattern {
    if (candles.length < 20) return 'none';

    if (this.isDoubleBottom(candles, direction)) return direction === 'buy' ? 'double_bottom' : 'double_top';
    if (this.isBOSRetest(candles, direction)) return 'bos_retest';
    if (this.isEMARejection(candles, direction)) return 'ema_rejection';
    if (this.isLiquiditySweep(candles, direction)) return 'liquidity_sweep';
    if (this.isRangeBreakout(candles, direction)) return 'range_breakout';
    if (this.isEngulfingAtStructure(candles, direction)) return 'engulfing_at_structure';
    if (this.isMomentumBreakout(candles, direction, atr)) return 'momentum_breakout';
    if (this.isTrendPullbackEMA(candles, direction)) return 'trend_pullback_ema';

    return 'none';
  }

  private isDoubleBottom(candles: Candle[], direction: 'buy' | 'sell'): boolean {
    if (candles.length < 20) return false;
    const recent = candles.slice(-20);
    const tolerance = (Math.max(...recent.map(c => c.high)) - Math.min(...recent.map(c => c.low))) * 0.015;

    if (direction === 'buy') {
      const lows = recent.map((c, i) => ({ price: c.low, i }));
      for (let i = 3; i < lows.length - 1; i++) {
        for (let j = 0; j < i - 2; j++) {
          if (Math.abs(lows[i].price - lows[j].price) <= tolerance) {
            const midHigh = Math.max(...recent.slice(j, i).map(c => c.high));
            if (midHigh > lows[i].price + tolerance * 3) return true;
          }
        }
      }
    } else {
      const highs = recent.map((c, i) => ({ price: c.high, i }));
      for (let i = 3; i < highs.length - 1; i++) {
        for (let j = 0; j < i - 2; j++) {
          if (Math.abs(highs[i].price - highs[j].price) <= tolerance) {
            const midLow = Math.min(...recent.slice(j, i).map(c => c.low));
            if (midLow < highs[i].price - tolerance * 3) return true;
          }
        }
      }
    }
    return false;
  }

  private isBOSRetest(candles: Candle[], direction: 'buy' | 'sell'): boolean {
    if (candles.length < 15) return false;
    const mid = candles.slice(-15, -5);
    const recent = candles.slice(-5);
    const current = candles[candles.length - 1];

    if (direction === 'buy') {
      const priorHigh = Math.max(...mid.map(c => c.high));
      const brokePriorHigh = mid.some(c => c.close > priorHigh) ||
        recent.some((c, i) => i < recent.length - 2 && c.close > priorHigh);
      const retestingLevel = Math.abs(current.close - priorHigh) / priorHigh < 0.003;
      return brokePriorHigh && retestingLevel;
    } else {
      const priorLow = Math.min(...mid.map(c => c.low));
      const brokePriorLow = mid.some(c => c.close < priorLow) ||
        recent.some((c, i) => i < recent.length - 2 && c.close < priorLow);
      const retestingLevel = Math.abs(current.close - priorLow) / priorLow < 0.003;
      return brokePriorLow && retestingLevel;
    }
  }

  private isEMARejection(candles: Candle[], direction: 'buy' | 'sell'): boolean {
    if (candles.length < 21) return false;
    const ema20 = this.calculateEMA(candles, 20);
    const current = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const touchedEMA = Math.min(current.low, prev.low) <= ema20 * 1.001 &&
      Math.max(current.high, prev.high) >= ema20 * 0.999;
    const rejectedFromEMA = direction === 'buy'
      ? current.close > ema20 && current.close > current.open
      : current.close < ema20 && current.close < current.open;
    return touchedEMA && rejectedFromEMA;
  }

  private isLiquiditySweep(candles: Candle[], direction: 'buy' | 'sell'): boolean {
    if (candles.length < 10) return false;
    const lookback = candles.slice(-10, -1);
    const current = candles[candles.length - 1];

    if (direction === 'buy') {
      const priorLow = Math.min(...lookback.map(c => c.low));
      const sweptLow = current.low < priorLow;
      const reclaimedAbove = current.close > priorLow;
      const strongClose = current.close > current.open;
      return sweptLow && reclaimedAbove && strongClose;
    } else {
      const priorHigh = Math.max(...lookback.map(c => c.high));
      const sweptHigh = current.high > priorHigh;
      const reclaimedBelow = current.close < priorHigh;
      const strongClose = current.close < current.open;
      return sweptHigh && reclaimedBelow && strongClose;
    }
  }

  private isRangeBreakout(candles: Candle[], direction: 'buy' | 'sell'): boolean {
    if (candles.length < 12) return false;
    const consolidation = candles.slice(-12, -3);
    const breaking = candles.slice(-3);
    const consolidationHigh = Math.max(...consolidation.map(c => c.high));
    const consolidationLow = Math.min(...consolidation.map(c => c.low));
    const consolidationRange = consolidationHigh - consolidationLow;
    const avgBodySize = consolidation.reduce((sum, c) => sum + Math.abs(c.close - c.open), 0) / consolidation.length;
    const isTight = avgBodySize < consolidationRange * 0.3;

    if (direction === 'buy') {
      return isTight && breaking.some(c => c.close > consolidationHigh);
    } else {
      return isTight && breaking.some(c => c.close < consolidationLow);
    }
  }

  private isEngulfingAtStructure(candles: Candle[], direction: 'buy' | 'sell'): boolean {
    if (candles.length < 10) return false;
    const current = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const body = Math.abs(current.close - current.open);
    const range = current.high - current.low;
    if (range === 0) return false;
    const bodyRatio = body / range;

    const isEngulfing = direction === 'buy'
      ? current.close > current.open && current.close > prev.high && bodyRatio > 0.55
      : current.close < current.open && current.close < prev.low && bodyRatio > 0.55;

    const structureLookback = candles.slice(-15, -3);
    const nearStructure = direction === 'buy'
      ? Math.abs(current.low - Math.min(...structureLookback.map(c => c.low))) /
        (Math.max(...structureLookback.map(c => c.high)) - Math.min(...structureLookback.map(c => c.low)) || 1) < 0.15
      : Math.abs(current.high - Math.max(...structureLookback.map(c => c.high))) /
        (Math.max(...structureLookback.map(c => c.high)) - Math.min(...structureLookback.map(c => c.low)) || 1) < 0.15;

    return isEngulfing && nearStructure;
  }

  private isMomentumBreakout(candles: Candle[], direction: 'buy' | 'sell', atr: number): boolean {
    if (candles.length < 8 || atr === 0) return false;
    const recent3 = candles.slice(-3);
    const allSameDir = direction === 'buy'
      ? recent3.every(c => c.close > c.open)
      : recent3.every(c => c.close < c.open);
    const totalMove = direction === 'buy'
      ? recent3[2].close - recent3[0].open
      : recent3[0].open - recent3[2].close;
    return allSameDir && totalMove > atr * 0.4;
  }

  private isTrendPullbackEMA(candles: Candle[], direction: 'buy' | 'sell'): boolean {
    if (candles.length < 30) return false;
    const ema20 = this.calculateEMA(candles, 20);
    const ema50 = this.calculateEMA(candles, 50);
    const trendAligned = direction === 'buy' ? ema20 > ema50 : ema20 < ema50;
    if (!trendAligned) return false;

    const recent = candles.slice(-8);
    const touchedEMA = recent.some(c =>
      direction === 'buy' ? c.low <= ema20 * 1.002 : c.high >= ema20 * 0.998
    );
    const currentAboveBelow = direction === 'buy'
      ? candles[candles.length - 1].close > ema20
      : candles[candles.length - 1].close < ema20;
    return trendAligned && touchedEMA && currentAboveBelow;
  }

  private determineDirection(candles: Candle[]): 'buy' | 'sell' {
    if (candles.length < 5) return 'buy';

    const recent = candles.slice(-5);
    const closes = recent.map((c) => c.close);
    const avgClose = closes.reduce((sum, c) => sum + c, 0) / closes.length;
    const currentClose = closes[closes.length - 1];

    return currentClose > avgClose ? 'buy' : 'sell';
  }

  private evaluateIndicators(
    price: number,
    candles: Candle[],
    direction: 'buy' | 'sell'
  ): IndicatorResult {
    return {
      vwap: this.checkVWAP(price, candles, direction),
      ema20: this.checkEMA20(price, candles, direction),
      ema50: this.checkEMA50(price, candles, direction),
      rsi: this.checkRSI(candles, direction),
      volumePressure: this.checkVolume(candles, direction),
      candlePattern: this.checkPattern(candles, direction),
      structure: this.checkStructure(candles, direction),
      momentum: this.checkMomentum(candles, direction),
    };
  }

  private checkVWAP(price: number, candles: Candle[], direction: string): boolean {
    if (candles.length === 0) return false;

    const vwap = this.calculateVWAP(candles.slice(-50));

    if (direction === 'buy') {
      return price > vwap;
    } else {
      return price < vwap;
    }
  }

  private checkEMA20(price: number, candles: Candle[], direction: string): boolean {
    if (candles.length < 20) return false;

    const ema20 = this.calculateEMA(candles, 20);

    if (direction === 'buy') {
      return price > ema20;
    } else {
      return price < ema20;
    }
  }

  private checkEMA50(price: number, candles: Candle[], direction: string): boolean {
    if (candles.length < 50) return false;

    const ema50 = this.calculateEMA(candles, 50);
    const ema20 = this.calculateEMA(candles, 20);

    if (direction === 'buy') {
      return price > ema50 && ema20 > ema50;
    } else {
      return price < ema50 && ema20 < ema50;
    }
  }

  private checkRSI(candles: Candle[], direction: string): boolean {
    if (candles.length < 14) return false;

    const rsi = this.calculateRSI(candles, 14);

    if (direction === 'buy') {
      return rsi > 50 && rsi < 65;
    } else {
      return rsi > 35 && rsi < 50;
    }
  }

  private checkVolume(candles: Candle[], direction: string): boolean {
    if (candles.length < 20) return false;

    const lookback = candles.slice(-20);
    const volumeCandles = lookback.filter(c => c.volume && c.volume > 0);
    if (volumeCandles.length < 10) return false;

    const avgVolume = volumeCandles.reduce((sum, c) => sum + (c.volume || 0), 0) / volumeCandles.length;
    const recentCandles = candles.slice(-5);

    let matchingCandles = 0;
    for (const candle of recentCandles) {
      const isBullish = candle.close > candle.open;
      const hasAboveAvgVolume = (candle.volume || 0) > avgVolume;

      if (direction === 'buy' && isBullish && hasAboveAvgVolume) matchingCandles++;
      if (direction === 'sell' && !isBullish && hasAboveAvgVolume) matchingCandles++;
    }

    return matchingCandles >= 3;
  }

  private checkPattern(candles: Candle[], direction: string): boolean {
    if (candles.length < 3) return false;

    const current = candles[candles.length - 1];
    const previous = candles[candles.length - 2];

    const body = Math.abs(current.close - current.open);
    const range = current.high - current.low;
    if (range === 0) return false;
    const bodyRatio = body / range;

    if (direction === 'buy') {
      return current.close > current.open && bodyRatio > 0.5 && current.close > previous.high;
    } else {
      return current.close < current.open && bodyRatio > 0.5 && current.close < previous.low;
    }
  }

  private checkStructure(candles: Candle[], direction: string): boolean {
    if (candles.length < 5) return false;

    const recent = candles.slice(-5);
    let higherHighs = 0;
    let higherLows = 0;
    let lowerHighs = 0;
    let lowerLows = 0;

    for (let i = 1; i < recent.length; i++) {
      if (recent[i].high > recent[i - 1].high) higherHighs++;
      if (recent[i].low > recent[i - 1].low) higherLows++;
      if (recent[i].high < recent[i - 1].high) lowerHighs++;
      if (recent[i].low < recent[i - 1].low) lowerLows++;
    }

    if (direction === 'buy') {
      return higherHighs >= 3 && higherLows >= 2;
    } else {
      return lowerLows >= 3 && lowerHighs >= 2;
    }
  }

  private checkMomentum(candles: Candle[], direction: string): boolean {
    if (candles.length < 10) return false;

    const recent = candles.slice(-10);
    const longChange = (recent[9].close - recent[0].close) / recent[0].close;

    const short = candles.slice(-3);
    const shortChange = (short[short.length - 1].close - short[0].close) / short[0].close;

    if (direction === 'buy') {
      return longChange > 0.003 && shortChange > 0;
    } else {
      return longChange < -0.003 && shortChange < 0;
    }
  }

  private calculateVWAP(candles: Candle[]): number {
    let cumPQ = 0;
    let cumQ = 0;

    for (const candle of candles) {
      const tp = (candle.high + candle.low + candle.close) / 3;
      const volume = candle.volume || 1;
      cumPQ += tp * volume;
      cumQ += volume;
    }

    return cumQ > 0 ? cumPQ / cumQ : candles[candles.length - 1].close;
  }

  private calculateEMA(candles: Candle[], period: number): number {
    if (candles.length < period) return candles[candles.length - 1].close;

    const multiplier = 2 / (period + 1);
    let ema = 0;

    for (let i = 0; i < period; i++) {
      ema += candles[i].close;
    }
    ema /= period;

    for (let i = period; i < candles.length; i++) {
      ema = candles[i].close * multiplier + ema * (1 - multiplier);
    }

    return ema;
  }

  private calculateRSI(candles: Candle[], period: number = 14): number {
    if (candles.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i < candles.length; i++) {
      const change = candles[i].close - candles[i - 1].close;
      if (change > 0) gains += change;
      else losses += Math.abs(change);
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    const rsi = 100 - 100 / (1 + rs);

    return rsi;
  }

  private calculateWeightedConfidence(
    indicators: IndicatorResult,
    weights: IndicatorWeights
  ): { confidence: number; alignedCount: number } {
    let weightedSum = 0;
    let totalWeight = 0;
    let alignedCount = 0;

    for (const [key, aligned] of Object.entries(indicators)) {
      const weight = weights[key as keyof IndicatorWeights];
      totalWeight += weight;

      if (aligned) {
        weightedSum += weight;
        alignedCount++;
      }
    }

    const confidence = (weightedSum / totalWeight) * 100;
    return { confidence, alignedCount };
  }

  private buildIndicatorBreakdown(
    indicators: IndicatorResult,
    weights: IndicatorWeights
  ): Record<string, { aligned: boolean; weight: number }> {
    const breakdown: Record<string, { aligned: boolean; weight: number }> = {};

    for (const [key, aligned] of Object.entries(indicators)) {
      breakdown[key] = {
        aligned,
        weight: weights[key as keyof IndicatorWeights],
      };
    }

    return breakdown;
  }

  private generateReasoning(
    symbol: string,
    alignedCount: number,
    indicators: IndicatorResult,
    confidence: number
  ): string[] {
    const reasons: string[] = [];

    if (confidence >= 85) {
      reasons.push('Strong multi-indicator confluence detected');
    } else if (confidence >= 75) {
      reasons.push('Good indicator alignment across multiple timeframes');
    } else if (confidence >= 70) {
      reasons.push('Moderate probability setup forming');
    }

    if (indicators.vwap && indicators.ema20) {
      reasons.push('Price aligned with both VWAP and EMA20');
    }

    if (indicators.structure && indicators.momentum) {
      reasons.push('Market structure and momentum in agreement');
    }

    if (indicators.volumePressure) {
      reasons.push('Volume confirms directional bias');
    }

    if (!indicators.rsi && confidence >= 70) {
      reasons.push('RSI showing caution - monitor closely');
    }

    return reasons.slice(0, 3);
  }

  private async detectMarketRegime(symbols: string[]): Promise<MarketRegime> {
    let trendingCount = 0;
    let volatileCount = 0;
    let quietCount = 0;

    for (const symbol of symbols.slice(0, 5)) {
      try {
        const { data: candles } = await supabase
          .from('forex_candles_best')
          .select('high, low, close')
          .eq('symbol', symbol)
          .eq('timeframe', 'H1')
          .order('open_time', { ascending: false })
          .limit(24);

        if (candles && candles.length >= 20) {
          const ranges = candles.map((c) => parseFloat(String(c.high)) - parseFloat(String(c.low)));
          const avgRange = ranges.reduce((sum, r) => sum + r, 0) / ranges.length;
          const recentRange = ranges[0];

          if (recentRange > avgRange * 1.5) volatileCount++;
          if (recentRange < avgRange * 0.5) quietCount++;

          const closes = candles.map((c) => parseFloat(String(c.close)));
          const trend = Math.abs(closes[0] - closes[closes.length - 1]);
          if (trend > avgRange * 3) trendingCount++;
        }
      } catch (error) {
        console.error(`[RealTimeIntelligence] Error analyzing ${symbol} regime:`, error);
      }
    }

    const total = symbols.slice(0, 5).length;
    if (quietCount / total > 0.6) return 'quiet';
    if (trendingCount / total > 0.5) return 'trending';
    if (volatileCount / total > 0.5) return 'volatile';
    return 'ranging';
  }

  private calculateNoiseFloorPips(candles: Candle[], pipValue: number): number {
    const period = 14;
    if (candles.length < period + 1) return 0;
    const recent = candles.slice(-(period + 1));
    let atrSum = 0;
    for (let i = 1; i < recent.length; i++) {
      const tr = Math.max(
        recent[i].high - recent[i].low,
        Math.abs(recent[i].high - recent[i - 1].close),
        Math.abs(recent[i].low - recent[i - 1].close)
      );
      atrSum += tr;
    }
    return (atrSum / period) / pipValue;
  }

  private getEnvelopeAssetClass(symbol: string): EnvelopeAssetClass {
    const config = getSymbolConfig(symbol);
    if (!config) return 'FOREX';
    switch (config.category) {
      case 'metal': return 'METAL';
      case 'index': return 'INDEX';
      default: return 'FOREX';
    }
  }
}

export const realTimeIntelligenceCalculator = new RealTimeIntelligenceCalculator();
