import type { AlphaDecision, MarketContext, OmegaCouncilVotes } from '../brains/coordinator-alpha';
import type { EntryIntentType, EntryUrgencyLevel, TimeoutAction } from '../types/entry';
import type { MicroRegime } from './micro-regime-classifier';
import { logger } from '../lib/logger';
import { calculatePipDistance, getCurrencyPipInfo } from '../utils/currencyHelpers';
import { ADAPTIVE_ZONE_CONFIG, type ZoneType } from '../config/adaptive-zone-config';
import { RegimeZoneTypeSelector } from './regime-zone-type-selector';
import { ZoneCalculationInputProvider } from './zone-calculation-input-provider';
import { AdaptiveEntryZoneCalculator } from './adaptive-entry-zone-calculator';
import { ZoneReachabilityValidator } from './zone-reachability-validator';
import { applyPCPE, isPCPEEnabled } from './pcpe-execution-governor';
import type { PCPEInput } from '../types/pcpe';

export interface ClassifiedEntryIntent {
  intent_type: EntryIntentType;
  urgency: EntryUrgencyLevel;
  entry_zone_min: number;
  entry_zone_max: number;
  timeout_minutes: number;
  max_wait_seconds: number;
  timeout_action: TimeoutAction;
  invalidation_price: number;
  should_execute_immediately: boolean;

  // Adaptive zone fields (v2.0)
  zone_type?: ZoneType;
  primary_zone_min?: number;
  primary_zone_max?: number;
  secondary_zone_min?: number;
  secondary_zone_max?: number;
  zone_reachability_distance_pips?: number;
  micro_regime_used?: string;
  zone_downgrade_applied?: boolean;
  position_size_multiplier?: number;

  // PCPE governance fields (v3.0)
  pcpe_execution_band?: 'FULL' | 'REDUCED' | 'MICRO' | 'BLOCKED';
  pcpe_original_band?: 'FULL' | 'REDUCED' | 'MICRO';
  pcpe_downgrade_applied?: boolean;
  pcpe_downgrade_reason?: string;
  pcpe_distance_to_atr_ratio?: number;
}

export class EntryIntentClassifier {
  private static readonly IMMEDIATE_ZONE_PIPS = 3;
  private static readonly CLOSE_ENOUGH_PIPS = 8;

