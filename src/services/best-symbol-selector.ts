/**
 * Best Symbol Selector
 *
 * Ranks and selects the best trading opportunity from multiple symbol evaluations.
 * Considers Omega votes, confidence scores, adversarial signals, and regime data.
 */

import type { SymbolSnapshot } from './multi-symbol-snapshot-builder';
import type { AlphaDecision } from '../brains/coordinator-alpha';
import { logger } from '../lib/logger';

export interface SymbolEvaluation {
  symbol: string;
  snapshot: SymbolSnapshot;
  omegaDecision: AlphaDecision;
  overallScore: number;
  reasoning: string[];
}

export interface BestSymbolResult {
  selected: boolean;
  symbol: string | null;
  evaluation: SymbolEvaluation | null;
  allEvaluations: SymbolEvaluation[];
  reasoning: string;
}

class BestSymbolSelector {
  /**
   * Select the best symbol from all evaluated options
   */
  selectBestSymbol(
    snapshots: SymbolSnapshot[],
    omegaDecisions: Map<string, AlphaDecision>
  ): BestSymbolResult {
    console.log(`[Best Symbol Selector] Evaluating ${snapshots.length} symbols...`);

    const evaluations: SymbolEvaluation[] = [];

    for (const snapshot of snapshots) {
      const decision = omegaDecisions.get(snapshot.symbol);
      if (!decision) {
        console.log(`[Best Symbol Selector] ⚠️ ${snapshot.symbol}: No Omega decision found`);
        continue;
      }

      if (decision.action === 'NO_TRADE') {
        console.log(`[Best Symbol Selector] ❌ ${snapshot.symbol}: NO_TRADE decision`);
        continue;
      }

      if (!snapshot.tradeable) {
        console.log(`[Best Symbol Selector] ❌ ${snapshot.symbol}: Blocked (${snapshot.blockReason})`);
        continue;
      }

      if (snapshot.adversarial.is_adversarial && snapshot.adversarial.level === 'severe') {
        console.log(`[Best Symbol Selector] ❌ ${snapshot.symbol}: Severe adversarial activity`);
        continue;
      }

      const score = this.calculateSymbolScore(snapshot, decision);
      const reasoning = this.buildReasoning(snapshot, decision, score);

      evaluations.push({
        symbol: snapshot.symbol,
        snapshot,
        omegaDecision: decision,
        overallScore: score,
        reasoning
      });

      console.log(`[Best Symbol Selector] ✅ ${snapshot.symbol}: Score ${score.toFixed(2)} | Confidence ${decision.confidence}% | ${decision.action}`);
    }

    if (evaluations.length === 0) {
      console.log('[Best Symbol Selector] 🚫 No tradeable symbols found - WAIT mode');
      return {
        selected: false,
        symbol: null,
        evaluation: null,
        allEvaluations: [],
        reasoning: 'No tradeable opportunities detected across all symbols'
      };
    }

    evaluations.sort((a, b) => b.overallScore - a.overallScore);

    const best = evaluations[0];
    console.log(`[Best Symbol Selector] 🎯 SELECTED: ${best.symbol} (Score: ${best.overallScore.toFixed(2)})`);
    console.log(`[Best Symbol Selector] 📊 Ranking: ${evaluations.map(e => `${e.symbol}:${e.overallScore.toFixed(1)}`).join(', ')}`);

    return {
      selected: true,
      symbol: best.symbol,
      evaluation: best,
      allEvaluations: evaluations,
      reasoning: `Selected ${best.symbol} with score ${best.overallScore.toFixed(2)}. ${best.reasoning.join('. ')}`
    };
  }

