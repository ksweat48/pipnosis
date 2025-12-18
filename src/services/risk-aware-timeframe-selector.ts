/**
 * Risk-Aware Timeframe Selector
 *
 * Selects appropriate analysis timeframes based on risk mode strategy
 *
 * CRITICAL INSIGHT: Timeframe is a STRATEGY characteristic
 * - Aggressive mode = M5-M15 (scalp entries)
 * - Moderate mode = M15-H1 (day trade setups)
 * - Conservative mode = H1-H4 (swing positions)
 */

import { getRiskStrategyProfile, getPrimaryTimeframes } from '../config/risk-strategy-profiles';

export interface TimeframeSelection {
  primary: string;
  secondary: string;
  tertiary?: string;
  analysisDepth: 'quick' | 'moderate' | 'deep';
  reasoning: string;
}

class RiskAwareTimeframeSelector {
  /**
   * Get recommended timeframes for a risk mode
   */
  getTimeframes(riskMode: 'low' | 'medium' | 'high'): TimeframeSelection {
    const profile = getRiskStrategyProfile(riskMode);
    const primaryTimeframes = profile.primaryTimeframes;
    const secondaryTimeframes = profile.secondaryTimeframes;

    // Select primary and secondary from the profile arrays
    const primary = primaryTimeframes[0];
    const secondary = primaryTimeframes.length > 1 ? primaryTimeframes[1] : secondaryTimeframes[0];
    const tertiary = secondaryTimeframes[0] !== secondary ? secondaryTimeframes[0] : undefined;

    const reasoning = this.buildReasoning(riskMode, profile.tradingStyle, primary, secondary);

    console.log(`[Timeframe Selector] ${riskMode.toUpperCase()} mode:`);
    console.log(`  Primary: ${primary} | Secondary: ${secondary} | Tertiary: ${tertiary || 'none'}`);
    console.log(`  Strategy: ${profile.tradingStyle} | Depth: ${profile.analysisDepth}`);

    return {
      primary,
      secondary,
      tertiary,
      analysisDepth: profile.analysisDepth,
      reasoning
    };
  }

  /**
   * Validate if a timeframe matches the risk profile
   */
  validateTimeframe(
    timeframe: string,
    riskMode: 'low' | 'medium' | 'high'
  ): {
    valid: boolean;
    warnings: string[];
    score: number;
  } {
    const profile = getRiskStrategyProfile(riskMode);
    const allValidTimeframes = [...profile.primaryTimeframes, ...profile.secondaryTimeframes];

    const warnings: string[] = [];
    let score = 100;

    const normalizedTimeframe = this.normalizeTimeframe(timeframe);

    if (!allValidTimeframes.includes(normalizedTimeframe)) {
      warnings.push(`Timeframe ${normalizedTimeframe} not recommended for ${riskMode} ${profile.tradingStyle} strategy`);
      score -= 40;

      // Specific warnings for common mistakes
      if (riskMode === 'high' && (normalizedTimeframe === 'H4' || normalizedTimeframe === 'D1')) {
        warnings.push(`AGGRESSIVE mode using swing timeframes (${normalizedTimeframe}) - should use M5-M15 for scalp entries`);
        score -= 40;
      }

      if (riskMode === 'low' && (normalizedTimeframe === 'M5' || normalizedTimeframe === 'M15')) {
        warnings.push(`CONSERVATIVE mode using scalp timeframes (${normalizedTimeframe}) - should use H1-H4 for swing setups`);
        score -= 30;
      }
    }

    return {
      valid: warnings.length === 0,
      warnings,
      score: Math.max(0, score)
    };
  }

  /**
   * Get timeframe recommendation explanation
   */
  getRecommendation(riskMode: 'low' | 'medium' | 'high'): string {
    const profile = getRiskStrategyProfile(riskMode);
    const selection = this.getTimeframes(riskMode);

    return `${profile.displayName} mode (${profile.tradingStyle}): Primary ${selection.primary}, Secondary ${selection.secondary} | ${profile.analysisDepth} analysis`;
  }

  /**
   * Convert timeframe to consistent format
   */
  private normalizeTimeframe(timeframe: string): string {
    const tf = timeframe.toUpperCase();

    // Handle various formats
    const conversions: Record<string, string> = {
      '1M': 'M1',
      '5M': 'M5',
      '15M': 'M15',
      '30M': 'M30',
      '1H': 'H1',
      '4H': 'H4',
      '1D': 'D1',
      '1W': 'W1'
    };

    return conversions[tf] || tf;
  }

  /**
   * Build reasoning text for timeframe selection
   */
  private buildReasoning(
    riskMode: string,
    tradingStyle: string,
    primary: string,
    secondary: string
  ): string {
    const styleDescriptions: Record<string, string> = {
      scalp: 'quick scalp entries for fast goal achievement',
      'day-trade': 'intraday setups with confirmed entries',
      swing: 'patient swing positions with deep confirmations'
    };

    const description = styleDescriptions[tradingStyle] || tradingStyle;

    return `${riskMode.toUpperCase()} mode uses ${primary} (primary) and ${secondary} (secondary) for ${description}`;
  }

  /**
   * Get expected trade duration for a timeframe and risk mode
   */
  getExpectedDuration(
    timeframe: string,
    riskMode: 'low' | 'medium' | 'high'
  ): {
    minMinutes: number;
    maxMinutes: number;
    warningThreshold: number;
  } {
    const profile = getRiskStrategyProfile(riskMode);

    // Return profile's expected duration
    return {
      minMinutes: profile.expectedDuration.min,
      maxMinutes: profile.expectedDuration.max,
      warningThreshold: profile.durationWarningThreshold
    };
  }
}

export const riskAwareTimeframeSelector = new RiskAwareTimeframeSelector();