  static async classifyEntryIntent(
    decision: AlphaDecision,
    marketContext: MarketContext,
    votes: OmegaCouncilVotes,
    vwap?: number,
    microRegime?: MicroRegime
  ): Promise<ClassifiedEntryIntent | null> {
    if (decision.action === 'NO_TRADE') {
      return null;
    }

    // Check if adaptive zones are enabled
    const useAdaptiveZones = ADAPTIVE_ZONE_CONFIG.features.adaptive_zones_enabled;

    let finalEntryZone: { min: number; max: number };
    let zoneType: ZoneType | undefined;
    let primaryZone: { min: number; max: number } | undefined;
    let secondaryZone: { min: number; max: number } | undefined;
    let zoneReachabilityDistancePips: number | undefined;
    let zoneDowngradeApplied: boolean | undefined;
    let positionSizeMultiplier: number | undefined;

    if (useAdaptiveZones && microRegime) {
      // Use adaptive zone system (v2.0)
      const adaptiveResult = await this.calculateAdaptiveZones(
        decision,
        marketContext,
        microRegime
      );

      if (adaptiveResult) {
        finalEntryZone = adaptiveResult.primary;
        zoneType = adaptiveResult.zoneType;
        primaryZone = adaptiveResult.primary;
        secondaryZone = adaptiveResult.secondary;
        zoneReachabilityDistancePips = adaptiveResult.reachabilityDistancePips;
        zoneDowngradeApplied = adaptiveResult.downgradeApplied;
        positionSizeMultiplier = adaptiveResult.positionSizeMultiplier;

        logger.info(
          `[AdaptiveZones] Using ${zoneType} zone for ${microRegime} regime. ` +
          `Primary: ${primaryZone.min.toFixed(5)}-${primaryZone.max.toFixed(5)}, ` +
          `Secondary: ${secondaryZone.min.toFixed(5)}-${secondaryZone.max.toFixed(5)}`
        );
      } else {
        // Fallback to legacy zones if adaptive fails
        logger.warn('[AdaptiveZones] Failed to calculate adaptive zones, falling back to legacy');
        const entryZone = this.calculateEntryZone(decision, 'immediate_momentum', marketContext, decision.confidence);
        finalEntryZone = entryZone;
      }
    } else {
      // Use legacy zone calculation
      const entryZone = this.calculateEntryZone(decision, 'immediate_momentum', marketContext, decision.confidence);
      finalEntryZone = entryZone;
    }

    const distanceToZonePips = this.calculateDistanceToZone(
      marketContext.price,
      finalEntryZone.min,
      finalEntryZone.max,
      marketContext.symbol
    );

    const intentType = this.determineIntentTypeByPosition(
      distanceToZonePips,
      decision,
      marketContext,
      votes,
      vwap
    );

    // Recalculate zone with final intent type if using legacy zones
    if (!useAdaptiveZones || !microRegime) {
      finalEntryZone = this.calculateEntryZone(decision, intentType, marketContext, decision.confidence);
    }

    const urgency = this.determineUrgency(decision, marketContext, votes, intentType, distanceToZonePips);
    const maxWaitSeconds = this.calculateMaxWaitSeconds(urgency, intentType, marketContext);
    const timeoutMinutes = Math.ceil(maxWaitSeconds / 60);
    const timeoutAction = this.determineTimeoutAction(intentType, urgency);
    const invalidationPrice = this.calculateInvalidationPrice(decision, marketContext);

    const shouldExecuteImmediately = Math.abs(distanceToZonePips) <= this.IMMEDIATE_ZONE_PIPS;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // PCPE EXECUTION GOVERNOR v2.0 (HARDENED)
    // Runs AFTER zones are calculated, evaluates execution viability
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    let pcpeExecutionBand: 'FULL' | 'REDUCED' | 'MICRO' | 'BLOCKED' | undefined;
    let pcpeOriginalBand: 'FULL' | 'REDUCED' | 'MICRO' | undefined;
    let pcpeDowngradeApplied: boolean | undefined;
    let pcpeDowngradeReason: string | undefined;
    let pcpeDistanceToATRRatio: number | undefined;

    if (isPCPEEnabled() && useAdaptiveZones && zoneType && microRegime) {
      logger.info('[PCPE] ━━━ PCPE Execution Governor v2.0 ━━━');

      // CRITICAL: PCPE must receive final effective confidence (post-penalty)
      // NOT raw Alpha confidence
      const pcpeInput: PCPEInput = {
        final_effective_confidence: decision.confidence,  // Must be post-penalty
        zone_type: zoneType as 'PRIMARY' | 'SECONDARY' | 'CHASE',
        distance_to_zone_pips: Math.abs(distanceToZonePips),
        atr: marketContext.atr,
        spread: marketContext.spread || (marketContext.atr * 0.1), // Estimate if missing
        micro_regime: microRegime.regime,
        symbol: marketContext.symbol,
      };

      const pcpeResult = applyPCPE(pcpeInput);

      // Hard abort if blocked
      if (pcpeResult.execution_band === 'BLOCKED') {
        logger.warn(
          `[PCPE] 🚫 EXECUTION BLOCKED: ` +
          `band=${pcpeResult.execution_band}, ` +
          `conf=${decision.confidence.toFixed(1)}%, ` +
          `zone=${zoneType}, ` +
          `distance=${Math.abs(distanceToZonePips).toFixed(1)} pips, ` +
          `reason=${pcpeResult.block_reason}`
        );
        return null;  // No entry intent created
      }

      // Apply PCPE size multiplier to existing multiplier
      if (positionSizeMultiplier !== undefined) {
        positionSizeMultiplier = positionSizeMultiplier * pcpeResult.size_multiplier;
      } else {
        positionSizeMultiplier = pcpeResult.size_multiplier;
      }

      // Store PCPE audit fields
      pcpeExecutionBand = pcpeResult.execution_band;
      pcpeOriginalBand = pcpeResult.original_band;
      pcpeDowngradeApplied = pcpeResult.downgrade_applied;
      pcpeDowngradeReason = pcpeResult.downgrade_reason;
      pcpeDistanceToATRRatio = pcpeResult.audit.distance_to_atr_ratio;

      logger.info(
        `[PCPE] ✅ EXECUTION APPROVED: ` +
        `band=${pcpeResult.execution_band}, ` +
        `multiplier=${pcpeResult.size_multiplier}x, ` +
        `conf=${decision.confidence.toFixed(1)}%` +
        (pcpeResult.downgrade_applied ? ` (downgraded from ${pcpeResult.original_band})` : '')
      );
      logger.info(`[PCPE] Reasoning: ${pcpeResult.reasoning}`);
    }

    logger.info(
      `Entry intent classified (${decision.confidence}% conf): ${intentType} (${urgency}) - ` +
      `Entry zone: ${finalEntryZone.min.toFixed(5)}-${finalEntryZone.max.toFixed(5)} | ` +
      `Distance: ${distanceToZonePips.toFixed(1)} pips | ` +
      `Max wait: ${maxWaitSeconds}s | Timeout action: ${timeoutAction} | ` +
      `Execute immediately: ${shouldExecuteImmediately}` +
      (zoneType ? ` | Zone type: ${zoneType}` : '') +
      (pcpeExecutionBand ? ` | PCPE band: ${pcpeExecutionBand}` : '')
    );

    return {
      intent_type: intentType,
      urgency,
      entry_zone_min: finalEntryZone.min,
      entry_zone_max: finalEntryZone.max,
      timeout_minutes: timeoutMinutes,
      max_wait_seconds: maxWaitSeconds,
      timeout_action: timeoutAction,
      invalidation_price: invalidationPrice,
      should_execute_immediately: shouldExecuteImmediately,

      // Adaptive zone fields (v2.0)
      zone_type: zoneType,
      primary_zone_min: primaryZone?.min,
      primary_zone_max: primaryZone?.max,
      secondary_zone_min: secondaryZone?.min,
      secondary_zone_max: secondaryZone?.max,
      zone_reachability_distance_pips: zoneReachabilityDistancePips,
      micro_regime_used: microRegime,
      zone_downgrade_applied: zoneDowngradeApplied,
      position_size_multiplier: positionSizeMultiplier,

      // PCPE governance fields (v3.0)
      pcpe_execution_band: pcpeExecutionBand,
      pcpe_original_band: pcpeOriginalBand,
      pcpe_downgrade_applied: pcpeDowngradeApplied,
      pcpe_downgrade_reason: pcpeDowngradeReason,
      pcpe_distance_to_atr_ratio: pcpeDistanceToATRRatio,
    };
  }

