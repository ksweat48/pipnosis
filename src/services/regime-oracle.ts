/**
 * Regime Oracle - Zero-Cost Market Intelligence
 *
 * Provides time-of-day, session, volatility, and market-structure intelligence
 * to the AI brains. Pure local computation with NO LLM calls.
 *
 * This module acts as a filter BEFORE expensive Alpha/Omega calls,
 * blocking trades during dead zones and high-risk conditions.
 *
 * Categories:
 * - Time Regime (session detection, market hours)
 * - Volatility Regime (ATR, wicks, spread)
 * - Trend & Structure (EMA alignment, market phase)
 * - Safety Flags (avoid_trading, risk reduction)
 *
 * SSOT COMPLIANCE:
 * - Session constraints delegated to sessionConstraintCoordinator
 * - Asset classification delegated to assetClassifier
 * - NO hardcoded symbol checks - all queries go through coordinators
 */

import { sessionConstraintCoordinator } from './session-constraint-coordinator';
import { assetClassifier } from './asset-classifier';

export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  time?: number;
  open_time?: string | Date;
}

export interface MarketState {
  price: number;
  ema20: number;
  ema50: number;
  ema200: number;
  rsi: number;
  atr: number;
  vwap?: number;
  volume?: number;
  recentCandles?: Candle[];
}

export interface TimeRegime {
  session: 'asian' | 'london' | 'ny' | 'dead';
  session_open: boolean;
  is_asian_session: boolean;
  is_london_open: boolean;
  is_london_session: boolean;
  is_ny_open: boolean;
  is_ny_session: boolean;
  is_dead_zone: boolean;
  is_session_overlap: boolean;
  minutes_into_session: number;
}

export interface VolatilityRegime {
  volatility_score: number;
  atr_compression: boolean;
  atr_expansion: boolean;
  wick_risk_level: 'low' | 'medium' | 'high';
  spread_risk: 'low' | 'medium' | 'high';
  avg_wick_size: number;
  volatility_trend: 'rising' | 'falling' | 'stable';
}

export interface TrendStructureRegime {
  trend_strength_score: number;
  structure_type: 'trend' | 'range' | 'accumulation' | 'distribution';
  market_bias: 'bull' | 'bear' | 'sideways';
  ema_alignment: 'bullish' | 'bearish' | 'mixed';
  structure_quality: 'clean' | 'choppy';
}

export interface SafetyFlags {
  is_high_risk_regime: boolean;
  avoid_trading: boolean; // DEPRECATED - Alpha has final authority
  risk_reduction_factor: number;
  reason?: string;
  session_weight?: number;
  dead_zone_active?: boolean;
}

export interface RegimeSnapshot {
  session: 'asian' | 'london' | 'ny' | 'dead';
  session_open: boolean;
  minutes_into_session: number;
  volatility_score: number;
  atr_compression: boolean;
  atr_expansion: boolean;
  trend_strength_score: number;
  structure: 'trend' | 'range' | 'accumulation' | 'distribution';
  market_bias: 'bull' | 'bear' | 'sideways';
  wick_risk: 'low' | 'medium' | 'high';
  avoid_trading: boolean;
  is_high_risk_regime: boolean;
  risk_reduction_factor: number;
  reason?: string;
  timestamp: Date;
  time_regime: TimeRegime;
  volatility_regime: VolatilityRegime;
  trend_regime: TrendStructureRegime;
  safety_flags: SafetyFlags;
}

class RegimeOracle {
  /**
   * Main evaluation function - computes all regime data
   */
  evaluate(
    marketState: MarketState,
    timestamp: Date | number | string,
    candles: Candle[],
    symbol?: string
  ): RegimeSnapshot {
    // Convert timestamp to Date object, handling string, number, or Date
    const ts = this.normalizeTimestamp(timestamp);

    const timeRegime = this.detectTimeRegime(ts);
    const volatilityRegime = this.detectVolatilityRegime(marketState.atr, candles);
    const trendRegime = this.detectTrendStructureRegime(marketState, candles);
    const safetyFlags = this.computeSafetyFlags(timeRegime, volatilityRegime, trendRegime, symbol, ts);

    return {
      session: timeRegime.session,
      session_open: timeRegime.session_open,
      minutes_into_session: timeRegime.minutes_into_session,
      volatility_score: volatilityRegime.volatility_score,
      atr_compression: volatilityRegime.atr_compression,
      atr_expansion: volatilityRegime.atr_expansion,
      trend_strength_score: trendRegime.trend_strength_score,
      structure: trendRegime.structure_type,
      market_bias: trendRegime.market_bias,
      wick_risk: volatilityRegime.wick_risk_level,
      avoid_trading: safetyFlags.avoid_trading,
      is_high_risk_regime: safetyFlags.is_high_risk_regime,
      risk_reduction_factor: safetyFlags.risk_reduction_factor,
      reason: safetyFlags.reason,
      timestamp: ts,
      time_regime: timeRegime,
      volatility_regime: volatilityRegime,
      trend_regime: trendRegime,
      safety_flags: safetyFlags
    };
  }

