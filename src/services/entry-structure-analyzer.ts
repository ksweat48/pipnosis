/**
 * Entry Structure Analyzer - SSOT Authority for Structural Entry Validation
 *
 * RESPONSIBILITY:
 * Determines whether Alpha's entry price is at a structurally sound level
 * (support for buys, resistance for sells) or if the user should wait
 * for a pullback to a better entry.
 *
 * TWO VERDICTS:
 * 1. OPTIMAL_ENTRY - Entry aligns with key S/R level. Enter now.
 * 2. WAIT_FOR_PULLBACK - Entry is not at S/R. Wait for pullback to target.
 *
 * SSOT COMPLIANCE:
 * - Uses CriticalLevelDetector as the SINGLE source for S/R detection
 * - Uses getCurrencyPipInfo as the SINGLE source for pip calculations
 * - No duplicate S/R logic - delegates entirely to CriticalLevelDetector
 *
 * CCIP COMPLIANCE:
 * - No database mutations - pure analysis function
 * - Deterministic output for same inputs
 * - Complete audit trail in returned result
 */

import { criticalLevelDetector } from './critical-level-detector';
import { getCurrencyPipInfo } from '../utils/currencyHelpers';
import { logger } from '../lib/logger';
import type { Candle } from '../types';

export type StructuralVerdict = 'OPTIMAL_ENTRY' | 'WAIT_FOR_PULLBACK';

export interface StructuralLevel {
  price: number;
  type: 'support' | 'resistance';
  strength: number;
  touches: number;
  reason: string;
}

export interface StructuralAnalysisResult {
  verdict: StructuralVerdict;
  backingLevel: StructuralLevel | null;
  pullbackTarget: number | null;
  pullbackImprovementPips: number;
  drawdownReductionEstimate: number;
  distanceFromLevelPips: number;
  allRelevantLevels: StructuralLevel[];
  reasoning: string;
  analyzedAt: string;
}

interface AnalysisInput {
  entryPrice: number;
  direction: 'long' | 'short';
  symbol: string;
  candles: Candle[];
  atrValue: number;
  stopLoss: number;
  takeProfit: number;
}

const ATR_PROXIMITY_THRESHOLD = 0.5;

class EntryStructureAnalyzer {

  analyze(input: AnalysisInput): StructuralAnalysisResult {
    const { entryPrice, direction, symbol, candles, atrValue, stopLoss, takeProfit } = input;
    const pipInfo = getCurrencyPipInfo(symbol);

    if (!candles || candles.length < 20 || !atrValue || atrValue <= 0) {
      return this.buildFallbackResult(entryPrice, direction, symbol);
    }

    const criticalLevels = criticalLevelDetector.detectCriticalLevels(
      candles,
      entryPrice,
      direction
    );

    const relevantLevels = this.filterRelevantLevels(criticalLevels, entryPrice, direction);

    if (relevantLevels.length === 0) {
      return this.buildFallbackResult(entryPrice, direction, symbol);
    }

    const nearestLevel = this.findNearestRelevantLevel(relevantLevels, entryPrice, direction);

    if (!nearestLevel) {
      return this.buildFallbackResult(entryPrice, direction, symbol);
    }

    const distanceFromLevel = Math.abs(entryPrice - nearestLevel.price);
    const distanceFromLevelPips = distanceFromLevel / pipInfo.pipValue;
    const distanceInATR = distanceFromLevel / atrValue;

    const isAtLevel = distanceInATR <= ATR_PROXIMITY_THRESHOLD;

    if (isAtLevel) {
      return this.buildOptimalResult(nearestLevel, distanceFromLevelPips, relevantLevels, direction, symbol);
    }

    const pullbackTarget = this.calculatePullbackTarget(nearestLevel, entryPrice, direction, atrValue);
    const improvementPips = Math.abs(entryPrice - pullbackTarget) / pipInfo.pipValue;
    const drawdownReduction = improvementPips;

    return this.buildPullbackResult(
      nearestLevel,
      pullbackTarget,
      improvementPips,
      drawdownReduction,
      distanceFromLevelPips,
      relevantLevels,
      direction,
      symbol
    );
  }

  private filterRelevantLevels(
    levels: Array<{ price: number; type: 'support' | 'resistance'; strength: number; touches: number; reason: string }>,
    entryPrice: number,
    direction: 'long' | 'short'
  ): StructuralLevel[] {
    return levels.filter(level => {
      if (direction === 'long') {
        return level.type === 'support' && level.price <= entryPrice * 1.005;
      } else {
        return level.type === 'resistance' && level.price >= entryPrice * 0.995;
      }
    }).map(l => ({
      price: l.price,
      type: l.type,
      strength: l.strength,
      touches: l.touches,
      reason: l.reason
    }));
  }

