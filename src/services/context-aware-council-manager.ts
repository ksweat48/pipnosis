import { logger } from '../lib/logger';
import { alphaOmegaOrchestrator, type FullMarketState } from './alpha-omega-orchestrator';
import { councilContextService } from './council-context-service';
import { alphaScoutService } from './alpha-scout-service';
import type { TraderScore } from './ai-identity';
import type { AlphaDecision } from '../brains/coordinator-alpha';
import type { GoalContext } from '../brains/coordinator-alpha';

export interface CouncilManagerResult {
  decisions: Map<string, AlphaDecision>;
  mode: 'full_council' | 'alpha_scout';
  scout_cycles?: number;
  improvement_score?: number;
  reasoning: string;
  llm_cost_saved: boolean;
}

class ContextAwareCouncilManager {
  async evaluateSymbols(
    userId: string,
    sessionId: string,
    marketStates: FullMarketState[],
    traderScore: TraderScore,
    goalContext?: GoalContext
  ): Promise<CouncilManagerResult> {
    try {
      logger.info('[CouncilManager] Starting context-aware evaluation', {
        user_id: userId,
        session_id: sessionId,
        symbols: marketStates.map(s => s.symbol),
      });

      const existingContext = await councilContextService.getLatestContext(userId, sessionId);

      if (!existingContext) {
        logger.info('[CouncilManager] No context - running full council (first scan)');
        return await this.runFullCouncil(
          userId,
          sessionId,
          marketStates,
          traderScore,
          goalContext,
          'First scan - establishing baseline'
        );
      }

      const shouldForceRefresh = councilContextService.shouldForceRefresh(existingContext);
      if (shouldForceRefresh) {
        logger.info('[CouncilManager] Context stale - running full council (refresh)');
        return await this.runFullCouncil(
          userId,
          sessionId,
          marketStates,
          traderScore,
          goalContext,
          'Context refresh - time-based or max cycles reached'
        );
      }

      const currentSnapshot = this.buildCurrentSnapshot(marketStates);

      const scoutDecision = await alphaScoutService.performScout(
        userId,
        sessionId,
        currentSnapshot
      );

      logger.info('[CouncilManager] Alpha Scout decision', {
        should_reconvene: scoutDecision.should_reconvene,
        improvement_score: scoutDecision.improvement_score,
        scout_cycles: (existingContext.scout_cycles || 0) + 1,
      });

      if (scoutDecision.should_reconvene) {
        logger.info('[CouncilManager] Alpha Scout triggered reconvene - running full council');
        return await this.runFullCouncil(
          userId,
          sessionId,
          marketStates,
          traderScore,
          goalContext,
          scoutDecision.reasoning
        );
      }

      logger.info('[CouncilManager] Alpha Scout: No reconvene needed', {
        improvement_score: scoutDecision.improvement_score,
        reasoning: scoutDecision.reasoning,
      });

      const noTradeDecisions = new Map<string, AlphaDecision>();
      for (const marketState of marketStates) {
        noTradeDecisions.set(marketState.symbol, {
          action: 'NO_TRADE' as const,
          decision: 'NO_TRADE' as const,
          entry: marketState.price,
          stopLoss: marketState.price,
          takeProfit: marketState.price,
          confidence: existingContext.confidence,
          reasoning: `Alpha Scout: ${scoutDecision.reasoning}`,
          omega_summary: `Scout cycle ${(existingContext.scout_cycles || 0) + 1}: ${scoutDecision.improvement_score}% improvement`,
        });
      }

      return {
        decisions: noTradeDecisions,
        mode: 'alpha_scout',
        scout_cycles: (existingContext.scout_cycles || 0) + 1,
        improvement_score: scoutDecision.improvement_score,
        reasoning: scoutDecision.reasoning,
        llm_cost_saved: true,
      };
    } catch (error) {
      logger.error('[CouncilManager] Exception in context-aware evaluation', { error });
      return await this.runFullCouncil(
        userId,
        sessionId,
        marketStates,
        traderScore,
        goalContext,
        'Error in scout - defaulting to full council'
      );
    }
  }

  private async runFullCouncil(
    userId: string,
    sessionId: string,
    marketStates: FullMarketState[],
    traderScore: TraderScore,
    goalContext?: GoalContext,
    reason?: string
  ): Promise<CouncilManagerResult> {
    logger.info('[CouncilManager] Running full Omega Council', {
      symbols: marketStates.map(s => s.symbol),
      reason,
    });

    const decisions = await alphaOmegaOrchestrator.evaluateMultipleSymbols(
      marketStates,
      traderScore,
      userId,
      goalContext
    );

    const topDecision = this.findTopDecision(decisions);
    const allNoTrade = Array.from(decisions.values()).every(d => d.action === 'NO_TRADE');

    if (allNoTrade) {
      await this.storeNoTradeContext(
        userId,
        sessionId,
        marketStates,
        decisions,
        topDecision
      );
    } else {
      await this.storeTradeContext(
        userId,
        sessionId,
        marketStates,
        decisions,
        topDecision
      );
    }

    return {
      decisions,
      mode: 'full_council',
      scout_cycles: 0,
      reasoning: reason || 'Full council evaluation',
      llm_cost_saved: false,
    };
  }