  private static calculateDistanceToZone(
    currentPrice: number,
    zoneMin: number,
    zoneMax: number,
    symbol: string
  ): number {
    if (currentPrice >= zoneMin && currentPrice <= zoneMax) {
      return 0;
    }

    const closestEdge = currentPrice < zoneMin ? zoneMin : zoneMax;
    return calculatePipDistance(symbol, currentPrice, closestEdge);
  }

  private static determineIntentTypeByPosition(
    distanceToZonePips: number,
    decision: AlphaDecision,
    marketContext: MarketContext,
    votes: OmegaCouncilVotes,
    vwap?: number
  ): EntryIntentType {
    const absDistance = Math.abs(distanceToZonePips);

    if (absDistance <= this.IMMEDIATE_ZONE_PIPS) {
      return 'immediate_momentum';
    }

    if (absDistance <= this.CLOSE_ENOUGH_PIPS) {
      return 'immediate_momentum';
    }

    const reasoning = decision.reasoning.toLowerCase();

    if (reasoning.includes('breakout') && (reasoning.includes('retest') || reasoning.includes('pullback'))) {
      return 'break_and_retest';
    }

    if (vwap && Math.abs(marketContext.price - vwap) / vwap < 0.002) {
      if (reasoning.includes('vwap') || reasoning.includes('mean')) {
        return 'pullback_to_vwap';
      }
    }

    if (marketContext.regime === 'side' || reasoning.includes('range')) {
      return 'range_extreme';
    }

    if (reasoning.includes('retest') || reasoning.includes('structure')) {
      return 'retest_structure';
    }

    return 'pullback_to_support';
  }

