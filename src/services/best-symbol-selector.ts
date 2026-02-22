/**
 * Best Symbol Selector - CONFIDENCE-DOMINANT ARCHITECTURE
 *
 * SSOT Principles:
 * - Alpha's confidence IS the score (no composite blending)
 * - Hard eligibility filtering before ranking
 * - Tie-breakers ONLY when confidence difference ≤ 5 points
 * - No double-counting of market factors (Alpha already evaluated them)
 * - Execution-only factors for tie-breaking (spread, distance, TPS)
 *
 * Selection Pipeline:
 * 1. Hard eligibility filtering (deterministic gates)
 * 2. Primary sort by decision.confidence (descending)
 * 3. Tie-breaker logic (only for close confidence values)
 * 4. Comprehensive forensic logging
 */

import type { SymbolSnapshot } from './multi-symbol-snapshot-builder';
import type { AlphaDecision } from '../brains/coordinator-alpha';
import { logger } from '../lib/logger';
import { ALPHA_IDENTITY } from '../config/alpha-identity';
import type { StyleDisplayName } from '../config/trade-styles';

// Tie-breaker threshold: confidence difference must be ≤ this value to activate tie-breakers
const CONFIDENCE_TIE_THRESHOLD = 5;

export interface EligibilityCheck {
  passed: boolean;
  reason: string;
  gate: string;
}

export interface TieBreakerFactors {
  entryDistance: number; // Pips from ideal entry zone
  spreadRisk: number; // Current spread vs average
  tpsScore?: number; // TPS urgency score (if available)
  eqsScore?: number; // Entry quality score (for non-SCALP only)
  combinedScore: number; // Weighted combination
}

export interface SymbolEvaluation {
  symbol: string;
  snapshot: SymbolSnapshot;
  omegaDecision: AlphaDecision;
  primaryScore: number; // decision.confidence (THE score)
  eligibility: EligibilityCheck[];
  tieBreakerFactors?: TieBreakerFactors;
  reasoning: string[];
}

export interface BestSymbolResult {
  selected: boolean;
  symbol: string | null;
  evaluation: SymbolEvaluation | null;
  allEvaluations: SymbolEvaluation[];
  reasoning: string;
  selectionMetadata: {
    confidenceRange: string;
    tieBreakersUsed: boolean;
    winnerMargin?: number; // Confidence point difference from runner-up
    forensics: string; // Detailed selection forensics
  };
}