  private async storeNoTradeContext(
    userId: string,
    sessionId: string,
    marketStates: FullMarketState[],
    decisions: Map<string, AlphaDecision>,
    topDecision: AlphaDecision
  ): Promise<void> {
    const omegaIssues = this.extractOmegaIssues(decisions);
    const requiredImprovements = councilContextService.extractRequiredImprovements(omegaIssues);
    const snapshot = this.buildCurrentSnapshot(marketStates);

    await councilContextService.storeCouncilContext({
      user_id: userId,
      session_id: sessionId,
      alpha_decision: 'no_trade',
      confidence: topDecision.confidence,
      threshold_gap: 75 - topDecision.confidence,
      target_threshold: 75,
      omega_issues: omegaIssues,
      required_improvements: requiredImprovements,
      last_snapshot: snapshot,
      symbols_scanned: marketStates.map(s => s.symbol),
      total_omega_votes: decisions.size * 7,
    });

    logger.info('[CouncilManager] Stored NO_TRADE context', {
      confidence: topDecision.confidence,
      threshold_gap: 75 - topDecision.confidence,
      issues_count: Object.keys(omegaIssues).length,
    });
  }

  private async storeTradeContext(
    userId: string,
    sessionId: string,
    marketStates: FullMarketState[],
    decisions: Map<string, AlphaDecision>,
    topDecision: AlphaDecision
  ): Promise<void> {
    const snapshot = this.buildCurrentSnapshot(marketStates);

    await councilContextService.storeCouncilContext({
      user_id: userId,
      session_id: sessionId,
      alpha_decision: 'trade_taken',
      confidence: topDecision.confidence,
      threshold_gap: 0,
      target_threshold: 75,
      omega_issues: {},
      required_improvements: {},
      last_snapshot: snapshot,
      symbols_scanned: marketStates.map(s => s.symbol),
      total_omega_votes: decisions.size * 7,
    });

    logger.info('[CouncilManager] Stored TRADE_TAKEN context', {
      confidence: topDecision.confidence,
      symbol: Array.from(decisions.entries()).find(([_, d]) => d.action !== 'NO_TRADE')?.[0],
    });
  }

  private extractOmegaIssues(decisions: Map<string, AlphaDecision>): Record<string, string[]> {
    const issues: Record<string, string[]> = {};

    for (const [symbol, decision] of decisions) {
      if (decision.action === 'NO_TRADE' && decision.reasoning) {
        const key = `${symbol}`;
        if (!issues[key]) {
          issues[key] = [];
        }
        issues[key].push(decision.reasoning);
      }
    }

    return issues;
  }

  private findTopDecision(decisions: Map<string, AlphaDecision>): AlphaDecision {
    let topDecision: AlphaDecision | null = null;
    let highestConfidence = 0;

    for (const decision of decisions.values()) {
      if (decision.confidence > highestConfidence) {
        highestConfidence = decision.confidence;
        topDecision = decision;
      }
    }

    return topDecision || {
      action: 'NO_TRADE' as const,
      decision: 'NO_TRADE' as const,
      entry: 0,
      stopLoss: 0,
      takeProfit: 0,
      confidence: 0,
      reasoning: 'No decisions available',
      omega_summary: 'No analysis',
    };
  }

  private buildCurrentSnapshot(marketStates: FullMarketState[]): Record<string, any> {
    const snapshot: Record<string, any> = {};

    for (const state of marketStates) {
      snapshot[state.symbol] = {
        price: state.price,
        ema20: state.ema20,
        ema50: state.ema50,
        ema200: state.ema200,
        rsi: state.rsi,
        atr: state.atr,
        volume: 0,
        spread: 0,
        timestamp: new Date().toISOString(),
      };
    }

    return snapshot;
  }

  formatResultForUser(result: CouncilManagerResult): string {
    const lines: string[] = [];

    if (result.mode === 'full_council') {
      lines.push('🎯 Full Omega Council convened');
      lines.push(`Evaluated ${result.decisions.size} symbols`);
      lines.push(`Reasoning: ${result.reasoning}`);
    } else {
      lines.push(`🔍 Alpha Scout (Cycle ${result.scout_cycles})`);
      lines.push(`Improvement: ${result.improvement_score}%`);
      lines.push(`${result.reasoning}`);
      lines.push('💰 Saved full council cost!');
    }

    return lines.join('\n');
  }
}

export const contextAwareCouncilManager = new ContextAwareCouncilManager();
