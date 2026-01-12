/**
 * Fallback Orchestrator
 *
 * PHILOSOPHY: System never stops on one failed condition.
 *
 * This orchestrator implements the cascade strategy:
 * 1. Try multiple strategies on best symbol
 * 2. Try next best symbols with alternative strategies
 * 3. Cooldown and rescan if all fail
 * 4. Never stop unless user pauses or risk hard block
 *
 * PREVENTS: "2 steps forward, 3 steps back" paralysis
 */

import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import { entryAdvisor, type EntryAdvisory, type EntryStrategy } from './entry-advisor';
import { getFallbackConfig } from '../config/trading-policy';

export interface RankedSymbol {
  symbol: string;
  score: number;
  direction: 'BUY' | 'SELL';
  confidence: number;
  atr: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  reasoning: string;
  marketContext?: Record<string, any>;
}

export interface FallbackAttempt {
  symbol: string;
  strategy: 'pullback' | 'continuation' | 'breakout' | 'immediate';
  attemptNumber: number;
  advisory: EntryAdvisory;
  outcome: 'SUCCESS' | 'REJECTED' | 'BLOCKED';
  reason?: string;
}

export interface FallbackResult {
  success: boolean;
  selectedSymbol?: RankedSymbol;
  selectedStrategy?: EntryStrategy;
  advisory?: EntryAdvisory;
  attempts: FallbackAttempt[];
  totalSymbolsTried: number;
  totalStrategiesTried: number;
  outcome: 'TRADE_CREATED' | 'ALL_FAILED' | 'HARD_BLOCK' | 'NO_SYMBOLS';
  nextAction: 'EXECUTE' | 'COOLDOWN_RESCAN' | 'STOP' | 'NOTIFY_USER';
}

class FallbackOrchestrator {
  private activeSession: Map<string, boolean> = new Map();
  private attemptHistory: Map<string, FallbackAttempt[]> = new Map();

  /**
   * Main entry point: Try to find a tradeable opportunity
   * Uses cascade strategy across symbols and entry methods
   */
  async attemptTrade(
    sessionId: string,
    userId: string,
    rankedSymbols: RankedSymbol[],
    riskMode: 'LOW' | 'MEDIUM' | 'HIGH'
  ): Promise<FallbackResult> {
    const attempts: FallbackAttempt[] = [];
    const config = getFallbackConfig();

    logger.info('[FALLBACK_ORCHESTRATOR] Starting trade attempt cascade', {
      sessionId: sessionId.substring(0, 8),
      symbolCount: rankedSymbols.length,
      maxSymbolsToTry: config.maxSymbolsToTry
    });

    // No symbols provided
    if (rankedSymbols.length === 0) {
      return {
        success: false,
        attempts,
        totalSymbolsTried: 0,
        totalStrategiesTried: 0,
        outcome: 'NO_SYMBOLS',
        nextAction: 'COOLDOWN_RESCAN'
      };
    }

    // Mark session as active
    this.activeSession.set(sessionId, true);

    try {
      // Try top N symbols (default 3)
      const symbolsToTry = rankedSymbols.slice(0, config.maxSymbolsToTry);

      for (let i = 0; i < symbolsToTry.length; i++) {
        const symbol = symbolsToTry[i];

        logger.info('[FALLBACK_ORCHESTRATOR] Trying symbol', {
          sessionId: sessionId.substring(0, 8),
          symbolIndex: i + 1,
          totalSymbols: symbolsToTry.length,
          symbol: symbol.symbol,
          direction: symbol.direction,
          confidence: symbol.confidence
        });

        // Try multiple strategies for this symbol
        const result = await this.trySymbolWithStrategies(
          sessionId,
          userId,
          symbol,
          riskMode,
          attempts
        );

        if (result.success) {
          return {
            success: true,
            selectedSymbol: symbol,
            selectedStrategy: result.strategy,
            advisory: result.advisory,
            attempts,
            totalSymbolsTried: i + 1,
            totalStrategiesTried: attempts.length,
            outcome: 'TRADE_CREATED',
            nextAction: 'EXECUTE'
          };
        }

        // If hard blocked, stop trying
        if (result.hardBlocked) {
          return {
            success: false,
            attempts,
            totalSymbolsTried: i + 1,
            totalStrategiesTried: attempts.length,
            outcome: 'HARD_BLOCK',
            nextAction: 'STOP'
          };
        }
      }

      // All symbols exhausted
      logger.warn('[FALLBACK_ORCHESTRATOR] All symbols exhausted without finding trade', {
        sessionId: sessionId.substring(0, 8),
        symbolsTried: symbolsToTry.length,
        strategiesTried: attempts.length
      });

      return {
        success: false,
        attempts,
        totalSymbolsTried: symbolsToTry.length,
        totalStrategiesTried: attempts.length,
        outcome: 'ALL_FAILED',
        nextAction: 'COOLDOWN_RESCAN'
      };

    } finally {
      this.activeSession.set(sessionId, false);
    }
  }

