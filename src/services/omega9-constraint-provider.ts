/**
 * Omega-9 Constraint Provider
 *
 * Provides trading constraints UP-FRONT before Alpha makes decisions.
 *
 * Philosophy:
 * - Constraints define the BOUNDARIES of acceptable trades
 * - Alpha optimizes WITHIN those boundaries
 * - Omega-9 validates CATASTROPHIC errors only, not strategy
 *
 * ARCHITECTURAL PRINCIPLE (v2.0):
 * - TIME IS A SCORING SIGNAL, NOT A REJECTION CONSTRAINT
 * - Session time NEVER limits TP or blocks trades
 * - Session constraints are ADVISORY ONLY for confidence scoring
 * - Style is IMMUTABLE. If duration exceeds band, return NO_TRADE.
 *
 * This separates:
 * 1. Constraint Generation (this service) - runs BEFORE Alpha decides
 * 2. Catastrophic Validation (Omega-9) - runs AFTER Alpha decides
 *
 * SSOT COMPLIANCE:
 * - Session constraints delegated to sessionConstraintCoordinator
 * - Asset classification delegated to assetClassifier
 * - NO hardcoded symbol checks - all queries go through coordinators
 */

import { calculatePipDistance, getCurrencyPipInfo } from '../utils/currencyHelpers';
import { getSymbolConfig } from '../config/symbol-registry';
import { riskAwareStopCalculator } from './risk-aware-stop-calculator';
import { sessionConstraintCoordinator } from './session-constraint-coordinator';
import { assetClassifier } from './asset-classifier';
import { constraintFeasibilityValidator } from './constraint-feasibility-validator';
import { TRADING_CONSTANTS, getMinTP1RRForStyle, getMaxRRForStyle } from '../config/trading-constants';
import type {
  Omega9Constraints,
  Omega9ConstraintInput,
  ConstraintViolation,
  ArenaWalls,
  DualArenaWalls,
  DualArenaInput,
} from '../types/omega9-constraints';
import { getExecutionEnvelope, getAssetClassEnvelopeBounds, type EnvelopeAssetClass } from '../config/style-execution-envelopes';

