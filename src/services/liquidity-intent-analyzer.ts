/**
 * Liquidity Intent Analyzer - SSOT for participant behavior modeling
 *
 * Transforms technical sweep patterns into actionable liquidity intent:
 * - Identifies trapped participants
 * - Models vulnerability and cascade mechanics
 * - Determines institutional predator direction
 * - Calculates conviction levels for liquidity-based setups
 *
 * Uses Omega-8 sweep detection as input, adds behavioral layer.
 */

import type { Omega8Patterns, Omega8Candle } from '../brains/omega8-hybrid-orderflow';

export type TrappedParticipant = 'retail_longs' | 'retail_shorts' | 'early_breakout_traders' | 'stop_loss_traders' | 'none';
export type VulnerabilityType = 'stop_cascade' | 'margin_squeeze' | 'breakout_failure' | 'range_traders' | 'none';
export type HuntZoneStatus = 'active' | 'resolving' | 'resolved' | 'inactive';
export type PredatorDirection = 'long' | 'short' | 'neutral';

export interface LiquidityIntentModel {
  // Core identification
  trapped: TrappedParticipant;
  vulnerability: VulnerabilityType;
  predatorDirection: PredatorDirection;

  // Hunt zone mechanics
  huntZoneStatus: HuntZoneStatus;
  expectedCascadeDistance: number; // in ATR units
  cascadeConfidence: number; // 0-100

  // Timing and execution
  sweepRecency: number; // candles ago
  optimalEntryWindow: 'immediate' | 'wait_confirmation' | 'missed';
  stopPlacementGuidance: string;

  /**
   * SSOT: Numeric sweep extreme price for sweep-aware stop placement.
   * When set, the stop calculator uses this to relocate the stop beyond
   * the sweep zone rather than relying solely on ATR distance.
   */
  sweepExtremePrice?: number;

  /**
   * Nearest equal high/low cluster price adjacent to the sweep extreme.
   * Provides additional context for the stop buffer calculation.
   */
  nearestClusterPrice?: number;

  // Conviction
  overallConviction: number; // 0-100
  reasoning: string;
}

export class LiquidityIntentAnalyzer {
  /**
   * Analyze liquidity intent from Omega-8 patterns
   * SSOT for participant behavior modeling
   */
  analyzeLiquidityIntent(
    patterns: Omega8Patterns,
    candles: Omega8Candle[],
    atr: number,
    sweepDetails?: {
      type: 'high' | 'low' | 'none';
      candles_ago: number;
      has_bos: boolean;
      sweep_extreme_price?: number;
      nearest_cluster_price?: number;
    }
  ): LiquidityIntentModel {
    // No clear sweep pattern - no liquidity intent
    if (!sweepDetails || sweepDetails.type === 'none' || patterns.sweptHighs === 0 && patterns.sweptLows === 0) {
      return this.noIntentModel();
    }

    const sweepType = sweepDetails.type;
    const candlesAgo = sweepDetails.candles_ago;
    const hasBOS = sweepDetails.has_bos;
    const sweepExtremePrice = sweepDetails.sweep_extreme_price;
    const nearestClusterPrice = sweepDetails.nearest_cluster_price;

    // Identify trapped participants
    const trapped = this.identifyTrappedParticipants(sweepType, hasBOS, patterns);

    // Determine vulnerability type
    const vulnerability = this.determineVulnerability(sweepType, hasBOS, trapped);

    // Calculate expected cascade distance
    const cascadeDistance = this.calculateCascadeDistance(sweepType, atr, patterns, hasBOS);

    // Determine predator direction
    const predatorDirection = this.determinePredatorDirection(sweepType, hasBOS);

    // Assess hunt zone status
    const huntZoneStatus = this.assessHuntZoneStatus(candlesAgo, hasBOS);

    // Calculate cascade confidence
    const cascadeConfidence = this.calculateCascadeConfidence(
      hasBOS,
      patterns,
      huntZoneStatus,
      trapped
    );

    // Determine optimal entry window
    const optimalEntryWindow = this.determineEntryWindow(candlesAgo, hasBOS, huntZoneStatus);

    // Generate stop placement guidance
    const stopPlacementGuidance = this.generateStopGuidance(sweepType, predatorDirection, cascadeDistance);

    // Calculate overall conviction
    const overallConviction = this.calculateOverallConviction(
      cascadeConfidence,
      huntZoneStatus,
      hasBOS,
      trapped
    );

    // Build reasoning
    const reasoning = this.buildReasoning(
      trapped,
      vulnerability,
      predatorDirection,
      huntZoneStatus,
      hasBOS,
      cascadeDistance
    );

    return {
      trapped,
      vulnerability,
      predatorDirection,
      huntZoneStatus,
      expectedCascadeDistance: cascadeDistance,
      cascadeConfidence,
      sweepRecency: candlesAgo,
      optimalEntryWindow,
      stopPlacementGuidance,
      sweepExtremePrice,
      nearestClusterPrice,
      overallConviction,
      reasoning
    };
  }