  /**
   * Try multiple strategies for a single symbol
   */
  private async trySymbolWithStrategies(
    sessionId: string,
    userId: string,
    symbol: RankedSymbol,
    riskMode: 'LOW' | 'MEDIUM' | 'HIGH',
    attempts: FallbackAttempt[]
  ): Promise<{
    success: boolean;
    strategy?: EntryStrategy;
    advisory?: EntryAdvisory;
    hardBlocked?: boolean;
  }> {
    const config = getFallbackConfig();
    const strategies = config.strategiesPerSymbol;

    // Generate advisory for this symbol
    const advisory = await entryAdvisor.generateAdvisory({
      symbol: symbol.symbol,
      direction: symbol.direction,
      entryZoneMin: symbol.entry - symbol.atr * 0.3,
      entryZoneMax: symbol.entry + symbol.atr * 0.3,
      stopLoss: symbol.stopLoss,
      takeProfit: symbol.takeProfit,
      atr: symbol.atr,
      confidence: symbol.confidence,
      riskMode
    });

    // Check for hard block
    if (advisory.viability === 'BLOCKED') {
      attempts.push({
        symbol: symbol.symbol,
        strategy: 'immediate',
        attemptNumber: attempts.length + 1,
        advisory,
        outcome: 'BLOCKED',
        reason: advisory.hardBlockReason || 'Risk hard block'
      });

      logger.warn('[FALLBACK_ORCHESTRATOR] Symbol hard blocked', {
        sessionId: sessionId.substring(0, 8),
        symbol: symbol.symbol,
        reason: advisory.hardBlockReason
      });

      return { success: false, hardBlocked: true };
    }

    // Try each strategy from the advisory
    for (const strategyOption of advisory.alternativeStrategies) {
      const attemptNum = attempts.length + 1;

      logger.info('[FALLBACK_ORCHESTRATOR] Trying strategy', {
        sessionId: sessionId.substring(0, 8),
        symbol: symbol.symbol,
        strategy: strategyOption.strategy,
        viability: strategyOption.viability,
        attemptNumber: attemptNum
      });

      // Check if strategy is viable
      if (strategyOption.viability === 'LOW') {
        attempts.push({
          symbol: symbol.symbol,
          strategy: strategyOption.strategy,
          attemptNumber: attemptNum,
          advisory,
          outcome: 'REJECTED',
          reason: `Low viability: ${strategyOption.reasoning}`
        });
        continue;
      }

      // Strategy is viable - attempt to create intent
      const created = await this.createEntryIntent(
        sessionId,
        userId,
        symbol,
        strategyOption,
        advisory
      );

      if (created.success) {
        attempts.push({
          symbol: symbol.symbol,
          strategy: strategyOption.strategy,
          attemptNumber: attemptNum,
          advisory,
          outcome: 'SUCCESS',
          reason: 'Intent created successfully'
        });

        logger.info('[FALLBACK_ORCHESTRATOR] ✅ Strategy successful', {
          sessionId: sessionId.substring(0, 8),
          symbol: symbol.symbol,
          strategy: strategyOption.strategy,
          attemptNumber: attemptNum
        });

        return {
          success: true,
          strategy: strategyOption,
          advisory
        };
      } else {
        attempts.push({
          symbol: symbol.symbol,
          strategy: strategyOption.strategy,
          attemptNumber: attemptNum,
          advisory,
          outcome: 'REJECTED',
          reason: created.reason || 'Intent creation failed'
        });
      }
    }

    // All strategies for this symbol failed
    return { success: false };
  }