class Omega9ConstraintProvider {
  /**
   * Generate comprehensive constraints for Alpha to work within
   *
   * This runs BEFORE Alpha makes a decision, providing clear boundaries
   * Accepts optional resolved plan from feasibility resolver (SSOT)
   *
   * CRITICAL: Session-time constraints apply differently based on trade style:
   * - SCALP: Session-time caps TP (trades must complete within current session)
   * - INTRADAY: Session-time is advisory only (trades may extend beyond session)
   * - SWING: Session-time ignored (multi-session trades)
   *
   * CRITICAL FIX: Now includes pre-flight feasibility checks to detect impossible constraints
   */
  generateConstraints(input: Omega9ConstraintInput): Omega9Constraints {
    const {
      symbol,
      entry,
      direction,
      atr,
      riskMode,
      tradeStyle,
      currentSession,
      sessionTimeRemainingMinutes,
      volatilityRegime,
      proposedStopLoss,
      resolvedPlan
    } = input;

    // Calculate professional stop-loss ranges
    const stopLossCalc = riskAwareStopCalculator.calculateStopLoss({
      symbol,
      entryPrice: entry,
      direction: direction === 'BUY' ? 'buy' : 'sell',
      riskMode,
      atr,
      marketVolatility: volatilityRegime
    });

    const STYLE_MAP: Record<string, string> = { 'scalper': 'SCALP', 'micro': 'MICRO_INTRADAY', 'intraday': 'INTRADAY' };
    const mappedStyle = STYLE_MAP[tradeStyle] || tradeStyle;
    const noiseFloor = riskAwareStopCalculator.calculateNoiseFloor(symbol, entry, atr, mappedStyle);

    // Calculate feasible travel distance (used for all styles, applied differently)
    // SSOT: volatility calculation delegates to session constraint coordinator
    const volatilityPerHour = this.estimateVolatilityPerHour(symbol, atr, volatilityRegime, currentSession);
    const feasibleTravelPips = (sessionTimeRemainingMinutes / 60) * volatilityPerHour * 0.8; // 80% safety factor

    // ADVISORY ONLY: feasibleTravelPips informs confidence scoring.
    // It does NOT limit TP or block trades - Alpha has final authority.

    // SESSION GEOMETRY ADVISORY: Detect SL floor vs feasible session travel.
    // Provides Alpha with session geometry data as advisory context only.
    // Alpha retains full authority to trade regardless of these values.
    const stopLossCalcEarly = riskAwareStopCalculator.calculateStopLoss({
      symbol,
      entryPrice: entry,
      direction: direction === 'BUY' ? 'buy' : 'sell',
      riskMode,
      atr,
      marketVolatility: volatilityRegime
    });
    const earlyFeasiblePips = (sessionTimeRemainingMinutes / 60) * this.estimateVolatilityPerHour(symbol, atr, volatilityRegime, currentSession) * 0.8;
    const assetCategoryEarly = assetClassifier.getAssetCategory(symbol);
    const is24HourEarly = assetClassifier.is24HourMarket(symbol);
    if (!is24HourEarly && assetCategoryEarly !== 'forex') {
      // For indices and metals: check if min SL floor exceeds feasible travel
      const envelopeAssetClassEarly = this.mapAssetCategoryToEnvelope(assetCategoryEarly);
      const mappedStyleEarly = STYLE_MAP[tradeStyle] || tradeStyle;
      const envelopeBoundsEarly = getAssetClassEnvelopeBounds(mappedStyleEarly, envelopeAssetClassEarly, symbol, entry);
      if (envelopeBoundsEarly.slPips.min > earlyFeasiblePips && earlyFeasiblePips > 0) {
        console.log(
          `[Omega-9 SESSION_GEOMETRY_DATA] ${symbol}: SL floor ${envelopeBoundsEarly.slPips.min.toFixed(1)} pips ` +
          `vs session feasible travel ${earlyFeasiblePips.toFixed(1)} pips in ${sessionTimeRemainingMinutes}min ${currentSession}. ` +
          `Advisory data provided to Alpha — Alpha retains full trade authority.`
        );
      }
    }

    // ✅ CRITICAL FIX: Convert ATR-based TP from PRICE UNITS to PIPS
    // BUG: atr is in PRICE_UNITS (e.g., 0.00039 for GBPUSD), not pips
    // WRONG: maxTakeProfitPips = 0.00468 (rounds to 0 pips)
    // CORRECT: maxTakeProfitPips = 46.8 pips
    const pipInfo = getCurrencyPipInfo(symbol);
    const atrBasedMaxTP_PRICE_UNITS = resolvedPlan?.tpMaxAtrMultiple
      ? atr * resolvedPlan.tpMaxAtrMultiple
      : atr * 12; // 12x ATR as default (IN PRICE UNITS)

    // Convert to pips using SSOT helper
    const atrBasedMaxTP_PIPS = atrBasedMaxTP_PRICE_UNITS / pipInfo.pipValue;

    // Add diagnostic guard for SSOT math corruption
    if (atrBasedMaxTP_PIPS < 1.0) {
      console.error('[SSOT_MATH_CORRUPTION] TP range suspiciously low', {
        type: 'ZERO_TP',
        severity: 'ERROR',
        symbol,
        atr,
        atrBasedMaxTP_PRICE_UNITS,
        pipValue: pipInfo.pipValue,
        atrBasedMaxTP_PIPS,
        callsite: 'omega9-constraint-provider.ts:97',
        message: 'TP calculation produced near-zero pips - likely units mismatch'
      });
    }

    // ✅ CRYPTO EXEMPTION: 24/7 markets skip session calculations entirely
    const is24HourMarket = assetClassifier.is24HourMarket(symbol);

    // SSOT: Get session constraint policy from coordinator (unless 24/7 market)
    const sessionConstraintPolicy = is24HourMarket
      ? 'NONE'
      : sessionConstraintCoordinator.getSessionConstraintPolicy(symbol, tradeStyle);

    // Determine the SL we'll use for R:R calculations
    // If Alpha already proposed an SL, use that; otherwise use recommended
    const referenceSLPips = proposedStopLoss
      ? calculatePipDistance(symbol, entry, proposedStopLoss)
      : stopLossCalc.stopLossPips;

    // Use resolved minimum R:R if provided, otherwise derive from style (SSOT: trading-constants.ts)
    const minRiskReward = resolvedPlan?.minRR ?? TRADING_CONSTANTS.RISK_REWARD_RATIOS.MINIMUM;

    // CCIP-2026-03-06 / CCIP-ALPHA-GOV-001: Maximum R:R per style.
    // This call runs PRE-ALPHA — Alpha has not yet returned rr_ceiling_override.
    // Static style ceiling is the correct pre-Alpha default. Alpha's override is applied
    // POST-DECISION in the orchestrator via validateAlphaRRCeiling().
    const styleForMaxRR = STYLE_MAP[tradeStyle] || tradeStyle;
    const staticRRCeiling = getMaxRRForStyle(styleForMaxRR);
    const maxRiskReward = input.rr_ceiling_override != null
      ? Math.min(input.rr_ceiling_override, TRADING_CONSTANTS.RISK_REWARD_RATIOS.MAXIMUM_INTRADAY)
      : staticRRCeiling;

    // Calculate MINIMUM TP for the resolved minimum R:R
    const idealMinTakeProfitPips = referenceSLPips * minRiskReward;

    // CCIP-2026-03-06: Calculate MAXIMUM TP from style R:R ceiling
    // This caps Alpha's TP so it stays within the style band.
    const rrCeilingMaxTakeProfitPips = referenceSLPips * maxRiskReward;

    // ARCHITECTURAL CHANGE (v2.0): Session time is ADVISORY ONLY
    // Session time NEVER limits TP - it only provides information for:
    // - Confidence scoring adjustments
    // - Learning/tracking purposes
    // - NO_TRADE decisions when style band is exceeded (style is IMMUTABLE)
    //
    // CCIP-2026-03-06: TP maximum is the LESSER of ATR-based max and R:R ceiling.
    // This enforces the per-style R:R band: Scalp 1:1, Micro 1-2:1, Intraday 1-3:1.
    let maxTakeProfitPips: number = Math.min(atrBasedMaxTP_PIPS, rrCeilingMaxTakeProfitPips);
    let sessionConstraintMode: 'ADVISORY' | 'NONE';
    let tpReasoningSuffix = '';

    if (is24HourMarket) {
      // 24/7 markets: No session constraints at all
      sessionConstraintMode = 'NONE';
      tpReasoningSuffix = ' | 24/7 market - no session constraints';
      console.log(`[Omega-9] ${symbol} is 24/7 market - session constraints disabled`);
    } else {
      // Forex/indices with session-based trading hours
      switch (sessionConstraintPolicy) {
        case 'ENFORCED':
          // Even ENFORCED is now ADVISORY - no TP ceiling
          sessionConstraintMode = 'ADVISORY';

          if (feasibleTravelPips < idealMinTakeProfitPips) {
            tpReasoningSuffix = ` | ADVISORY: ${tradeStyle} minimum TP requires ${idealMinTakeProfitPips.toFixed(1)} pips but only ${feasibleTravelPips.toFixed(1)} pips feasible in ${sessionTimeRemainingMinutes}min remaining. Alpha has full authority to assess whether R:R geometry is achievable.`;
          }
          break;

        case 'ADVISORY':
          // INTRADAY: Session-time ADVISORY - no TP ceiling
          sessionConstraintMode = 'ADVISORY';

          if (idealMinTakeProfitPips > feasibleTravelPips) {
            tpReasoningSuffix = ` | ADVISORY: ${tradeStyle} trade minimum TP requires ${idealMinTakeProfitPips.toFixed(1)} pips, ${feasibleTravelPips.toFixed(1)} pips feasible in ${sessionTimeRemainingMinutes}min remaining. Trade may extend into next session.`;
          }
          break;

        case 'NONE':
          // SWING or 24/7 market: Session-time NONE - no session constraints
          sessionConstraintMode = 'NONE';

          if (assetClassifier.is24HourMarket(symbol)) {
            tpReasoningSuffix = ` | 24/7 market - no session constraints`;
          } else {
            tpReasoningSuffix = ` | ${tradeStyle} trade - session timing not applicable`;
          }
          break;
      }
    }

    const targetTakeProfitPips = referenceSLPips * TRADING_CONSTANTS.RISK_REWARD_RATIOS.MINIMUM;
    const optimalTakeProfitPips = Math.min(referenceSLPips * maxRiskReward, maxTakeProfitPips);

    // Build constraint violations (empty initially, used for validation later)
    const violations: ConstraintViolation[] = [];

    // CCIP (2026-02-17): Align Omega-9 constraint ranges with envelope wall bounds
    // This prevents Alpha from receiving conflicting guidance where Omega-9 says
    // "SL 10-20 pips" but the envelope wall requires "SL >= 14 pips".
    // SSOT: Envelope bounds are the authoritative source for style SL/TP ranges.
    const assetCategory = assetClassifier.getAssetCategory(symbol);
    const envelopeAssetClass = this.mapAssetCategoryToEnvelope(assetCategory);
    const envelopeBounds = getAssetClassEnvelopeBounds(mappedStyle, envelopeAssetClass, symbol, entry);

    // Set minimum TP, ensuring it respects the envelope TP floor.
    // CCIP (2026-02-17): Use envelope TP min as floor to prevent Alpha from proposing
    // TP values that satisfy R:R but violate the style envelope wall.
    //
    // CCIP-2026-03-10: When WallCalibrationEngine has run, it provides a
    // calibratedEnvelopeTpMinPips that compresses the floor for low/medium volatility
    // via TP_FLOOR_RATIO_BY_REGIME. Use that calibrated floor when available —
    // it prevents the zero-width corridor where envelopeTpMin >= maxTakeProfitPips
    // causes every structural TP to be wall-violated and forced to NO_TRADE.
    // The raw envelope floor (envelopeBounds.tpPips.min) remains the style IDENTITY
    // reference in the prompt; only the wall boundary here uses the calibrated value.
    const rawEnvelopeTpMin = envelopeBounds.tpPips.min;
    const envelopeTpMin = resolvedPlan?.calibratedEnvelopeTpMinPips != null
      ? resolvedPlan.calibratedEnvelopeTpMinPips
      : rawEnvelopeTpMin;

    if (resolvedPlan?.calibratedEnvelopeTpMinPips != null && resolvedPlan.calibratedEnvelopeTpMinPips < rawEnvelopeTpMin) {
      console.log(
        `[Omega-9 TP Floor] ${symbol}: Using calibrated TP floor ${envelopeTpMin.toFixed(1)} pips ` +
        `(vs raw envelope floor ${rawEnvelopeTpMin.toFixed(1)} pips) — low-vol corridor adjustment`
      );
    }

    let envelopeAlignedProfileMin = stopLossCalc.profileMinPips;
    let envelopeAlignedProfileMax = stopLossCalc.profileMaxPips;

    if (envelopeBounds.slPips.min > envelopeAlignedProfileMin) {
      console.log(`[Omega-9 Envelope Align] ${symbol}: Raising SL min from ${envelopeAlignedProfileMin.toFixed(1)} to ${envelopeBounds.slPips.min.toFixed(1)} pips (envelope floor for ${mappedStyle} ${envelopeAssetClass})`);
      envelopeAlignedProfileMin = envelopeBounds.slPips.min;
    }

    if (envelopeBounds.slPips.max > envelopeAlignedProfileMax) {
      console.log(`[Omega-9 Envelope Align] ${symbol}: Raising SL max from ${envelopeAlignedProfileMax.toFixed(1)} to ${envelopeBounds.slPips.max.toFixed(1)} pips (envelope ceiling for ${mappedStyle} ${envelopeAssetClass})`);
      envelopeAlignedProfileMax = envelopeBounds.slPips.max;
    }

    // CCIP (2026-02-17): Envelope percentage bounds are the SOLE style wall authority.
    // Noise floor is advisory intelligence for Alpha, NOT a constraint that raises the SL minimum.
    // Previous behavior: Math.max(envelopeMin, noiseFloor) -- this inflated SL min, caused
    // SSOT_MATH_CORRUPTION cascades, and required envelope expansion hacks (1.5x multiplier).
    // New behavior: Envelope bounds define the wall. Alpha sees the noise floor as market intel.
    const finalMinStopLoss = envelopeAlignedProfileMin;
    const finalMaxStopLoss = envelopeAlignedProfileMax;

    // CCIP-2026-04-02: Fix TP ceiling suppression root cause.
    //
    // Problem: maxTakeProfitPips was calculated pre-envelope-alignment as:
    //   rrCeilingMaxTakeProfitPips = referenceSLPips × maxRiskReward
    // where referenceSLPips = stopLossCalc.stopLossPips (raw recommended stop, e.g. 20 pips for
    // SCALP US30). This produces a TP ceiling of 20 × 2.0 = 40 pips.
    //
    // Meanwhile, the noise floor for US30 = 1.15 × ATR = ~106 pips, and the envelope TP max
    // for US30 SCALP at $47k = 0.35% × price = ~164 pips.
    //
    // Alpha sees: "noise floor 106 pips (you might get stopped out below this)" vs
    //             "TP max 40 pips" → infers R:R ≤ 0.37:1 → returns NO_TRADE. Correct logic,
    //             wrong input data (TP ceiling was incorrectly suppressed).
    //
    // Fix: After envelope alignment, recalculate referenceSLPips using the envelope SL floor
    // so that rrCeilingMaxTakeProfitPips correctly scales with the actual style wall, not the
    // raw profile recommendation. Then raise maxTakeProfitPips to the envelope TP ceiling as
    // a floor — the envelope is the authoritative style boundary, not the SL×RR formula.
    const envelopeAlignedReferenceSL = Math.max(referenceSLPips, envelopeAlignedProfileMin);
    const envelopeAlignedRRCeilingTP = envelopeAlignedReferenceSL * maxRiskReward;
    const envelopeTpMax = envelopeBounds.tpPips.max;

    if (envelopeAlignedRRCeilingTP > maxTakeProfitPips || envelopeTpMax > maxTakeProfitPips) {
      const correctedTP = Math.max(maxTakeProfitPips, envelopeAlignedRRCeilingTP, envelopeTpMax);
      // Only raise to ATR-based max if the ATR max is larger (don't exceed market capacity)
      const atrCappedTP = Math.min(correctedTP, atrBasedMaxTP_PIPS);
      console.log(
        `[Omega-9 TP Ceiling Fix] ${symbol}: TP ceiling raised from ${maxTakeProfitPips.toFixed(1)} pips → ${atrCappedTP.toFixed(1)} pips ` +
        `(envelope SL floor ${envelopeAlignedProfileMin.toFixed(1)}p × ${maxRiskReward}x = ${envelopeAlignedRRCeilingTP.toFixed(1)}p | ` +
        `envelope TP max ${envelopeTpMax.toFixed(1)}p | ATR cap ${atrBasedMaxTP_PIPS.toFixed(1)}p)`
      );
      maxTakeProfitPips = atrCappedTP;
    }

    // Recalculate minTakeProfitPips AFTER maxTakeProfitPips has been corrected by envelope alignment.
    // Previously this ran before the TP ceiling fix, causing minTakeProfitPips to be clamped
    // against the old suppressed maxTakeProfitPips (40 pips for US30 SCALP).
    const minTakeProfitPips = Math.min(
      Math.max(idealMinTakeProfitPips, envelopeTpMin),
      maxTakeProfitPips
    );
    const constraintFeasibilityWarning = '';

    // Build take-profit reasoning with style-aware session context
    const baseTpReasoning = `Minimum: ${minTakeProfitPips.toFixed(1)} pips (R:R ≥ ${minRiskReward.toFixed(1)}:1). Maximum: ${maxTakeProfitPips.toFixed(1)} pips (R:R ≤ ${maxRiskReward.toFixed(1)}:1 — style ceiling). Alpha scales TP freely within this band.`;
    const fullTpReasoning = constraintFeasibilityWarning || (baseTpReasoning + tpReasoningSuffix);

    const constraints: Omega9Constraints = {
      // Context (SSOT: Constraints know their context for absolute price calculations)
      symbol,
      entryPrice: entry,
      direction,

      // Stop-Loss Constraints (NOW ALWAYS VALID: min <= max)
      minStopLossPips: finalMinStopLoss,
      maxStopLossPips: finalMaxStopLoss,
      recommendedStopLossPips: stopLossCalc.stopLossPips,
      stopLossReasoning: stopLossCalc.reasoning,

      // Noise Floor (statistical minimum for survival)
      noiseFloorPips: noiseFloor.noiseFloorPips,
      noiseFloorReasoning: noiseFloor.reasoning,

      // Take-Profit Constraints
      minTakeProfitPips,
      maxTakeProfitPips,
      recommendedTakeProfitPips: Math.min(targetTakeProfitPips, maxTakeProfitPips),
      takeProfitReasoning: fullTpReasoning,

      // Risk:Reward Constraints (CCIP-2026-03-06: band enforced via min+max)
      minRiskReward,
      targetRiskReward: Math.min(1.5, maxRiskReward),
      optimalRiskReward: maxRiskReward,

      // Session Constraints
      sessionTimeRemaining: sessionTimeRemainingMinutes,
      volatilityPerHour,
      feasibleTravelPips,
      sessionConstraintMode,

      violations
    };

    // ✅ FEASIBILITY VALIDATION (SSOT - Single Source of Truth)
    // Use dedicated validator to check constraint internal consistency
    const conflictSource = feasibleTravelPips < maxTakeProfitPips ? 'SESSION_TIME' : 'MARKET_ATR';
    const feasibilityStatus = constraintFeasibilityValidator.validateConstraintPair(
      minTakeProfitPips,
      maxTakeProfitPips,
      minRiskReward,
      referenceSLPips,
      conflictSource,
      symbol,
      tradeStyle
    );

    const isInfeasible = !feasibilityStatus.isFeasible;
    const maxAchievableRR = feasibilityStatus.maxRiskRewardAchievable;

    // Detect session-travel vs TP-floor infeasibility (geometric mismatch, not market quality)
    const tpFloorExceedsTravel = feasibleTravelPips > 0 && minTakeProfitPips > feasibleTravelPips;
    const slFloorExceedsTravel = feasibleTravelPips > 0 && constraints.minStopLossPips > feasibleTravelPips;

    if (slFloorExceedsTravel) {
      console.warn(
        `[Omega-9 SESSION_GEOMETRY_ADVISORY] ${symbol}: ` +
        `Min SL floor ${constraints.minStopLossPips.toFixed(1)} pips vs session feasible travel ${feasibleTravelPips.toFixed(1)} pips. ` +
        `Session geometry data provided to Alpha — Alpha retains full trade authority.`
      );
      constraints.violations.push({
        type: 'STRUCTURAL_CONSTRAINT_VIOLATION' as any,
        severity: 'WARNING',
        message: `SESSION GEOMETRY DATA: Min SL floor (${constraints.minStopLossPips.toFixed(1)} pips) vs session feasible travel (${feasibleTravelPips.toFixed(1)} pips) in ${sessionTimeRemainingMinutes}min ${currentSession} session. Alpha has full authority to trade or pass based on this data.`,
        suggestedFix: `Advisory data: SL floor ${constraints.minStopLossPips.toFixed(1)}p vs session travel ${feasibleTravelPips.toFixed(1)}p. If you choose NO_TRADE, describe the actual reason. Alpha decides.`
      });
    }

    if (tpFloorExceedsTravel && !slFloorExceedsTravel) {
      console.warn(
        `[Omega-9 SESSION_TP_ADVISORY] ${symbol}: ` +
        `Min TP floor ${minTakeProfitPips.toFixed(1)} pips vs session feasible travel ${feasibleTravelPips.toFixed(1)} pips in ${sessionTimeRemainingMinutes}min ${currentSession}. ` +
        `Session travel data provided to Alpha — Alpha retains full trade authority.`
      );
      constraints.violations.push({
        type: 'GEOMETRIC_TP_CONSTRAINT' as any,
        severity: 'WARNING',
        message: `SESSION TRAVEL DATA: Min TP floor (${minTakeProfitPips.toFixed(1)} pips) vs session feasible travel (${feasibleTravelPips.toFixed(1)} pips) in ${sessionTimeRemainingMinutes}min of ${currentSession} session. Alpha has full authority to trade, adjust TP, or pass.`,
        suggestedFix: `Advisory data only. Alpha may trade with current TP, widen session outlook, or pass — your call. If you pass, state the actual reason for your decision.`
      });
    }

    if (isInfeasible) {
      console.warn('[Omega-9 Constraints] ⚠️ FEASIBILITY ADVISORY: Constraint conflict detected');
      console.warn(`[Omega-9 Constraints] Min TP: ${minTakeProfitPips.toFixed(1)} pips > Max TP: ${maxTakeProfitPips.toFixed(1)} pips`);
      console.warn(`[Omega-9 Constraints] Required R:R: ${minRiskReward.toFixed(2)}:1 | Max Achievable: ${maxAchievableRR.toFixed(2)}:1`);
      console.warn(`[Omega-9 Constraints] Root cause: ${conflictSource === 'SESSION_TIME' ? 'Session time constraint limits available TP' : 'Market volatility (ATR) insufficient for required R:R'}`);

      // Add ADVISORY violation with full context (NOT auto-correcting)
      constraints.violations.push({
        type: 'TIGHT_CONSTRAINTS',
        severity: 'WARNING',
        message: feasibilityStatus.advisoryMessage,
        suggestedFix: `ADVISORY: Alpha has full authority to decide. Options:\n${feasibilityStatus.alphaOptions.map(opt => `- ${opt}`).join('\n')}`
      });

      // CRITICAL: DO NOT auto-correct constraints
      // Return unmodified constraints + advisory state
      // Alpha will see this in the prompt and make informed decision
      console.log('[Omega-9 Constraints] ✅ Feasibility advisory generated - Alpha retains full authority');
    }

    // Add feasibility status to constraints (for governance tracking and Alpha awareness)
    constraints.feasibilityStatus = feasibilityStatus;

    console.log('[Omega-9 Constraints] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`[Omega-9 Constraints] Symbol: ${symbol} | Direction: ${direction} | Style: ${tradeStyle} | Risk: ${riskMode.toUpperCase()}`);
    console.log(`[Omega-9 Constraints] Noise Floor: ${constraints.noiseFloorPips.toFixed(1)} pips (${constraints.noiseFloorReasoning})`);
    console.log(`[Omega-9 Constraints] Stop-Loss Range: ${constraints.minStopLossPips.toFixed(1)} - ${constraints.maxStopLossPips.toFixed(1)} pips (recommended: ${constraints.recommendedStopLossPips.toFixed(1)})`);
    console.log(`[Omega-9 Constraints] Take-Profit Range: ${constraints.minTakeProfitPips.toFixed(1)} - ${constraints.maxTakeProfitPips.toFixed(1)} pips (recommended: ${constraints.recommendedTakeProfitPips.toFixed(1)})`);
    console.log(`[Omega-9 Constraints] R:R Requirements: Min ${constraints.minRiskReward}:1 | Target ${constraints.targetRiskReward}:1 | Optimal ${constraints.optimalRiskReward}:1`);
    console.log(`[Omega-9 Constraints] Session: ${currentSession} (${sessionTimeRemainingMinutes}min remaining) | Feasible travel: ${feasibleTravelPips.toFixed(1)} pips | Mode: ${sessionConstraintMode}`);

    if (isInfeasible) {
      console.error(`[Omega-9 Constraints] ⚠️ INFEASIBLE: Constraints conflict - Max achievable R:R is ${maxAchievableRR.toFixed(2)}:1 (need ${minRiskReward.toFixed(2)}:1)`);
    }

    console.log('[Omega-9 Constraints] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // ✅ CRYPTO SCALE MISMATCH DIAGNOSTIC (NON-BLOCKING)
    // Detect when crypto TP is suspiciously small relative to SL (likely scale error)
    if (assetClassifier.isCrypto(symbol)) {
      const tpToSLRatio = constraints.minTakeProfitPips / referenceSLPips;

      if (tpToSLRatio < 0.2) {
        // TP is less than 20% of SL - very suspicious for crypto
        console.error('[Omega-9 Crypto Scale] 🚨 DIAGNOSTIC: Crypto scale mismatch detected (NON-BLOCKING)');
        console.error(`[Omega-9 Crypto Scale] ${symbol}: TP ${constraints.minTakeProfitPips.toFixed(0)} pips / SL ${referenceSLPips.toFixed(0)} pips = ${(tpToSLRatio * 100).toFixed(1)}% ratio`);
        console.error(`[Omega-9 Crypto Scale] This suggests a calculation error in session constraints or ATR scaling`);
        console.error(`[Omega-9 Crypto Scale] Expected: TP should be at least 20-50% of SL for crypto trades`);
        console.error(`[Omega-9 Crypto Scale] Root cause likely: Session time constraint crushing TP for 24/7 market`);
        console.error(`[Omega-9 Crypto Scale] Recommendation: Verify 24/7 market detection and session constraint exemption`);

        // Add diagnostic warning (NOT blocking, just visibility)
        constraints.violations.push({
          type: 'CRYPTO_SCALE_MISMATCH',
          severity: 'WARNING',
          message: `Crypto scale diagnostic: TP/SL ratio ${(tpToSLRatio * 100).toFixed(1)}% (expected >20%) - possible calculation error`,
          suggestedFix: 'DIAGNOSTIC ONLY: This is informational. Alpha retains full authority. Check session constraint exemption for 24/7 markets.'
        });
      }
    }

    return constraints;
  }

  /**
   * Validate Alpha's decision against constraints
   * Returns violations (but does NOT block - that's Alpha's choice)
   */
  validateAgainstConstraints(
    decision: {
      entry: number;
      stopLoss: number;
      takeProfit: number;
      direction: 'BUY' | 'SELL';
    },
    constraints: Omega9Constraints,
    symbol: string
  ): ConstraintViolation[] {
    const violations: ConstraintViolation[] = [];

    const slPips = calculatePipDistance(symbol, decision.entry, decision.stopLoss);
    const tpPips = calculatePipDistance(symbol, decision.entry, decision.takeProfit);
    const rr = slPips > 0 ? tpPips / slPips : 0;

    // Check R:R minimum (WARNING, not ERROR - Alpha can override)
    if (rr < constraints.minRiskReward) {
      violations.push({
        type: 'MIN_RR',
        severity: 'WARNING',
        message: `R:R ${rr.toFixed(2)}:1 below minimum ${constraints.minRiskReward}:1`,
        suggestedFix: `Increase TP to ${constraints.minTakeProfitPips.toFixed(1)} pips for R:R ≥ 1.0`
      });
    }

    // Check TP maximum (ERROR - sanity check constraint)
    if (tpPips > constraints.maxTakeProfitPips) {
      violations.push({
        type: 'MAX_TP',
        severity: 'ERROR',
        message: `TP ${tpPips.toFixed(1)} pips exceeds maximum ${constraints.maxTakeProfitPips.toFixed(1)} pips`,
        suggestedFix: `Reduce TP to ${constraints.maxTakeProfitPips.toFixed(1)} pips maximum`
      });
    }

    // Check SL range (WARNING - professional guidance)
    if (slPips < constraints.minStopLossPips) {
      violations.push({
        type: 'MIN_SL',
        severity: 'WARNING',
        message: `SL ${slPips.toFixed(1)} pips below recommended minimum ${constraints.minStopLossPips.toFixed(1)} pips`,
        suggestedFix: `Consider widening SL to ${constraints.recommendedStopLossPips.toFixed(1)} pips`
      });
    }

    if (slPips > constraints.maxStopLossPips) {
      violations.push({
        type: 'MAX_SL',
        severity: 'WARNING',
        message: `SL ${slPips.toFixed(1)} pips above recommended maximum ${constraints.maxStopLossPips.toFixed(1)} pips`,
        suggestedFix: `Consider tightening SL to ${constraints.recommendedStopLossPips.toFixed(1)} pips`
      });
    }

    return violations;
  }

  /**
   * REMOVED: autoCorrectDecision() method
   *
   * ALPHA AUTHORITY PRINCIPLE:
   * This service provides constraint boundaries for Alpha, but does NOT auto-correct decisions.
   * Only Alpha may decide SL/TP values.
   *
   * Previous behavior: Auto-corrected TP to meet R:R and maximum pip constraints
   * New behavior: Constraints are provided to Alpha upfront; violations trigger Alpha Repair Pass
   *
   * Use getConstraintRanges() for advisory ranges
   * Use validateAgainstConstraints() for violation detection
   */

  /**
   * Get constraint ranges for Alpha Repair (advisory only)
   * Returns price ranges, not corrections
   */
  getConstraintRanges(
    entry: number,
    direction: 'BUY' | 'SELL',
    constraints: Omega9Constraints,
    symbol: string
  ): {
    slRange: { min: number; max: number; unit: string };
    tpRange: { min: number; max: number; unit: string };
    rrRange: { min: number; max: number; unit: string };
  } {
    const pipInfo = getCurrencyPipInfo(symbol);
    const isBuy = direction === 'BUY';

    // Calculate SL price range
    const minSLPriceDistance = constraints.minStopLossPips * pipInfo.pipValue;
    const maxSLPriceDistance = constraints.maxStopLossPips * pipInfo.pipValue;

    const slRange = {
      min: isBuy ? entry - maxSLPriceDistance : entry + minSLPriceDistance,
      max: isBuy ? entry - minSLPriceDistance : entry + maxSLPriceDistance,
      unit: 'price'
    };

    // Calculate TP price range
    const minTPPriceDistance = constraints.minTakeProfitPips * pipInfo.pipValue;
    const maxTPPriceDistance = constraints.maxTakeProfitPips * pipInfo.pipValue;

    const tpRange = {
      min: isBuy ? entry + minTPPriceDistance : entry - maxTPPriceDistance,
      max: isBuy ? entry + maxTPPriceDistance : entry - minTPPriceDistance,
      unit: 'price'
    };

    const rrRange = {
      min: constraints.minRiskReward,
      max: constraints.maxRiskReward || 5.0, // Default max if not specified
      unit: 'ratio'
    };

    return { slRange, tpRange, rrRange };
  }

  /**
   * Calculate absolute price ranges from pip-based constraints
   * SSOT: This eliminates arithmetic burden from Alpha LLM
   */
  private calculateAbsolutePriceRanges(constraints: Omega9Constraints): {
    stopLoss: { min: number; max: number; recommended: number };
    takeProfit: { min: number; max: number; recommended: number };
  } {
    const { symbol, entryPrice, direction } = constraints;
    const pipInfo = getCurrencyPipInfo(symbol);
    const isBuy = direction === 'BUY';

    // Calculate SL absolute prices
    const minSLDistance = constraints.minStopLossPips * pipInfo.pipValue;
    const maxSLDistance = constraints.maxStopLossPips * pipInfo.pipValue;
    const recSLDistance = constraints.recommendedStopLossPips * pipInfo.pipValue;

    const stopLoss = {
      min: isBuy ? entryPrice - maxSLDistance : entryPrice + minSLDistance,
      max: isBuy ? entryPrice - minSLDistance : entryPrice + maxSLDistance,
      recommended: isBuy ? entryPrice - recSLDistance : entryPrice + recSLDistance
    };

    // Calculate TP absolute prices
    const minTPDistance = constraints.minTakeProfitPips * pipInfo.pipValue;
    const maxTPDistance = constraints.maxTakeProfitPips * pipInfo.pipValue;
    const recTPDistance = constraints.recommendedTakeProfitPips * pipInfo.pipValue;

    const takeProfit = {
      min: isBuy ? entryPrice + minTPDistance : entryPrice - maxTPDistance,
      max: isBuy ? entryPrice + maxTPDistance : entryPrice - minTPDistance,
      recommended: isBuy ? entryPrice + recTPDistance : entryPrice - recTPDistance
    };

    return { stopLoss, takeProfit };
  }

  /**
   * Format constraints for inclusion in Alpha's prompt
   * ENHANCED: Includes pre-calculated absolute prices to eliminate LLM arithmetic errors
   * CRITICAL: If constraints are infeasible, includes full feasibility advisory from SSOT validator
   */
  formatConstraintsForPrompt(constraints: Omega9Constraints): string {
    // Calculate absolute price ranges (SSOT: eliminates LLM arithmetic burden)
    const absolutePrices = this.calculateAbsolutePriceRanges(constraints);
    const { symbol, entryPrice, direction } = constraints;

    // Get symbol config for context
    const symbolConfig = getSymbolConfig(symbol);
    const displayName = symbolConfig?.displayName || symbol;
    const decimalPlaces = symbolConfig?.decimalPlaces || 5;

    // Determine if constraints are tight (R:R below standard)
    const tightConstraints = constraints.minRiskReward < TRADING_CONSTANTS.RISK_REWARD_RATIOS.MINIMUM;

    // CRITICAL: Build feasibility advisory from SSOT validator
    let advisoryNote = '';
    if (constraints.feasibilityStatus && !constraints.feasibilityStatus.isFeasible) {
      const fs = constraints.feasibilityStatus;
      advisoryNote = `
╔════════════════════════════════════════════════════════════════════╗
║           CONSTRAINT FEASIBILITY ADVISORY (FROM OMEGA-9)           ║
╚════════════════════════════════════════════════════════════════════╝

⚠️ MARKET REALITY VS STYLE REQUIREMENTS:

Your original R:R requirement: ${fs.minRiskRewardRequired.toFixed(2)}:1
Maximum market can deliver: ${fs.maxRiskRewardAchievable.toFixed(2)}:1
Gap: ${((fs.minRiskRewardRequired - fs.maxRiskRewardAchievable) / fs.minRiskRewardRequired * 100).toFixed(1)}%

Why: ${fs.conflictSource === 'SESSION_TIME' ? 'Session time constraint is limiting available TP distance' : 'Market volatility (ATR) insufficient for required R:R multiple'}

${fs.advisoryMessage}

YOUR DECISION OPTIONS:
${fs.alphaOptions.map((opt, i) => `${i + 1}. ${opt}`).join('\n')}

CRITICAL PRINCIPLE:
This is NOT a trade error. This is market reality speaking.
You retain FULL AUTHORITY to decide:
✓ Accept reduced R:R if setup quality justifies it
✓ Skip this trade and wait for better conditions (NO_TRADE)
✓ Widen stop loss to improve R:R at current constraints
✓ Accept higher position risk with lower R:R

STYLE IMMUTABILITY: You MUST NOT upgrade or change the trade style. If the style cannot accommodate this trade, return NO_TRADE.

Remember: Reduced profit > NO_TRADE > Forced compliance with impossible constraints.
═══════════════════════════════════════════════════════════════════════
`;
    } else if (constraints.minRiskReward < TRADING_CONSTANTS.RISK_REWARD_RATIOS.MINIMUM) {
      advisoryNote = `
⚠️ ADVISORY: Tight Market Conditions
Maximum achievable R:R is ${constraints.minRiskReward.toFixed(2)}:1 (below minimum ${TRADING_CONSTANTS.RISK_REWARD_RATIOS.MINIMUM}:1).
ADVISORY: Consider accepting lower R:R if setup quality justifies, or tighten SL.
Remember: Reduced profit > NO_TRADE. You have FINAL AUTHORITY to proceed.
`;
    }

    return `
TRADE CONTEXT:
Symbol: ${displayName} (${symbol})
Direction: ${direction}
Entry Price: ${entryPrice.toFixed(decimalPlaces)}
Session: ${constraints.sessionTimeRemaining} minutes remaining

GEOMETRY REQUIREMENT (the only hard rule):
${direction === 'BUY' ? 'BUY: takeProfit > entry > stopLoss' : 'SELL: takeProfit < entry < stopLoss'}
Place SL behind your named invalidation level. Place TP at your named structural target. R:R accountability is yours.

AUTHORITY: You place SL and TP where market structure demands. Choose LONG, SHORT, or NO_TRADE based on whether a structural edge exists.
`;
  }

  // ============================================================================
  // DUAL-ARENA WALL COMPUTATION (v3.0)
  // ============================================================================

  generateDualArenaWalls(input: DualArenaInput): DualArenaWalls {
    const envelopeStyle = this.mapTradeStyleToEnvelopeStyle(input.tradeStyle);
    const envelope = getExecutionEnvelope(envelopeStyle);
    const assetCategory = assetClassifier.getAssetCategory(input.symbol);
    const envelopeAssetClass = this.mapAssetCategoryToEnvelope(assetCategory);

    const sharedInput = {
      symbol: input.symbol,
      entry: input.entry,
      atr: input.atr,
      tradeStyle: input.tradeStyle,
      dollarRisk: 0,
      riskMode: input.riskMode,
      currentSession: input.currentSession,
      sessionTimeRemainingMinutes: input.sessionTimeRemainingMinutes,
      volatilityRegime: input.volatilityRegime,
      resolvedPlan: input.resolvedPlan,
      // CCIP-ALPHA-GOV-001: Pass Alpha's per-trade R:R ceiling override through.
      rr_ceiling_override: input.rr_ceiling_override,
    };

    const buyConstraints = this.generateConstraints({ ...sharedInput, direction: 'BUY' });
    const sellConstraints = this.generateConstraints({ ...sharedInput, direction: 'SELL' });

    const longWalls = this.buildArenaWalls(buyConstraints, envelopeStyle, envelopeAssetClass, input.symbol, input.entry);
    const shortWalls = this.buildArenaWalls(sellConstraints, envelopeStyle, envelopeAssetClass, input.symbol, input.entry);

    console.log(`[Dual-Arena] ${input.symbol} walls computed | Long viable: ${longWalls.feasible} | Short viable: ${shortWalls.feasible}`);

    return {
      symbol: input.symbol,
      entryPrice: input.entry,
      style: envelopeStyle,
      riskMode: input.riskMode,
      long: longWalls,
      short: shortWalls,
      sessionTimeRemaining: buyConstraints.sessionTimeRemaining,
      volatilityPerHour: buyConstraints.volatilityPerHour,
      feasibleTravelPips: buyConstraints.feasibleTravelPips,
      sessionConstraintMode: buyConstraints.sessionConstraintMode === 'BLOCKING'
        ? 'ADVISORY'
        : buyConstraints.sessionConstraintMode as 'ADVISORY' | 'NONE',
      durationBand: envelope.typicalDuration,
      targetCandles: envelope.targetCandles,
      timeframe: envelope.timeframe,
      entryMode: envelope.entryMode,
      correlationExposure: null,
      violations: [...buyConstraints.violations, ...sellConstraints.violations],
    };
  }

  private buildArenaWalls(
    constraints: Omega9Constraints,
    envelopeStyle: string,
    envelopeAssetClass: EnvelopeAssetClass,
    symbol: string,
    entryPrice: number
  ): ArenaWalls {
    const absolutePrices = this.calculateAbsolutePriceRanges(constraints);

    // CCIP (2026-02-17): Constraint sandwich is now advisory-only.
    // Envelope bounds define the style wall. Noise floor is market intelligence.
    // The arena is always feasible if the envelope range is valid (min < max).
    const feasibilityAdvisory = constraints.feasibilityStatus && !constraints.feasibilityStatus.isFeasible
      ? constraints.feasibilityStatus.advisoryMessage
      : null;

    const noiseExceedsEnvelope = constraints.noiseFloorPips > constraints.maxStopLossPips;
    const noiseAdvisory = noiseExceedsEnvelope
      ? `High noise: ${constraints.noiseFloorPips.toFixed(1)} pips exceeds SL max ${constraints.maxStopLossPips.toFixed(1)} pips -- wide stops recommended`
      : null;

    return {
      direction: constraints.direction,
      slPrice: absolutePrices.stopLoss,
      tpPrice: absolutePrices.takeProfit,
      slPips: {
        min: constraints.minStopLossPips,
        max: constraints.maxStopLossPips,
        recommended: constraints.recommendedStopLossPips,
      },
      tpPips: {
        min: constraints.minTakeProfitPips,
        max: constraints.maxTakeProfitPips,
        recommended: constraints.recommendedTakeProfitPips,
      },
      noiseFloorPips: constraints.noiseFloorPips,
      minRiskReward: constraints.minRiskReward,
      feasible: true,
      sandwiched: false,
      sandwichAdvisory: noiseAdvisory,
      feasibilityAdvisory,
    };
  }

  formatDualArenaForPrompt(walls: DualArenaWalls): string {
    const { symbol, entryPrice, style } = walls;
    const symbolConfig = getSymbolConfig(symbol);
    const dp = symbolConfig?.decimalPlaces || 5;

    const sections = [
      'TRADE IDENTITY:',
      `  Symbol: ${symbolConfig?.displayName || symbol} | Entry: ${entryPrice.toFixed(dp)} | Style: ${style} (${walls.timeframe}) | Risk: ${walls.riskMode.toUpperCase()}`,
      `  Duration band: ${walls.durationBand.min}-${walls.durationBand.max} min | Entry mode: ${walls.entryMode}`,
      '',
      'SESSION:',
      `  Time Remaining: ${walls.sessionTimeRemaining} min`,
    ];

    if (walls.correlationExposure) {
      const longWarnings = walls.correlationExposure.longWarnings;
      const shortWarnings = walls.correlationExposure.shortWarnings;
      if (longWarnings.length > 0 || shortWarnings.length > 0) {
        sections.push('');
        sections.push('CORRELATION EXPOSURE:');
        if (longWarnings.length > 0) sections.push(`  Long risks: ${longWarnings.join('; ')}`);
        if (shortWarnings.length > 0) sections.push(`  Short risks: ${shortWarnings.join('; ')}`);
      }
    }

    sections.push('');
    sections.push('GEOMETRY REQUIREMENT (the only hard rule):');
    sections.push('  BUY: takeProfit > entry > stopLoss');
    sections.push('  SELL: takeProfit < entry < stopLoss');
    sections.push('');
    sections.push('Place SL behind your named invalidation level. Place TP at your named structural target.');
    sections.push('R:R accountability is yours. Choose LONG, SHORT, or NO_TRADE based on whether a structural edge exists.');

    return sections.join('\n');
  }

  private mapTradeStyleToEnvelopeStyle(tradeStyle: string): 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY' {
    switch (tradeStyle) {
      case 'scalper': return 'SCALP';
      case 'micro': return 'MICRO_INTRADAY';
      case 'intraday': return 'INTRADAY';
      default: return 'INTRADAY';
    }
  }

  private mapAssetCategoryToEnvelope(category: string): EnvelopeAssetClass {
    switch (category) {
      case 'crypto': return 'CRYPTO';
      case 'metal': return 'METAL';
      case 'index': return 'INDEX';
      default: return 'FOREX';
    }
  }

  /**
   * Estimate volatility per hour based on ATR and market conditions
   *
   * CRITICAL FIX: ATR is in PRICE UNITS, need to convert to PIPS for calculations
   *
   * SSOT COMPLIANCE:
   * - Session volatility multipliers delegated to sessionConstraintCoordinator
   * - 24/7 markets automatically get constant volatility profile
   */
  private estimateVolatilityPerHour(
    symbol: string,
    atr: number,
    volatilityRegime: 'low' | 'medium' | 'high',
    currentSession: string
  ): number {
    // Convert ATR from price units to pips first
    const pipInfo = getCurrencyPipInfo(symbol);
    const atrInPips = atr / pipInfo.pipValue;

    console.log(`[Omega-9 Volatility] ${symbol}: ATR ${atr.toFixed(6)} (${atrInPips.toFixed(2)} pips)`);

    // CCIP-2026-03-30 / SSOT-ALPHA-GOV-001: Regime multipliers REMOVED.
    //
    // Previous behaviour applied 0.7x for 'low' and 1.3x for 'high' regime.
    // Problem: Both multipliers distort the raw ATR signal that Alpha uses for
    // trade reasoning:
    //   - 0.7x during low-volatility (Asian session) stacks with the session
    //     multiplier, producing an artificially small feasibleTravelPips that
    //     nudges Alpha toward NO_TRADE on structurally valid setups.
    //   - 1.3x during high-volatility inflates feasibleTravelPips beyond what
    //     raw ATR justifies, misrepresenting risk capacity to Alpha.
    //
    // The regime label is kept in the contract so Alpha receives it as
    // informational context in the prompt — it just no longer warps the math.
    // Base: ATR * 1.5 (ATR is a 24-hr average; scale to per-hour rate)
    let baseVolatility = atrInPips * 1.5;

    // SSOT: Get session volatility multiplier from coordinator.
    // This handles 24/7 markets vs forex-hours markets.
    // Session is the ONLY structural modifier applied here — it reflects
    // real differences in market participation, not a regime opinion.
    const sessionMultiplier = sessionConstraintCoordinator.getSessionVolatilityMultiplier(
      symbol,
      currentSession as 'asian' | 'london' | 'ny' | 'overlap' | 'sydney' | 'dead'
    );

    baseVolatility *= sessionMultiplier;

    // ASSET-CLASS-AWARE VOLATILITY FLOORS (ADVISORY)
    // Safety floors only — Alpha retains full authority over trade decisions.
    let minimumVolatility: number;
    const assetCategory = assetClassifier.getAssetCategory(symbol);

    switch (assetCategory) {
      case 'crypto':
        minimumVolatility = 100.0;
        break;
      case 'index':
        minimumVolatility = 20.0;
        break;
      case 'metal':
        minimumVolatility = 10.0;
        break;
      case 'forex':
      case 'energy':
      default:
        minimumVolatility = 5.0;
    }

    if (baseVolatility < minimumVolatility) {
      console.warn(`[Omega-9 Volatility] ⚠️ ADVISORY: ${symbol} (${assetCategory}): Calculated volatility ${baseVolatility.toFixed(2)} pips/hour below ${assetCategory} minimum ${minimumVolatility} - using floor (advisory only, Alpha has final authority)`);
      baseVolatility = minimumVolatility;
    }

    console.log(`[Omega-9 Volatility] ${symbol} (${assetCategory}): Base ${(atrInPips * 1.5).toFixed(1)} → Regime: ${volatilityRegime} (no multiplier) → Session ${sessionMultiplier}x → Final ${baseVolatility.toFixed(1)} pips/hour (${assetCategory} floor: ${minimumVolatility})`);

    return baseVolatility;
  }

  /**
   * CCIP-ALPHA-GOV-001: Post-decision R:R ceiling validation.
   * Called AFTER Alpha returns with rr_ceiling_override to audit Alpha's TP
   * against Alpha's own stated ceiling. Alpha is the authority — this is audit only.
   * Returns null when no override is present (static ceiling applied pre-Alpha is sufficient).
   */
  validateAlphaRRCeiling(params: {
    symbol: string;
    entry: number;
    takeProfit: number;
    stopLoss: number;
    direction: 'BUY' | 'SELL';
    rr_ceiling_override: number;
    tradeStyle: string;
  }): { pass: boolean; actualRR: number; ceiling: number; auditNote: string } {
    const { symbol, entry, takeProfit, stopLoss, rr_ceiling_override, tradeStyle } = params;
    const tpPips = calculatePipDistance(symbol, entry, takeProfit);
    const slPips = calculatePipDistance(symbol, entry, stopLoss);
    const actualRR = slPips > 0 ? tpPips / slPips : 0;
    const ceiling = Math.min(rr_ceiling_override, TRADING_CONSTANTS.RISK_REWARD_RATIOS.MAXIMUM_INTRADAY);
    const pass = actualRR <= ceiling + 0.01;
    const auditNote = pass
      ? `Alpha RR=${actualRR.toFixed(2)} within Alpha-stated ceiling=${ceiling} (${tradeStyle})`
      : `Alpha RR=${actualRR.toFixed(2)} exceeds Alpha-stated ceiling=${ceiling} (${tradeStyle}) — TP outside Alpha's own ceiling`;
    return { pass, actualRR, ceiling, auditNote };
  }
}

export const omega9ConstraintProvider = new Omega9ConstraintProvider();