  /**
   * Identify which participants are trapped
   */
  private identifyTrappedParticipants(
    sweepType: 'high' | 'low',
    hasBOS: boolean,
    patterns: Omega8Patterns
  ): TrappedParticipant {
    if (sweepType === 'low' && hasBOS) {
      // Swept lows with BOS up = trapped shorts
      return 'retail_shorts';
    }

    if (sweepType === 'high' && hasBOS) {
      // Swept highs with BOS down = trapped longs
      return 'retail_longs';
    }

    if (sweepType === 'low' && !hasBOS) {
      // Swept lows without BOS = early breakout traders trapped
      return 'early_breakout_traders';
    }

    if (sweepType === 'high' && !hasBOS) {
      // Swept highs without BOS = early breakout traders trapped
      return 'early_breakout_traders';
    }

    return 'none';
  }

  /**
   * Determine vulnerability type
   */
  private determineVulnerability(
    sweepType: 'high' | 'low',
    hasBOS: boolean,
    trapped: TrappedParticipant
  ): VulnerabilityType {
    if (hasBOS && (trapped === 'retail_longs' || trapped === 'retail_shorts')) {
      return 'stop_cascade';
    }

    if (!hasBOS && trapped === 'early_breakout_traders') {
      return 'breakout_failure';
    }

    if (trapped === 'stop_loss_traders') {
      return 'margin_squeeze';
    }

    return 'none';
  }

  /**
   * Calculate expected cascade distance in ATR units
   */
  private calculateCascadeDistance(
    sweepType: 'high' | 'low',
    atr: number,
    patterns: Omega8Patterns,
    hasBOS: boolean
  ): number {
    let baseDistance = 1.5; // Default 1.5 ATR

    // BOS increases cascade potential
    if (hasBOS) {
      baseDistance = 2.5;
    }

    // Multiple sweeps suggest layered stops
    const sweepCount = sweepType === 'low' ? patterns.sweptLows : patterns.sweptHighs;
    if (sweepCount > 1) {
      baseDistance += 0.5 * sweepCount;
    }

    // FVG presence suggests more room to run
    const hasFVG = sweepType === 'low' ? patterns.fvgBullish > 0 : patterns.fvgBearish > 0;
    if (hasFVG) {
      baseDistance += 0.8;
    }

    // Volume spike suggests strong institutional participation
    const hasVolSpike = sweepType === 'low' ? patterns.volSpikeBullish : patterns.volSpikeBearish;
    if (hasVolSpike) {
      baseDistance += 0.5;
    }

    return Math.min(baseDistance, 5.0); // Cap at 5 ATR
  }

  /**
   * Determine predator (institutional) direction
   */
  private determinePredatorDirection(
    sweepType: 'high' | 'low',
    hasBOS: boolean
  ): PredatorDirection {
    if (!hasBOS) {
      return 'neutral';
    }

    // Sweep low + BOS up = predators are long
    if (sweepType === 'low') {
      return 'long';
    }

    // Sweep high + BOS down = predators are short
    if (sweepType === 'high') {
      return 'short';
    }

    return 'neutral';
  }

  /**
   * Assess current hunt zone status
   */
  private assessHuntZoneStatus(candlesAgo: number, hasBOS: boolean): HuntZoneStatus {
    if (candlesAgo === 0) {
      return 'active'; // Sweep just happened
    }

    if (candlesAgo <= 2 && hasBOS) {
      return 'active'; // Recent sweep with confirmation
    }

    if (candlesAgo <= 3 && !hasBOS) {
      return 'resolving'; // Recent sweep, waiting for BOS
    }

    if (candlesAgo <= 5) {
      return 'resolved'; // Older sweep, cascade likely finished
    }

    return 'inactive'; // Too old to be relevant
  }

  /**
   * Calculate cascade confidence
   */
  private calculateCascadeConfidence(
    hasBOS: boolean,
    patterns: Omega8Patterns,
    huntZoneStatus: HuntZoneStatus,
    trapped: TrappedParticipant
  ): number {
    let confidence = 50; // Base

    // BOS is strongest confirmation
    if (hasBOS) {
      confidence += 30;
    }

    // Hunt zone status
    if (huntZoneStatus === 'active') {
      confidence += 15;
    } else if (huntZoneStatus === 'resolving') {
      confidence += 5;
    } else if (huntZoneStatus === 'inactive') {
      confidence -= 20;
    }

    // Trapped participant clarity
    if (trapped !== 'none') {
      confidence += 10;
    }

    // Confluence
    if (patterns.confluenceScore >= 3) {
      confidence += 10;
    }

    return Math.min(Math.max(confidence, 0), 100);
  }