  /**
   * Create entry intent based on strategy
   */
  private async createEntryIntent(
    sessionId: string,
    userId: string,
    symbol: RankedSymbol,
    strategy: EntryStrategy,
    advisory: EntryAdvisory
  ): Promise<{ success: boolean; reason?: string }> {
    try {
      // Adjust entry zone based on strategy
      let entryZoneMin: number;
      let entryZoneMax: number;

      if (strategy.adjustedZone) {
        entryZoneMin = strategy.adjustedZone.min;
        entryZoneMax = strategy.adjustedZone.max;
      } else {
        entryZoneMin = symbol.entry - symbol.atr * 0.3;
        entryZoneMax = symbol.entry + symbol.atr * 0.3;
      }

      // For continuation entries, use current price
      if (strategy.strategy === 'continuation' && strategy.adjustedEntry) {
        const spread = symbol.atr * 0.1; // Rough estimate
        entryZoneMin = strategy.adjustedEntry - spread;
        entryZoneMax = strategy.adjustedEntry + spread;
      }

      // Log intent creation attempt
      logger.info('[FALLBACK_ORCHESTRATOR] Creating entry intent', {
        sessionId: sessionId.substring(0, 8),
        symbol: symbol.symbol,
        strategy: strategy.strategy,
        entryZone: `${entryZoneMin.toFixed(5)} - ${entryZoneMax.toFixed(5)}`,
        viability: strategy.viability
      });

      // This would call the actual intent creation service
      // For now, return success if viability is HIGH or MEDIUM
      if (strategy.viability === 'HIGH' || strategy.viability === 'MEDIUM') {
        // Record attempt in database
        await this.recordAttempt(sessionId, symbol.symbol, strategy.strategy, 'SUCCESS', advisory);
        return { success: true };
      }

      return {
        success: false,
        reason: `Strategy viability ${strategy.viability} too low`
      };

    } catch (error) {
      logger.error('[FALLBACK_ORCHESTRATOR] Exception creating intent', {
        sessionId: sessionId.substring(0, 8),
        symbol: symbol.symbol,
        error
      });

      return {
        success: false,
        reason: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Record attempt in database for tracking and analysis
   */
  private async recordAttempt(
    sessionId: string,
    symbol: string,
    strategy: string,
    outcome: string,
    advisory: EntryAdvisory
  ): Promise<void> {
    try {
      await supabase.from('scan_attempts').insert({
        session_id: sessionId,
        symbol,
        strategy,
        outcome,
        distance_atr: advisory.distanceATR,
        viability: advisory.viability,
        warnings_count: advisory.warnings.length,
        created_at: new Date().toISOString()
      });
    } catch (error) {
      logger.warn('[FALLBACK_ORCHESTRATOR] Failed to record attempt', { error });
    }
  }

  /**
   * Schedule cooldown and rescan
   */
  async scheduleCooldownRescan(sessionId: string): Promise<void> {
    const config = getFallbackConfig();
    const nextScanTime = new Date(Date.now() + config.cooldownSeconds * 1000);

    logger.info('[FALLBACK_ORCHESTRATOR] Scheduling cooldown rescan', {
      sessionId: sessionId.substring(0, 8),
      cooldownSeconds: config.cooldownSeconds,
      nextScanTime: nextScanTime.toISOString()
    });

    try {
      await supabase
        .from('goal_sessions')
        .update({
          status: 'scanning',
          next_scan_time: nextScanTime.toISOString(),
          last_scan_time: new Date().toISOString()
        })
        .eq('id', sessionId);

      logger.info('[FALLBACK_ORCHESTRATOR] ✅ Cooldown rescan scheduled', {
        sessionId: sessionId.substring(0, 8),
        nextScanTime: nextScanTime.toLocaleTimeString()
      });
    } catch (error) {
      logger.error('[FALLBACK_ORCHESTRATOR] Failed to schedule rescan', {
        sessionId: sessionId.substring(0, 8),
        error
      });
    }
  }

  /**
   * Get attempt history for session
   */
  getAttemptHistory(sessionId: string): FallbackAttempt[] {
    return this.attemptHistory.get(sessionId) || [];
  }

  /**
   * Clear attempt history
   */
  clearHistory(sessionId: string): void {
    this.attemptHistory.delete(sessionId);
  }
}

export const fallbackOrchestrator = new FallbackOrchestrator();