  /**
   * Calculate adaptive zones using regime-aware zone models
   * SSOT orchestrator - delegates to specialized services
   */
  private static async calculateAdaptiveZones(
    decision: AlphaDecision,
    marketContext: MarketContext,
    microRegime: MicroRegime
  ): Promise<{
    primary: { min: number; max: number };
    secondary: { min: number; max: number };
    zoneType: ZoneType;
    reachabilityDistancePips: number;
    downgradeApplied: boolean;
    positionSizeMultiplier: number;
  } | null> {
    try {
      // Step 1: Select zone type based on regime
      const zoneTypeSelection = RegimeZoneTypeSelector.selectZoneType(microRegime);
      let selectedZoneType = zoneTypeSelection.zoneType;

      // Step 2: Gather technical inputs for zone calculation
      const inputs = await ZoneCalculationInputProvider.gatherInputs(
        marketContext.symbol,
        marketContext.price
      );

      if (!ZoneCalculationInputProvider.validateInputs(inputs)) {
        logger.error('[AdaptiveZones] Invalid inputs for zone calculation');
        return null;
      }

      // Step 3: Calculate zones using selected model
      let zones = AdaptiveEntryZoneCalculator.calculateZones(
        inputs,
        selectedZoneType,
        decision.action,
        decision.confidence
      );

      // Step 4: Validate reachability and potentially downgrade
      let reachability = ZoneReachabilityValidator.validate(zones, inputs);
      let downgradeApplied = false;

      // Auto-downgrade if unreachable and enabled
      if (
        reachability.shouldDowngrade &&
        reachability.downgradeTo &&
        ADAPTIVE_ZONE_CONFIG.features.auto_downgrade_enabled
      ) {
        logger.warn(
          `[AdaptiveZones] Zone unreachable, downgrading ${selectedZoneType} → ${reachability.downgradeTo}`
        );

        selectedZoneType = reachability.downgradeTo;
        downgradeApplied = true;

        // Recalculate with downgraded zone type
        zones = AdaptiveEntryZoneCalculator.calculateZones(
          inputs,
          selectedZoneType,
          decision.action,
          decision.confidence
        );

        // Re-validate reachability
        reachability = ZoneReachabilityValidator.validate(zones, inputs);
      }

      return {
        primary: zones.primary,
        secondary: zones.secondary,
        zoneType: selectedZoneType,
        reachabilityDistancePips: reachability.distanceFromPricePips,
        downgradeApplied,
        positionSizeMultiplier: reachability.positionSizeMultiplier
      };
    } catch (error) {
      logger.error('[AdaptiveZones] Failed to calculate adaptive zones:', error);
      return null;
    }
  }

  private static calculateInvalidationPrice(
    decision: AlphaDecision,
    marketContext: MarketContext
  ): number {
    if (decision.stopLoss) {
      return decision.stopLoss;
    }

    const atr = marketContext.atr;
    const entry = decision.entry;

    if (decision.action === 'BUY') {
      return entry - (atr * 1.5);
    } else {
      return entry + (atr * 1.5);
    }
  }