  /**
   * Calculate overall score for a symbol
   */
  private calculateSymbolScore(snapshot: SymbolSnapshot, decision: AlphaDecision): number {
    let score = 0;

    score += decision.confidence * 0.4;

    // Safety check: handle undefined/NaN trendScore
    const trendScore = snapshot.trendScore ?? 0;
    if (!isNaN(trendScore)) {
      const trendWeight = Math.abs(trendScore) / 10;
      score += trendWeight * 20;
    } else {
      console.warn(`[Best Symbol Selector] ⚠️ ${snapshot.symbol}: trendScore is NaN, defaulting to 0`);
    }

    if (snapshot.volatility === 'medium') {
      score += 15;
    } else if (snapshot.volatility === 'low') {
      score += 10;
    } else if (snapshot.volatility === 'high') {
      score += 5;
    }

    if (!snapshot.regime.is_dead_zone) {
      score += 10;
    }
    if (snapshot.regime.session_open) {
      score += 5;
    }
    if (snapshot.regime.is_session_overlap) {
      score += 8;
    }

    if (snapshot.adversarial.suspicion_score > 50) {
      score -= 20;
    } else if (snapshot.adversarial.suspicion_score > 30) {
      score -= 10;
    }

    if (snapshot.regime.is_high_risk_regime) {
      score *= snapshot.regime.risk_reduction_factor;
    }

    if (snapshot.omegaSensors.imbalance_score > 70) {
      score += 10;
    }

    if (snapshot.omegaSensors.consolidation_score > 60 && snapshot.omegaSensors.consolidation_score < 80) {
      score += 8;
    }

    return Math.max(0, score);
  }

  /**
   * Build reasoning text for symbol selection
   */
  private buildReasoning(snapshot: SymbolSnapshot, decision: AlphaDecision, score: number): string[] {
    const reasons: string[] = [];

    reasons.push(`Omega confidence ${decision.confidence}%`);

    // Safety check for trendScore display
    const trendScore = snapshot.trendScore ?? 0;
    const trendScoreDisplay = !isNaN(trendScore) ? trendScore.toFixed(0) : 'N/A';
    reasons.push(`Trend: ${snapshot.trend} (score: ${trendScoreDisplay})`);

    reasons.push(`Volatility: ${snapshot.volatility}`);
    reasons.push(`Session: ${snapshot.regime.session}`);

    if (snapshot.adversarial.is_adversarial) {
      reasons.push(`⚠️ Adversarial level: ${snapshot.adversarial.level}`);
    } else {
      reasons.push('Clean market conditions');
    }

    if (snapshot.regime.is_session_overlap) {
      reasons.push('Session overlap active');
    }

    if (snapshot.omegaSensors.imbalance_score > 70) {
      reasons.push(`Strong imbalance (${snapshot.omegaSensors.imbalance_score})`);
    }

    return reasons;
  }

  /**
   * Log detailed symbol evaluation breakdown
   */
  logEvaluationDetails(result: BestSymbolResult): void {
    console.log('\n========================================');
    console.log('   MULTI-SYMBOL EVALUATION RESULTS');
    console.log('========================================\n');

    if (!result.selected) {
      console.log('❌ NO SYMBOLS TRADEABLE');
      console.log(`   Reason: ${result.reasoning}\n`);
      return;
    }

    console.log(`🎯 SELECTED SYMBOL: ${result.symbol}`);
    if (result.evaluation) {
      console.log(`   Score: ${result.evaluation.overallScore.toFixed(2)}`);
      console.log(`   Action: ${result.evaluation.omegaDecision.action}`);
      console.log(`   Confidence: ${result.evaluation.omegaDecision.confidence}%`);
      console.log(`   Entry: ${result.evaluation.omegaDecision.entry}`);
      console.log(`   SL: ${result.evaluation.omegaDecision.stopLoss}`);
      console.log(`   TP: ${result.evaluation.omegaDecision.takeProfit}\n`);
    }

    console.log('📊 ALL SYMBOLS EVALUATED:\n');
    result.allEvaluations.forEach((evaluation, index) => {
      console.log(`   ${index + 1}. ${evaluation.symbol} - Score: ${evaluation.overallScore.toFixed(2)}`);
      console.log(`      ${evaluation.reasoning.join(' | ')}`);
    });

    console.log('\n========================================\n');
  }
}

export const bestSymbolSelector = new BestSymbolSelector();