  private findNearestRelevantLevel(
    levels: StructuralLevel[],
    entryPrice: number,
    direction: 'long' | 'short'
  ): StructuralLevel | null {
    if (levels.length === 0) return null;

    const sorted = [...levels].sort((a, b) => {
      const distA = Math.abs(a.price - entryPrice);
      const distB = Math.abs(b.price - entryPrice);
      if (Math.abs(distA - distB) < 0.0001) {
        return b.strength - a.strength;
      }
      return distA - distB;
    });

    return sorted[0];
  }

  private calculatePullbackTarget(
    level: StructuralLevel,
    entryPrice: number,
    direction: 'long' | 'short',
    atrValue: number
  ): number {
    const buffer = atrValue * 0.1;

    if (direction === 'long') {
      return level.price + buffer;
    } else {
      return level.price - buffer;
    }
  }

  private buildOptimalResult(
    backingLevel: StructuralLevel,
    distanceFromLevelPips: number,
    allLevels: StructuralLevel[],
    direction: 'long' | 'short',
    symbol: string
  ): StructuralAnalysisResult {
    const levelLabel = direction === 'long' ? 'support' : 'resistance';
    const strengthLabel = backingLevel.strength >= 0.7 ? 'strong' : backingLevel.strength >= 0.5 ? 'moderate' : 'developing';

    const reasoning = `Entry aligns with ${strengthLabel} ${levelLabel} at ${backingLevel.price.toFixed(this.getDecimalPlaces(symbol))} (tested ${backingLevel.touches} times, ${distanceFromLevelPips.toFixed(1)} pips away). This is a structurally backed entry.`;

    logger.info('[EntryStructureAnalyzer] OPTIMAL_ENTRY verdict', {
      symbol, direction, levelPrice: backingLevel.price,
      strength: backingLevel.strength, touches: backingLevel.touches,
      distancePips: distanceFromLevelPips
    });

    return {
      verdict: 'OPTIMAL_ENTRY',
      backingLevel,
      pullbackTarget: null,
      pullbackImprovementPips: 0,
      drawdownReductionEstimate: 0,
      distanceFromLevelPips,
      allRelevantLevels: allLevels,
      reasoning,
      analyzedAt: new Date().toISOString()
    };
  }

  private buildPullbackResult(
    nearestLevel: StructuralLevel,
    pullbackTarget: number,
    improvementPips: number,
    drawdownReduction: number,
    distanceFromLevelPips: number,
    allLevels: StructuralLevel[],
    direction: 'long' | 'short',
    symbol: string
  ): StructuralAnalysisResult {
    const levelLabel = direction === 'long' ? 'support' : 'resistance';
    const actionLabel = direction === 'long' ? 'pullback' : 'rally';
    const decimals = this.getDecimalPlaces(symbol);

    const reasoning = `Entry is ${distanceFromLevelPips.toFixed(1)} pips from nearest ${levelLabel} at ${nearestLevel.price.toFixed(decimals)}. Wait for ${actionLabel} to ${pullbackTarget.toFixed(decimals)} for ${improvementPips.toFixed(1)} pips improvement and less drawdown.`;

    logger.info('[EntryStructureAnalyzer] WAIT_FOR_PULLBACK verdict', {
      symbol, direction, levelPrice: nearestLevel.price,
      pullbackTarget, improvementPips, distancePips: distanceFromLevelPips
    });

    return {
      verdict: 'WAIT_FOR_PULLBACK',
      backingLevel: nearestLevel,
      pullbackTarget,
      pullbackImprovementPips: improvementPips,
      drawdownReductionEstimate: drawdownReduction,
      distanceFromLevelPips,
      allRelevantLevels: allLevels,
      reasoning,
      analyzedAt: new Date().toISOString()
    };
  }

  private buildFallbackResult(
    entryPrice: number,
    direction: 'long' | 'short',
    symbol: string
  ): StructuralAnalysisResult {
    logger.warn('[EntryStructureAnalyzer] Insufficient data for structural analysis, defaulting to neutral', {
      symbol, direction
    });

    return {
      verdict: 'OPTIMAL_ENTRY',
      backingLevel: null,
      pullbackTarget: null,
      pullbackImprovementPips: 0,
      drawdownReductionEstimate: 0,
      distanceFromLevelPips: 0,
      allRelevantLevels: [],
      reasoning: 'Insufficient candle data for structural analysis. Entry advisory based on Alpha confidence only.',
      analyzedAt: new Date().toISOString()
    };
  }

  private getDecimalPlaces(symbol: string): number {
    const s = symbol.toUpperCase();
    if (s.includes('JPY')) return 3;
    if (s === 'XAUUSD') return 2;
    if (s === 'XAGUSD') return 4;
    if (s.includes('BTC') || s.includes('ETH')) return 2;
    if (s === 'US30' || s === 'SPX500' || s === 'NAS100') return 1;
    return 5;
  }
}

export const entryStructureAnalyzer = new EntryStructureAnalyzer();