  private static determineTimeoutAction(
    intentType: EntryIntentType,
    urgency: EntryUrgencyLevel
  ): TimeoutAction {
    if (intentType === 'immediate_momentum') {
      return 'EXECUTE_AT_MARKET';
    }

    if (urgency === 'HIGH') {
      return 'EXECUTE_AT_MARKET';
    }

    if (intentType === 'break_and_retest' || intentType === 'retest_structure') {
      return 'EXECUTE_AT_MARKET';
    }

    return 'CANCEL';
  }

  private static calculateMaxWaitSeconds(
    urgency: EntryUrgencyLevel,
    intentType: EntryIntentType,
    marketContext: MarketContext
  ): number {
    const isHighVolatility = marketContext.volatility === 'high';
    const volatilityMultiplier = isHighVolatility ? 0.6 : 1.0;

    let baseSeconds: number;

    switch (intentType) {
      case 'immediate_momentum':
        baseSeconds = urgency === 'HIGH' ? 30 : urgency === 'MEDIUM' ? 45 : 60;
        break;
      case 'pullback_to_vwap':
        baseSeconds = urgency === 'HIGH' ? 90 : urgency === 'MEDIUM' ? 180 : 300;
        break;
      case 'break_and_retest':
        baseSeconds = urgency === 'HIGH' ? 120 : urgency === 'MEDIUM' ? 240 : 360;
        break;
      case 'pullback_to_support':
        baseSeconds = urgency === 'HIGH' ? 180 : urgency === 'MEDIUM' ? 420 : 600;
        break;
      case 'range_extreme':
        baseSeconds = urgency === 'HIGH' ? 120 : urgency === 'MEDIUM' ? 300 : 600;
        break;
      case 'retest_structure':
        baseSeconds = urgency === 'HIGH' ? 120 : urgency === 'MEDIUM' ? 240 : 420;
        break;
      default:
        baseSeconds = 120;
    }

    return Math.round(baseSeconds * volatilityMultiplier);
  }

  private static determineUrgency(
    decision: AlphaDecision,
    marketContext: MarketContext,
    votes: OmegaCouncilVotes,
    intentType: EntryIntentType,
    distanceToZonePips: number
  ): EntryUrgencyLevel {
    const confidence = decision.confidence;
    const absDistance = Math.abs(distanceToZonePips);

    if (intentType === 'immediate_momentum') {
      if (absDistance <= 2) {
        return 'HIGH';
      }
      if (confidence >= 75) {
        return 'HIGH';
      }
      return 'MEDIUM';
    }

    if (marketContext.volatility === 'high') {
      if (confidence >= 70) {
        return 'HIGH';
      }
      return 'MEDIUM';
    }

    const trendVote = votes.trend;
    if (trendVote && trendVote.action !== 'NO_TRADE' && trendVote.confidence >= 75) {
      return 'HIGH';
    }

    if (confidence >= 80) {
      return 'HIGH';
    } else if (confidence >= 65) {
      return 'MEDIUM';
    }

    return 'LOW';
  }