class BestSymbolSelector {
  /**
   * Select the best symbol using confidence-dominant architecture
   *
   * Pipeline:
   * 1. Hard eligibility filtering
   * 2. Primary sort by confidence (descending)
   * 3. Tie-breaker logic for close candidates (≤5 points difference)
   */
  selectBestSymbol(
    snapshots: SymbolSnapshot[],
    omegaDecisions: Map<string, AlphaDecision>,
    tpsScores?: Map<string, number> // Optional TPS scores for tie-breaking
  ): BestSymbolResult {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`[Best Symbol Selector] 🧠 CONFIDENCE-DOMINANT SELECTION`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Evaluating ${snapshots.length} symbols...`);
    console.log(`Architecture: Alpha confidence IS the score`);
    console.log(`Tie-breaker threshold: ≤${CONFIDENCE_TIE_THRESHOLD} points\n`);

    const eligibleEvaluations: SymbolEvaluation[] = [];
    const rejectedEvaluations: { symbol: string; reason: string; gate: string }[] = [];

    // STAGE 1: HARD ELIGIBILITY FILTERING
    for (const snapshot of snapshots) {
      const decision = omegaDecisions.get(snapshot.symbol);
      const eligibilityChecks: EligibilityCheck[] = [];

      // Gate 1: Valid Omega decision exists
      if (!decision) {
        rejectedEvaluations.push({
          symbol: snapshot.symbol,
          reason: 'No Omega decision found',
          gate: 'DECISION_EXISTS',
        });
        continue;
      }

      eligibilityChecks.push({
        passed: true,
        reason: 'Omega decision exists',
        gate: 'DECISION_EXISTS',
      });

      // Gate 2: Not NO_TRADE
      if (decision.action === 'NO_TRADE') {
        // TIER7 FIX: Classify NO_TRADE reason for better debugging
        const noTradeClassification = this.classifyNoTrade(decision);

        eligibilityChecks.push({
          passed: false,
          reason: `NO_TRADE: ${noTradeClassification.category}`,
          gate: 'TRADEABLE_ACTION',
        });
        rejectedEvaluations.push({
          symbol: snapshot.symbol,
          reason: `NO_TRADE: ${noTradeClassification.detail}`,
          gate: 'TRADEABLE_ACTION',
        });
        continue;
      }

      eligibilityChecks.push({
        passed: true,
        reason: `${decision.action} action`,
        gate: 'TRADEABLE_ACTION',
      });

      // Gate 3: Snapshot tradeable
      if (!snapshot.tradeable) {
        eligibilityChecks.push({
          passed: false,
          reason: snapshot.blockReason || 'Snapshot not tradeable',
          gate: 'SNAPSHOT_TRADEABLE',
        });
        rejectedEvaluations.push({
          symbol: snapshot.symbol,
          reason: `Blocked: ${snapshot.blockReason}`,
          gate: 'SNAPSHOT_TRADEABLE',
        });
        continue;
      }

      eligibilityChecks.push({
        passed: true,
        reason: 'Snapshot tradeable',
        gate: 'SNAPSHOT_TRADEABLE',
      });

      // Gate 4: Adversarial context — INFORM ONLY (CCIP-2026-0222)
      // Adversarial data is background intelligence for Alpha, not a gatekeeper.
      // Alpha receives adversarial context via Omega council prompts and decides freely.
      // No symbol is rejected on adversarial grounds alone.
      eligibilityChecks.push({
        passed: true,
        reason: snapshot.adversarial.is_adversarial
          ? `Adversarial context noted (${snapshot.adversarial.level}) — Alpha informed`
          : 'Clean market',
        gate: 'ADVERSARIAL_CHECK',
      });

      // Gate 5: Meets minimum confidence threshold
      if (decision.confidence < ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE) {
        eligibilityChecks.push({
          passed: false,
          reason: `Confidence ${decision.confidence}% below threshold ${ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE}%`,
          gate: 'CONFIDENCE_THRESHOLD',
        });
        rejectedEvaluations.push({
          symbol: snapshot.symbol,
          reason: `Confidence ${decision.confidence}% < ${ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE}%`,
          gate: 'CONFIDENCE_THRESHOLD',
        });
        continue;
      }

      eligibilityChecks.push({
        passed: true,
        reason: `Confidence ${decision.confidence}% ≥ ${ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE}%`,
        gate: 'CONFIDENCE_THRESHOLD',
      });

      // Gate 6: Valid trade geometry (SL/TP on correct sides)
      const geometryCheck = this.validateTradeGeometry(decision);
      if (!geometryCheck.valid) {
        eligibilityChecks.push({
          passed: false,
          reason: geometryCheck.reason,
          gate: 'TRADE_GEOMETRY',
        });
        rejectedEvaluations.push({
          symbol: snapshot.symbol,
          reason: geometryCheck.reason,
          gate: 'TRADE_GEOMETRY',
        });
        continue;
      }

      eligibilityChecks.push({
        passed: true,
        reason: 'Trade geometry valid',
        gate: 'TRADE_GEOMETRY',
      });

      // All gates passed - this is an eligible candidate
      const reasoning = this.buildReasoning(snapshot, decision);

      eligibleEvaluations.push({
        symbol: snapshot.symbol,
        snapshot,
        omegaDecision: decision,
        primaryScore: decision.confidence, // Confidence IS the score
        eligibility: eligibilityChecks,
        reasoning,
      });

      console.log(`[Best Symbol Selector] ✅ ${snapshot.symbol}: Confidence ${decision.confidence}% | ${decision.action} | All gates passed`);
    }

    // Log rejected symbols
    if (rejectedEvaluations.length > 0) {
      console.log(`\n❌ Rejected Symbols (${rejectedEvaluations.length}):`);
      for (const rejected of rejectedEvaluations) {
        console.log(`   ${rejected.symbol}: ${rejected.reason} [${rejected.gate}]`);
      }
    }

    if (eligibleEvaluations.length === 0) {
      console.log('\n[Best Symbol Selector] 🚫 No eligible symbols found - WAIT mode\n');
      return {
        selected: false,
        symbol: null,
        evaluation: null,
        allEvaluations: [],
        reasoning: 'No tradeable opportunities passed eligibility filters',
        selectionMetadata: {
          confidenceRange: 'N/A',
          tieBreakersUsed: false,
          forensics: `Evaluated: ${snapshots.length} | Rejected: ${rejectedEvaluations.length} | Eligible: 0`,
        },
      };
    }

    // STAGE 2: PRIMARY SORT BY CONFIDENCE (DESCENDING)
    eligibleEvaluations.sort((a, b) => b.primaryScore - a.primaryScore);

    // STAGE 3: TIE-BREAKER LOGIC (if needed)
    let tieBreakersUsed = false;
    if (eligibleEvaluations.length > 1) {
      const top = eligibleEvaluations[0];
      const runnerUp = eligibleEvaluations[1];
      const confidenceDiff = top.primaryScore - runnerUp.primaryScore;

      if (confidenceDiff <= CONFIDENCE_TIE_THRESHOLD) {
        console.log(`\n⚖️ TIE-BREAKER ACTIVATED: ${top.symbol} (${top.primaryScore}%) vs ${runnerUp.symbol} (${runnerUp.primaryScore}%) | Diff: ${confidenceDiff.toFixed(1)} points`);

        // Calculate tie-breaker factors for both candidates
        top.tieBreakerFactors = this.calculateTieBreakerFactors(top, tpsScores);
        runnerUp.tieBreakerFactors = this.calculateTieBreakerFactors(runnerUp, tpsScores);

        console.log(`   ${top.symbol}: TieBreaker=${top.tieBreakerFactors.combinedScore.toFixed(2)}`);
        console.log(`   ${runnerUp.symbol}: TieBreaker=${runnerUp.tieBreakerFactors.combinedScore.toFixed(2)}`);

        // If tie-breaker favors runner-up, flip the ranking
        if (runnerUp.tieBreakerFactors.combinedScore > top.tieBreakerFactors.combinedScore) {
          console.log(`   🔄 TIE-BREAKER WINNER: ${runnerUp.symbol} (better execution conditions)`);
          [eligibleEvaluations[0], eligibleEvaluations[1]] = [eligibleEvaluations[1], eligibleEvaluations[0]];
          tieBreakersUsed = true;
        } else {
          console.log(`   ✅ ORIGINAL WINNER CONFIRMED: ${top.symbol}`);
        }
      }
    }

    const winner = eligibleEvaluations[0];
    const confidenceRange = `${Math.min(...eligibleEvaluations.map(e => e.primaryScore))}%-${Math.max(...eligibleEvaluations.map(e => e.primaryScore))}%`;
    const winnerMargin = eligibleEvaluations.length > 1
      ? winner.primaryScore - eligibleEvaluations[1].primaryScore
      : undefined;

    // Forensics summary
    const forensics = `Evaluated: ${snapshots.length} | Rejected: ${rejectedEvaluations.length} | Eligible: ${eligibleEvaluations.length} | Winner: ${winner.symbol} @ ${winner.primaryScore}% | Margin: ${winnerMargin?.toFixed(1) || 'N/A'} pts | Tie-breakers: ${tieBreakersUsed ? 'YES' : 'NO'}`;

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`[Best Symbol Selector] 🎯 SELECTION RESULT`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Winner: ${winner.symbol}`);
    console.log(`Confidence: ${winner.primaryScore}%`);
    console.log(`Action: ${winner.omegaDecision.action}`);
    console.log(`Entry: ${winner.omegaDecision.entry}`);
    console.log(`SL: ${winner.omegaDecision.stopLoss} | TP: ${winner.omegaDecision.takeProfit}`);
    if (winnerMargin !== undefined) {
      console.log(`Margin over runner-up: ${winnerMargin.toFixed(1)} points`);
    }
    console.log(`Tie-breakers used: ${tieBreakersUsed ? 'YES' : 'NO'}`);
    console.log(`\n📊 Full Ranking: ${eligibleEvaluations.slice(0, 5).map((e, i) => `${i + 1}.${e.symbol}:${e.primaryScore}%(${e.omegaDecision.action})`).join(' | ')}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    return {
      selected: true,
      symbol: winner.symbol,
      evaluation: winner,
      allEvaluations: eligibleEvaluations,
      reasoning: `Selected ${winner.symbol} with confidence ${winner.primaryScore}%. ${winner.reasoning.join('. ')}`,
      selectionMetadata: {
        confidenceRange,
        tieBreakersUsed,
        winnerMargin,
        forensics,
      },
    };
  }

  /**
   * Validate trade geometry (SL/TP on correct sides)
   *
   * MANDATORY CHECK: Prevents wrong-side SL/TP (geometry errors)
   */
  private validateTradeGeometry(decision: AlphaDecision): { valid: boolean; reason: string } {
    if (!decision.entry || !decision.stopLoss || !decision.takeProfit) {
      return { valid: false, reason: 'Missing price values (entry/SL/TP)' };
    }

    // Check for NaN or invalid prices
    if (
      isNaN(decision.entry) ||
      isNaN(decision.stopLoss) ||
      isNaN(decision.takeProfit) ||
      decision.entry <= 0 ||
      decision.stopLoss <= 0 ||
      decision.takeProfit <= 0
    ) {
      return { valid: false, reason: 'Invalid price values (NaN or ≤0)' };
    }

    // BUY trades: SL < Entry < TP
    if (decision.action === 'BUY') {
      if (decision.stopLoss >= decision.entry) {
        return { valid: false, reason: 'BUY: Stop Loss must be BELOW entry' };
      }
      if (decision.takeProfit <= decision.entry) {
        return { valid: false, reason: 'BUY: Take Profit must be ABOVE entry' };
      }
    }

    // SELL trades: TP < Entry < SL
    if (decision.action === 'SELL') {
      if (decision.stopLoss <= decision.entry) {
        return { valid: false, reason: 'SELL: Stop Loss must be ABOVE entry' };
      }
      if (decision.takeProfit >= decision.entry) {
        return { valid: false, reason: 'SELL: Take Profit must be BELOW entry' };
      }
    }

    return { valid: true, reason: 'Trade geometry valid' };
  }

  /**
   * Calculate tie-breaker factors for execution optimization
   *
   * ONLY USED when confidence difference ≤ 5 points
   * Factors considered:
   * - Entry distance (prefer closer to ideal zone)
   * - Spread risk (prefer tighter spreads)
   * - TPS score (if available, from TPS integration)
   */
  private calculateTieBreakerFactors(
    evaluation: SymbolEvaluation,
    tpsScores?: Map<string, number>
  ): TieBreakerFactors {
    const { omegaDecision, snapshot } = evaluation;

    // Entry distance factor (0-100, higher is better)
    // Assumes entry zone is defined in decision or can be estimated from current price
    const entryDistance = Math.abs(snapshot.currentPrice - omegaDecision.entry);
    const entryDistanceScore = Math.max(0, 100 - entryDistance * 10); // Closer = higher score

    // Spread risk factor (0-100, higher is better)
    // Lower spread = better execution conditions
    const avgSpread = snapshot.spread || 0.0003; // Assume typical spread if not provided
    const currentSpread = snapshot.currentSpread || avgSpread;
    const spreadRiskScore = currentSpread <= avgSpread ? 100 : Math.max(0, 100 - ((currentSpread / avgSpread - 1) * 100));

    // TPS score (0-100, if available)
    const tpsScore = tpsScores?.get(snapshot.symbol) || 50; // Default neutral if not available

    // EQS score (only for non-SCALP styles)
    const style = (omegaDecision.style || 'MICRO_INTRADAY') as StyleDisplayName;
    const eqsScore = style === 'SCALP' ? 0 : (omegaDecision.entryQualityScore || 40);

    // Weighted combination (execution-focused, not market re-evaluation)
    const combinedScore =
      entryDistanceScore * 0.30 + // 30%: Entry proximity
      spreadRiskScore * 0.25 +     // 25%: Spread conditions
      tpsScore * 0.30 +             // 30%: TPS urgency
      (style === 'SCALP' ? 0 : eqsScore * 0.15); // 15%: EQS (non-SCALP only)

    return {
      entryDistance,
      spreadRisk: currentSpread / avgSpread,
      tpsScore,
      eqsScore: style === 'SCALP' ? undefined : eqsScore,
      combinedScore,
    };
  }

  /**
   * Build reasoning text for symbol selection
   *
   * Focus on Alpha's decision context, not market re-evaluation
   */
  private buildReasoning(snapshot: SymbolSnapshot, decision: AlphaDecision): string[] {
    const reasons: string[] = [];

    // Primary: Alpha's decision
    reasons.push(`${decision.action} @ ${decision.confidence}% confidence`);

    // Secondary: Key contextual info (not double-counting)
    reasons.push(`Session: ${snapshot.regime.session}${snapshot.regime.is_session_overlap ? ' (overlap)' : ''}`);
    reasons.push(`Volatility: ${snapshot.volatility}`);

    if (snapshot.adversarial.is_adversarial) {
      reasons.push(`Adversarial context: ${snapshot.adversarial.level} (Alpha informed)`);
    }

    if (snapshot.regime.is_dead_zone) {
      reasons.push(`⚠️ Dead zone detected`);
    }

    return reasons;
  }

  /**
   * Log detailed symbol evaluation breakdown with forensic data
   */
  logEvaluationDetails(result: BestSymbolResult): void {
    console.log('\n========================================');
    console.log('   CONFIDENCE-DOMINANT SELECTION FORENSICS');
    console.log('========================================\n');

    if (!result.selected) {
      console.log('❌ NO SYMBOLS SELECTED');
      console.log(`   Reason: ${result.reasoning}`);
      console.log(`   Forensics: ${result.selectionMetadata.forensics}\n`);
      return;
    }

    console.log(`🎯 SELECTED SYMBOL: ${result.symbol}`);
    if (result.evaluation) {
      console.log(`   Confidence: ${result.evaluation.primaryScore}% (PRIMARY SCORE)`);
      console.log(`   Action: ${result.evaluation.omegaDecision.action}`);
      console.log(`   Entry: ${result.evaluation.omegaDecision.entry}`);
      console.log(`   SL: ${result.evaluation.omegaDecision.stopLoss}`);
      console.log(`   TP: ${result.evaluation.omegaDecision.takeProfit}`);

      if (result.evaluation.tieBreakerFactors) {
        console.log(`\n   🔧 Tie-Breaker Factors:`);
        console.log(`      Combined Score: ${result.evaluation.tieBreakerFactors.combinedScore.toFixed(2)}`);
        console.log(`      Entry Distance: ${result.evaluation.tieBreakerFactors.entryDistance.toFixed(5)}`);
        console.log(`      Spread Risk: ${result.evaluation.tieBreakerFactors.spreadRisk.toFixed(4)}`);
        if (result.evaluation.tieBreakerFactors.tpsScore) {
          console.log(`      TPS Score: ${result.evaluation.tieBreakerFactors.tpsScore.toFixed(2)}`);
        }
        if (result.evaluation.tieBreakerFactors.eqsScore) {
          console.log(`      EQS Score: ${result.evaluation.tieBreakerFactors.eqsScore.toFixed(2)}`);
        }
      }

      console.log(`\n   📋 Eligibility Checks:`);
      result.evaluation.eligibility.forEach((check) => {
        const status = check.passed ? '✅' : '❌';
        console.log(`      ${status} ${check.gate}: ${check.reason}`);
      });
    }

    console.log(`\n📊 SELECTION METADATA:`);
    console.log(`   Confidence Range: ${result.selectionMetadata.confidenceRange}`);
    console.log(`   Tie-Breakers Used: ${result.selectionMetadata.tieBreakersUsed ? 'YES' : 'NO'}`);
    if (result.selectionMetadata.winnerMargin !== undefined) {
      console.log(`   Winner Margin: ${result.selectionMetadata.winnerMargin.toFixed(1)} points`);
    }
    console.log(`   Forensics: ${result.selectionMetadata.forensics}`);

    if (result.allEvaluations.length > 1) {
      console.log(`\n📊 ALL ELIGIBLE CANDIDATES (ranked by confidence):\n`);
      result.allEvaluations.slice(0, 5).forEach((evaluation, index) => {
        const marker = index === 0 ? '🏆' : `${index + 1}.`;
        console.log(`   ${marker} ${evaluation.symbol} - Confidence: ${evaluation.primaryScore}%`);
        console.log(`      ${evaluation.reasoning.join(' | ')}`);
      });

      if (result.allEvaluations.length > 5) {
        console.log(`   ... and ${result.allEvaluations.length - 5} more candidates`);
      }
    }

    console.log('\n========================================\n');
  }

  /**
   * TIER7 FIX: Classify NO_TRADE decisions for better debugging
   * Distinguishes between timeout failures, market rejections, and low confidence
   */
  private classifyNoTrade(decision: AlphaDecision): { category: string; detail: string } {
    const reasoning = decision.reasoning?.toLowerCase() || '';
    const omegaSummary = decision.omega_summary?.toLowerCase() || '';
    const errorType = (decision as any).errorType;

    if (reasoning.includes('high noise') || reasoning.includes('noise floor') || reasoning.includes('not viable on')) {
      return {
        category: 'High Noise Advisory',
        detail: `Market noise elevated for current style [${reasoning.substring(0, 150)}]`
      };
    }

    if (errorType === 'TIMEOUT_FAILURE' || reasoning.includes('timeout') || omegaSummary.includes('timeout')) {
      return {
        category: 'Timeout Failure',
        detail: `Evaluation timeout - LLM API exceeded time limit [${reasoning.substring(0, 100)}]`
      };
    }

    if (errorType === 'SYSTEM_ERROR' || reasoning.includes('failed') || reasoning.includes('error')) {
      return {
        category: 'System Error',
        detail: `System error during evaluation [${reasoning.substring(0, 100)}]`
      };
    }

    if (reasoning.includes('ssot') || reasoning.includes('invalid') || reasoning.includes('blocked')) {
      return {
        category: 'Data Integrity',
        detail: `Data validation failed [${reasoning.substring(0, 100)}]`
      };
    }

    if (reasoning.includes('market') || reasoning.includes('conditions') || reasoning.includes('regime')) {
      return {
        category: 'Market Conditions',
        detail: `Market conditions unfavorable [${reasoning.substring(0, 100)}]`
      };
    }

    if (decision.confidence === 0 || decision.confidence < 30) {
      return {
        category: 'Low Confidence',
        detail: `Alpha confidence ${decision.confidence}% - setup quality insufficient`
      };
    }

    if (reasoning.includes('conflict') || reasoning.includes('disagree')) {
      return {
        category: 'Omega Conflict',
        detail: `Omega council conflict - no clear directional consensus`
      };
    }

    return {
      category: 'General Rejection',
      detail: decision.reasoning || 'No trade opportunity identified'
    };
  }
}

export const bestSymbolSelector = new BestSymbolSelector();