  /**
   * Determine optimal entry window
   */
  private determineEntryWindow(
    candlesAgo: number,
    hasBOS: boolean,
    huntZoneStatus: HuntZoneStatus
  ): 'immediate' | 'wait_confirmation' | 'missed' {
    if (huntZoneStatus === 'inactive' || huntZoneStatus === 'resolved') {
      return 'missed';
    }

    if (hasBOS && candlesAgo <= 2) {
      return 'immediate';
    }

    if (!hasBOS && candlesAgo <= 1) {
      return 'wait_confirmation';
    }

    if (candlesAgo <= 3) {
      return 'wait_confirmation';
    }

    return 'missed';
  }

  /**
   * Generate stop placement guidance
   */
  private generateStopGuidance(
    sweepType: 'high' | 'low',
    predatorDirection: PredatorDirection,
    cascadeDistance: number
  ): string {
    if (predatorDirection === 'neutral') {
      return 'Standard ATR-based stops. No asymmetric advantage.';
    }

    if (sweepType === 'low' && predatorDirection === 'long') {
      return `Place stop below sweep low minus 0.3 ATR. Expect ${cascadeDistance.toFixed(1)} ATR upside.`;
    }

    if (sweepType === 'high' && predatorDirection === 'short') {
      return `Place stop above sweep high plus 0.3 ATR. Expect ${cascadeDistance.toFixed(1)} ATR downside.`;
    }

    return 'Standard ATR-based stops.';
  }

  /**
   * Calculate overall conviction
   */
  private calculateOverallConviction(
    cascadeConfidence: number,
    huntZoneStatus: HuntZoneStatus,
    hasBOS: boolean,
    trapped: TrappedParticipant
  ): number {
    let conviction = cascadeConfidence;

    // Reduce conviction if hunt zone inactive
    if (huntZoneStatus === 'inactive') {
      conviction *= 0.5;
    }

    // Boost if all elements align
    if (hasBOS && trapped !== 'none' && huntZoneStatus === 'active') {
      conviction = Math.min(conviction + 10, 95);
    }

    return Math.round(conviction);
  }

  /**
   * Build reasoning string
   */
  private buildReasoning(
    trapped: TrappedParticipant,
    vulnerability: VulnerabilityType,
    predatorDirection: PredatorDirection,
    huntZoneStatus: HuntZoneStatus,
    hasBOS: boolean,
    cascadeDistance: number
  ): string {
    const parts: string[] = [];

    if (trapped !== 'none') {
      parts.push(`${this.formatTrapped(trapped)} trapped`);
    }

    if (vulnerability !== 'none') {
      parts.push(`${this.formatVulnerability(vulnerability)}`);
    }

    if (predatorDirection !== 'neutral' && hasBOS) {
      parts.push(`Predators ${predatorDirection}. Expect ${cascadeDistance.toFixed(1)} ATR cascade.`);
    }

    if (huntZoneStatus === 'active') {
      parts.push('Hunt zone ACTIVE - immediate opportunity');
    } else if (huntZoneStatus === 'resolving') {
      parts.push('Hunt zone resolving - await confirmation');
    } else if (huntZoneStatus === 'resolved') {
      parts.push('Hunt zone resolved - move complete');
    }

    if (!hasBOS) {
      parts.push('No BOS yet - predator intent unclear');
    }

    return parts.join('. ');
  }

  /**
   * Format trapped participant for display
   */
  private formatTrapped(trapped: TrappedParticipant): string {
    const map: Record<TrappedParticipant, string> = {
      retail_longs: 'Retail longs',
      retail_shorts: 'Retail shorts',
      early_breakout_traders: 'Breakout chasers',
      stop_loss_traders: 'Stop traders',
      none: 'None'
    };
    return map[trapped];
  }

  /**
   * Format vulnerability for display
   */
  private formatVulnerability(vulnerability: VulnerabilityType): string {
    const map: Record<VulnerabilityType, string> = {
      stop_cascade: 'Stop cascade risk',
      margin_squeeze: 'Margin squeeze',
      breakout_failure: 'Failed breakout',
      range_traders: 'Range traders exposed',
      none: 'No clear vulnerability'
    };
    return map[vulnerability];
  }

  /**
   * No liquidity intent detected
   */
  private noIntentModel(): LiquidityIntentModel {
    return {
      trapped: 'none',
      vulnerability: 'none',
      predatorDirection: 'neutral',
      huntZoneStatus: 'inactive',
      expectedCascadeDistance: 0,
      cascadeConfidence: 0,
      sweepRecency: 999,
      optimalEntryWindow: 'missed',
      stopPlacementGuidance: 'Standard ATR-based stops.',
      overallConviction: 0,
      reasoning: 'No liquidity sweep detected. No clear institutional intent.'
    };
  }
}

export const liquidityIntentAnalyzer = new LiquidityIntentAnalyzer();