  private static calculateEntryZone(
    decision: AlphaDecision,
    intentType: EntryIntentType,
    marketContext: MarketContext,
    confidence: number
  ): { min: number; max: number } {
    // SSOT COMPLIANCE: Use centralized pip value
    const pipValue = getCurrencyPipInfo(marketContext.symbol).pipValue;
    const atr = marketContext.atr;
    const idealEntry = decision.entry;
    const direction = decision.action === 'BUY' ? 1 : -1;

    // ADAPTIVE: Widen zones during high volatility, use tighter caps in normal conditions
    const isHighVolatility = marketContext.volatility === 'high';
    const volatilityMultiplier = isHighVolatility ? 1.5 : 1.0;

    // CONFIDENCE-AWARE ZONES: Higher confidence = tighter zones (demand precision)
    // High confidence (70%+): 0.8x multiplier (tighter zones, better entries)
    // Medium confidence (60-69%): 1.0x multiplier (standard zones)
    // Low confidence (50-59%): 1.2x multiplier (wider zones, more flexibility)
    const confidenceMultiplier = confidence >= 70 ? 0.8 : confidence >= 60 ? 1.0 : 1.2;

    switch (intentType) {
      case 'immediate_momentum': {
        // High volatility: Allow up to ATR * 0.45 (no hard cap)
        // Normal: Cap at 5 pips
        const baseWidth = atr * 0.3 * volatilityMultiplier * confidenceMultiplier;
        const zoneWidth = isHighVolatility
          ? baseWidth
          : Math.min(baseWidth, 5 * pipValue * confidenceMultiplier);

        logger.debug(
          `Entry zone width: ${(zoneWidth * 10000).toFixed(1)} pips ` +
          `(volatility: ${marketContext.volatility}, confidence: ${confidence}%)`
        );

        return {
          min: idealEntry - zoneWidth,
          max: idealEntry + zoneWidth
        };
      }

      case 'pullback_to_vwap': {
        const baseWidth = 2 * pipValue * confidenceMultiplier;
        const zoneWidth = isHighVolatility ? baseWidth * 1.5 : baseWidth;
        return {
          min: idealEntry - zoneWidth,
          max: idealEntry + zoneWidth
        };
      }

      case 'pullback_to_support': {
        const baseWidth = atr * 0.4 * volatilityMultiplier * confidenceMultiplier;
        const zoneWidth = isHighVolatility
          ? baseWidth
          : Math.min(baseWidth, 10 * pipValue * confidenceMultiplier);

        if (direction > 0) {
          return {
            min: idealEntry - zoneWidth,
            max: idealEntry + zoneWidth * 0.3
          };
        } else {
          return {
            min: idealEntry - zoneWidth * 0.3,
            max: idealEntry + zoneWidth
          };
        }
      }

      case 'break_and_retest': {
        const baseWidth = atr * 0.5 * volatilityMultiplier * confidenceMultiplier;
        const zoneWidth = isHighVolatility
          ? baseWidth
          : Math.min(baseWidth, 8 * pipValue * confidenceMultiplier);

        return {
          min: idealEntry - zoneWidth * 0.5,
          max: idealEntry + zoneWidth * 0.5
        };
      }

      case 'range_extreme': {
        const baseWidth = atr * 0.3 * volatilityMultiplier * confidenceMultiplier;
        const zoneWidth = isHighVolatility
          ? baseWidth
          : Math.min(baseWidth, 5 * pipValue * confidenceMultiplier);

        return {
          min: idealEntry - zoneWidth * 0.4,
          max: idealEntry + zoneWidth * 0.4
        };
      }

      case 'retest_structure': {
        const baseWidth = atr * 0.35 * volatilityMultiplier * confidenceMultiplier;
        const zoneWidth = isHighVolatility
          ? baseWidth
          : Math.min(baseWidth, 7 * pipValue * confidenceMultiplier);

        return {
          min: idealEntry - zoneWidth * 0.5,
          max: idealEntry + zoneWidth * 0.5
        };
      }

      default: {
        const zoneWidth = 3 * pipValue * volatilityMultiplier * confidenceMultiplier;
        return {
          min: idealEntry - zoneWidth,
          max: idealEntry + zoneWidth
        };
      }
    }
  }

  private static calculateTimeout(
    urgency: EntryUrgencyLevel,
    intentType: EntryIntentType
  ): number {
    switch (urgency) {
      case 'HIGH':
        return intentType === 'immediate_momentum' ? 15 : 30;

      case 'MEDIUM':
        if (intentType === 'pullback_to_vwap' || intentType === 'break_and_retest') {
          return 60;
        }
        return 90;

      case 'LOW':
        if (intentType === 'range_extreme') {
          return 120;
        }
        return 90;

      default:
        return 60;
    }
  }
}