  /**
   * Helper: Normalize timestamp to Date object
   */
  private normalizeTimestamp(timestamp: Date | number | string): Date {
    if (timestamp instanceof Date) {
      return timestamp;
    }

    if (typeof timestamp === 'number') {
      return new Date(timestamp);
    }

    if (typeof timestamp === 'string') {
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) {
        console.error('[Regime Oracle] Invalid date string:', timestamp);
        return new Date(); // Fallback to current time
      }
      return date;
    }

    console.error('[Regime Oracle] Unexpected timestamp type:', typeof timestamp);
    return new Date(); // Fallback to current time
  }

  /**
   * A. TIME REGIME DETECTION
   */
  private detectTimeRegime(timestamp: Date): TimeRegime {
    const hour = timestamp.getUTCHours();
    const minute = timestamp.getUTCMinutes();

    const isAsian = hour >= 0 && hour < 8;
    const isLondonOpen = hour === 8 && minute < 60;
    const isLondon = hour >= 8 && hour < 16;
    const isNYOpen = hour === 13 && minute < 60;
    const isNY = hour >= 13 && hour < 21;
    const isDead = hour >= 21 || hour < 0;
    const isOverlap = hour >= 13 && hour < 16;

    let session: 'asian' | 'london' | 'ny' | 'dead';
    let sessionStartHour: number;

    if (isDead) {
      session = 'dead';
      sessionStartHour = 21;
    } else if (isNY) {
      session = 'ny';
      sessionStartHour = 13;
    } else if (isLondon) {
      session = 'london';
      sessionStartHour = 8;
    } else {
      session = 'asian';
      sessionStartHour = 0;
    }

    const minutesIntoSession = ((hour - sessionStartHour) * 60) + minute;

    return {
      session,
      session_open: isLondonOpen || isNYOpen,
      is_asian_session: isAsian,
      is_london_open: isLondonOpen,
      is_london_session: isLondon,
      is_ny_open: isNYOpen,
      is_ny_session: isNY,
      is_dead_zone: isDead,
      is_session_overlap: isOverlap,
      minutes_into_session: minutesIntoSession
    };
  }

  /**
   * B. VOLATILITY REGIME DETECTION
   */
  private detectVolatilityRegime(currentATR: number, candles: Candle[]): VolatilityRegime {
    if (!candles || candles.length < 20) {
      return this.getDefaultVolatilityRegime();
    }

    const atr20Avg = this.compute20PeriodATRAvg(candles);
    const atrCompression = currentATR < atr20Avg * 0.75;
    const atrExpansion = currentATR > atr20Avg * 1.25;

    const volatilityScore = Math.min(100, Math.round((currentATR / atr20Avg) * 50));

    const wickRisk = this.computeWickRisk(candles);
    const avgWickSize = this.computeAvgWickSize(candles);

    const spreadRisk = this.estimateSpreadRisk(volatilityScore);

    const volatilityTrend = this.detectVolatilityTrend(candles);

    return {
      volatility_score: volatilityScore,
      atr_compression: atrCompression,
      atr_expansion: atrExpansion,
      wick_risk_level: wickRisk,
      spread_risk: spreadRisk,
      avg_wick_size: avgWickSize,
      volatility_trend: volatilityTrend
    };
  }

  /**
   * C. TREND & STRUCTURE REGIME DETECTION
   */
  private detectTrendStructureRegime(
    marketState: MarketState,
    candles: Candle[]
  ): TrendStructureRegime {
    const emaDiff = Math.abs(marketState.ema20 - marketState.ema50);
    const trendStrength = Math.min(100, Math.round((emaDiff / marketState.atr) * 20));

    const emaAlignment = this.detectEMAAlignment(marketState);
    const marketBias = this.detectMarketBias(marketState);

    const structureType = this.detectStructureType(trendStrength, candles, marketState);

    const structureQuality = this.assessStructureQuality(candles);

    return {
      trend_strength_score: trendStrength,
      structure_type: structureType,
      market_bias: marketBias,
      ema_alignment: emaAlignment,
      structure_quality: structureQuality
    };
  }

  /**
   * D. SAFETY FLAGS COMPUTATION
   *
   * UPDATED: Dead zone is now a RISK MODIFIER, not a trade blocker.
   * Alpha has final authority - no rule-based system may block trades.
   *
   * SSOT COMPLIANCE:
   * - Session weight delegated to sessionConstraintCoordinator
   * - 24/7 markets automatically exempt from session logic
   * - NO hardcoded symbol checks
   */
  private computeSafetyFlags(
    time: TimeRegime,
    volatility: VolatilityRegime,
    trend: TrendStructureRegime,
    symbol?: string,
    timestamp?: Date
  ): SafetyFlags {
    let avoidTrading = false;
    let isHighRisk = false;
    let riskFactor = 1.0;
    let reason: string | undefined;
    let sessionWeight = 1.0;
    let deadZoneActive = false;

    // Dead zone is now a risk factor, not a trade blocker
    if (time.is_dead_zone) {
      deadZoneActive = true;

      // Get symbol-specific session weight via coordinator (SSOT)
      if (symbol && timestamp) {
        // Check if this symbol requires session constraints
        if (sessionConstraintCoordinator.shouldApplySessionWeight(symbol)) {
          sessionWeight = sessionConstraintCoordinator.getSessionWeight({
            symbol,
            hour: timestamp.getUTCHours(),
            session: time.session
          });
          riskFactor = Math.min(riskFactor, sessionWeight);

          if (sessionWeight < 1.0) {
            isHighRisk = true;
            reason = reason || `Low liquidity period (${(sessionWeight * 100).toFixed(0)}% confidence)`;
          }
        } else {
          // 24/7 market - no session penalty
          console.log(`[Regime Oracle] ${symbol} is 24/7 market - no dead zone penalty applied`);
        }
      } else {
        // Default dead zone penalty if symbol not provided
        isHighRisk = true;
        riskFactor = Math.min(riskFactor, 0.65);
        reason = reason || 'Low liquidity period (21:00-00:00 UTC)';
      }
    }

    if (volatility.volatility_score < 15) {
      avoidTrading = true;
      reason = 'Dead market (extremely low volatility)';
    }

    if (volatility.volatility_score > 90) {
      avoidTrading = true;
      reason = 'Extreme volatility (stops unreliable)';
    }

    // FIXED: Only HIGH wick risk blocks trades, medium just reduces size
    if (volatility.wick_risk_level === 'high') {
      avoidTrading = true;
      reason = 'High wick risk (SL hunting probable - multiple extreme wicks detected)';
    }

    if (volatility.spread_risk === 'high') {
      avoidTrading = true;
      reason = 'High spread risk (execution unreliable)';
    }

    // Only block if BOTH compression AND ranging (true dead market)
    if (volatility.atr_compression && trend.structure_type === 'range' && volatility.volatility_score < 25) {
      avoidTrading = true;
      reason = 'ATR compression + range structure + dead conditions';
    }

    if (time.is_ny_open && volatility.volatility_score > 75) {
      isHighRisk = true;
      riskFactor = 0.75;
      reason = reason || 'NY open with high volatility';
    }

    if (volatility.volatility_score > 80 && !avoidTrading) {
      isHighRisk = true;
      riskFactor = 0.5;
      reason = reason || 'High volatility regime';
    }

    // FIXED: Medium wick risk = slight reduction, not blocking
    if (volatility.wick_risk_level === 'medium' && !avoidTrading) {
      isHighRisk = true;
      riskFactor = Math.min(riskFactor, 0.85); // Reduced from 0.75 to 0.85
      reason = reason || 'Elevated wick activity (monitor stops)';
    }

    console.log(`[Safety Flags] avoid=${avoidTrading}, highRisk=${isHighRisk}, riskFactor=${riskFactor}, sessionWeight=${sessionWeight.toFixed(2)}, reason=${reason || 'none'}`);

    return {
      is_high_risk_regime: isHighRisk,
      avoid_trading: avoidTrading, // DEPRECATED - kept for backward compatibility
      risk_reduction_factor: riskFactor,
      reason,
      session_weight: sessionWeight,
      dead_zone_active: deadZoneActive
    };
  }

  /**
   * DEPRECATED: Get symbol-specific session weight
   *
   * This method has been moved to sessionConstraintCoordinator (SSOT).
   * Kept for backward compatibility during transition.
   *
   * @deprecated Use sessionConstraintCoordinator.getSessionWeight() instead
   */
  private getSymbolSessionWeight(symbol: string, hour: number): number {
    console.warn('[Regime Oracle] getSymbolSessionWeight is DEPRECATED - use sessionConstraintCoordinator.getSessionWeight()');
    return sessionConstraintCoordinator.getSessionWeight({
      symbol,
      hour,
      session: hour >= 13 && hour < 21 ? 'ny' : hour >= 8 && hour < 16 ? 'london' : hour < 8 ? 'asian' : 'dead'
    });
  }

  /**
   * Helper: Compute 20-period ATR average
   */
  private compute20PeriodATRAvg(candles: Candle[]): number {
    const recent = candles.slice(-20);
    const atrs = recent.map(c => c.high - c.low);
    return atrs.reduce((sum, atr) => sum + atr, 0) / atrs.length;
  }

  /**
   * Helper: Compute wick risk
   *
   * FIXED: Now uses ATR-relative measurements and realistic thresholds
   * to avoid blocking trades during normal market consolidation.
   */
  private computeWickRisk(candles: Candle[]): 'low' | 'medium' | 'high' {
    const recent = candles.slice(-10);
    if (recent.length < 5) return 'medium';

    // Calculate ATR for context
    const atr = this.compute20PeriodATRAvg(candles);
    if (atr === 0) return 'medium';

    // Method 1: Wick-to-Range ratio (more stable than wick-to-body)
    const avgWickToRangeRatio = recent.map(c => {
      const range = c.high - c.low;
      if (range === 0) return 0;

      const upperWick = c.high - Math.max(c.open, c.close);
      const lowerWick = Math.min(c.open, c.close) - c.low;
      const totalWick = upperWick + lowerWick;

      return totalWick / range;
    }).reduce((sum, r) => sum + r, 0) / recent.length;

    // Method 2: Absolute wick size relative to ATR
    const avgWickSizeVsATR = recent.map(c => {
      const upperWick = c.high - Math.max(c.open, c.close);
      const lowerWick = Math.min(c.open, c.close) - c.low;
      const maxWick = Math.max(upperWick, lowerWick);
      return maxWick / atr;
    }).reduce((sum, r) => sum + r, 0) / recent.length;

    // Count extreme wick candles (individual candles with very large wicks)
    const extremeWickCount = recent.filter(c => {
      const range = c.high - c.low;
      if (range === 0) return false;

      const upperWick = c.high - Math.max(c.open, c.close);
      const lowerWick = Math.min(c.open, c.close) - c.low;
      const maxWick = Math.max(upperWick, lowerWick);

      // Extreme = wick is >80% of total range
      return (maxWick / range) > 0.8;
    }).length;

    // DEBUG LOGGING
    console.log(`[Wick Risk] Wick/Range ratio: ${avgWickToRangeRatio.toFixed(2)}, Wick/ATR: ${avgWickSizeVsATR.toFixed(2)}, Extreme wicks: ${extremeWickCount}/10`);

    // REALISTIC THRESHOLDS:
    // High risk = Multiple extreme wicks OR consistently huge wicks relative to ATR
    if (extremeWickCount >= 4 || avgWickSizeVsATR > 1.5) {
      console.log(`[Wick Risk] 🔴 HIGH - SL hunting probable`);
      return 'high';
    }

    // Medium risk = Some extreme wicks OR large wicks relative to ATR
    if (extremeWickCount >= 2 || avgWickSizeVsATR > 1.0 || avgWickToRangeRatio > 0.7) {
      console.log(`[Wick Risk] 🟡 MEDIUM - Monitor stops closely`);
      return 'medium';
    }

    console.log(`[Wick Risk] 🟢 LOW - Normal wick activity`);
    return 'low';
  }

  /**
   * Helper: Compute average wick size
   */
  private computeAvgWickSize(candles: Candle[]): number {
    const recent = candles.slice(-10);
    const wicks = recent.map(c => {
      const upperWick = c.high - Math.max(c.open, c.close);
      const lowerWick = Math.min(c.open, c.close) - c.low;
      return upperWick + lowerWick;
    });
    return wicks.reduce((sum, w) => sum + w, 0) / wicks.length;
  }

  /**
   * Helper: Estimate spread risk
   */
  private estimateSpreadRisk(volatilityScore: number): 'low' | 'medium' | 'high' {
    if (volatilityScore > 85) return 'high';
    if (volatilityScore < 20) return 'high';
    if (volatilityScore > 70) return 'medium';
    return 'low';
  }

  /**
   * Helper: Detect volatility trend
   */
  private detectVolatilityTrend(candles: Candle[]): 'rising' | 'falling' | 'stable' {
    if (candles.length < 30) return 'stable';

    const recent10 = candles.slice(-10);
    const previous10 = candles.slice(-20, -10);

    const recentATR = recent10.map(c => c.high - c.low).reduce((sum, r) => sum + r, 0) / 10;
    const prevATR = previous10.map(c => c.high - c.low).reduce((sum, r) => sum + r, 0) / 10;

    const change = (recentATR - prevATR) / prevATR;

    if (change > 0.15) return 'rising';
    if (change < -0.15) return 'falling';
    return 'stable';
  }

  /**
   * Helper: Detect EMA alignment
   */
  private detectEMAAlignment(state: MarketState): 'bullish' | 'bearish' | 'mixed' {
    if (state.ema20 > state.ema50 && state.ema50 > state.ema200) {
      return 'bullish';
    }
    if (state.ema20 < state.ema50 && state.ema50 < state.ema200) {
      return 'bearish';
    }
    return 'mixed';
  }

  /**
   * Helper: Detect market bias
   */
  private detectMarketBias(state: MarketState): 'bull' | 'bear' | 'sideways' {
    if (state.ema20 > state.ema50 && state.ema50 > state.ema200 && state.price > state.ema20) {
      return 'bull';
    }
    if (state.ema20 < state.ema50 && state.ema50 < state.ema200 && state.price < state.ema20) {
      return 'bear';
    }
    return 'sideways';
  }

  /**
   * Helper: Detect structure type
   */
  private detectStructureType(
    trendStrength: number,
    candles: Candle[],
    state: MarketState
  ): 'trend' | 'range' | 'accumulation' | 'distribution' {
    if (trendStrength > 50) {
      return 'trend';
    }

    // CRITICAL FIX: Add null/undefined check before accessing .length
    if (!candles || candles.length < 20) {
      return 'range';
    }

    const volumeTrend = this.detectVolumeTrend(candles);

    if (trendStrength < 30) {
      if (volumeTrend === 'rising') {
        return 'accumulation';
      }
      if (volumeTrend === 'falling') {
        return 'distribution';
      }
      return 'range';
    }

    return 'trend';
  }

  /**
   * Helper: Detect volume trend
   */
  private detectVolumeTrend(candles: Candle[]): 'rising' | 'falling' | 'stable' {
    const withVolume = candles.filter(c => c.volume && c.volume > 0);

    if (withVolume.length < 20) {
      return 'stable';
    }

    const recent10 = withVolume.slice(-10);
    const previous10 = withVolume.slice(-20, -10);

    const recentAvg = recent10.reduce((sum, c) => sum + (c.volume || 0), 0) / 10;
    const prevAvg = previous10.reduce((sum, c) => sum + (c.volume || 0), 0) / 10;

    const change = (recentAvg - prevAvg) / prevAvg;

    if (change > 0.2) return 'rising';
    if (change < -0.2) return 'falling';
    return 'stable';
  }

  /**
   * Helper: Assess structure quality
   */
  private assessStructureQuality(candles: Candle[]): 'clean' | 'choppy' {
    if (candles.length < 20) return 'choppy';

    const recent = candles.slice(-20);
    let directionChanges = 0;

    for (let i = 1; i < recent.length; i++) {
      const prevDirection = recent[i - 1].close > recent[i - 1].open ? 'up' : 'down';
      const currDirection = recent[i].close > recent[i].open ? 'up' : 'down';

      if (prevDirection !== currDirection) {
        directionChanges++;
      }
    }

    const choppiness = directionChanges / recent.length;
    return choppiness > 0.6 ? 'choppy' : 'clean';
  }

  /**
   * Default volatility regime when insufficient data
   */
  private getDefaultVolatilityRegime(): VolatilityRegime {
    return {
      volatility_score: 50,
      atr_compression: false,
      atr_expansion: false,
      wick_risk_level: 'medium',
      spread_risk: 'medium',
      avg_wick_size: 0,
      volatility_trend: 'stable'
    };
  }
}

export const regimeOracle = new RegimeOracle();
