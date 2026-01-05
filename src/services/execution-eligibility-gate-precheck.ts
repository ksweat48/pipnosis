/**
 * Execution Eligibility Gate - Precheck Layer (Layer 0)
 *
 * SSOT Authority: Fast-fail economic validation before expensive M5 analysis
 *
 * Responsibilities:
 * - Block obvious economic impossibilities
 * - TTF tiering and volatility-based wait conversion
 * - Hard block on physics violations
 *
 * Does NOT:
 * - Perform microstructure analysis (EQE responsibility)
 * - Make entry timing decisions (EQE responsibility)
 * - Execute trades (execution coordinator responsibility)
 */

import { VOLATILITY_PATIENCE_CONFIG } from '../config/volatility-aware-patience-config';
import { productionLogger } from '../lib/production-logger';
import type { EEGAction, EEGRejectionReason } from '../types/entry';

export interface EEGPrecheckInput {
  symbol: string;
  currentPrice: number;
  entryPrice: number;
  direction: 'long' | 'short';
  estimatedTTF: number;
  currentATR: number;
  sessionId: string;
}

export interface EEGPrecheckResult {
  passed: boolean;
  action: EEGAction;
  rejectionReason?: EEGRejectionReason;
  ttfTier?: 1 | 2 | 3 | 4;
  shouldCreateVolatilityIntent?: boolean;
  message: string;
  metadata: {
    ttfMinutes: number;
    atrValue: number;
    distanceFromEntry: number;
    distanceInATRs: number;
  };
}

export class ExecutionEligibilityGatePrecheck {
  private config = VOLATILITY_PATIENCE_CONFIG.eeg;

  async runPrecheck(input: EEGPrecheckInput): Promise<EEGPrecheckResult> {
    const { symbol, currentPrice, entryPrice, direction, estimatedTTF, currentATR, sessionId } = input;

    productionLogger.info('[EEG-Precheck] Running precheck', {
      symbol,
      ttf: estimatedTTF,
      atr: currentATR,
      sessionId
    });

    const distanceFromEntry = Math.abs(currentPrice - entryPrice);
    const distanceInATRs = currentATR > 0 ? distanceFromEntry / currentATR : 999;

    const metadata = {
      ttfMinutes: estimatedTTF,
      atrValue: currentATR,
      distanceFromEntry,
      distanceInATRs
    };

    if (!this.config.precheck.enabled) {
      return {
        passed: true,
        action: 'EXECUTE_IMMEDIATELY',
        message: 'Precheck disabled, allowing execution',
        metadata
      };
    }

    const hardBlockCheck = this.checkHardBlocks(estimatedTTF, currentATR, distanceInATRs);
    if (hardBlockCheck) {
      return {
        passed: false,
        action: 'HARD_BLOCK',
        rejectionReason: hardBlockCheck.reason,
        message: hardBlockCheck.message,
        metadata
      };
    }

    const ttfTierResult = this.determineTTFTier(estimatedTTF);

    if (ttfTierResult.action === 'CONVERT_TO_VOLATILITY_WAIT') {
      const shouldConvert = this.shouldConvertToVolatilityWait(currentATR);

      if (shouldConvert) {
        return {
          passed: false,
          action: 'CONVERT_TO_VOLATILITY_WAIT',
          ttfTier: ttfTierResult.tier,
          shouldCreateVolatilityIntent: true,
          message: `TTF ${estimatedTTF}m exceeds Tier 2 threshold. Converting to volatility wait intent.`,
          metadata
        };
      } else {
        return {
          passed: false,
          action: 'HARD_BLOCK',
          rejectionReason: 'INSUFFICIENT_ATR',
          ttfTier: ttfTierResult.tier,
          message: `TTF ${estimatedTTF}m too high and ATR ${currentATR.toFixed(5)} insufficient for patience.`,
          metadata
        };
      }
    }

    if (ttfTierResult.action === 'HARD_BLOCK') {
      return {
        passed: false,
        action: 'HARD_BLOCK',
        rejectionReason: 'TTF_EXCEEDS_TIER4',
        ttfTier: ttfTierResult.tier,
        message: ttfTierResult.message,
        metadata
      };
    }

    return {
      passed: true,
      action: ttfTierResult.action,
      ttfTier: ttfTierResult.tier,
      message: ttfTierResult.message,
      metadata
    };
  }

  private checkHardBlocks(
    ttf: number,
    atr: number,
    distanceInATRs: number
  ): { reason: EEGRejectionReason; message: string } | null {
    const { hardBlocks } = this.config;

    if (ttf > hardBlocks.maxTTFMinutes) {
      return {
        reason: 'TTF_EXCEEDS_TIER4',
        message: `TTF ${ttf}m exceeds 8h intraday boundary (${hardBlocks.maxTTFMinutes}m)`
      };
    }

    if (atr < hardBlocks.minRequiredATR) {
      return {
        reason: 'INSUFFICIENT_ATR',
        message: `ATR ${atr.toFixed(5)} below minimum ${hardBlocks.minRequiredATR} - insufficient volatility`
      };
    }

    if (distanceInATRs > hardBlocks.maxDistanceFromEntry) {
      return {
        reason: 'ENTRY_TOO_FAR_FROM_PRICE',
        message: `Entry ${distanceInATRs.toFixed(2)}x ATR from current price (max ${hardBlocks.maxDistanceFromEntry}x)`
      };
    }

    return null;
  }

  private determineTTFTier(ttf: number): {
    tier: 1 | 2 | 3 | 4;
    action: EEGAction;
    message: string;
  } {
    const { ttfTiers } = this.config;

    if (ttf <= ttfTiers.tier1.maxMinutes) {
      return {
        tier: 1,
        action: ttfTiers.tier1.action,
        message: `Tier 1: ${ttfTiers.tier1.description}`
      };
    }

    if (ttf <= ttfTiers.tier2.maxMinutes) {
      return {
        tier: 2,
        action: ttfTiers.tier2.action,
        message: `Tier 2: ${ttfTiers.tier2.description}`
      };
    }

    if (ttf <= ttfTiers.tier3.maxMinutes) {
      return {
        tier: 3,
        action: ttfTiers.tier3.action,
        message: `Tier 3: ${ttfTiers.tier3.description}`
      };
    }

    return {
      tier: 4,
      action: ttfTiers.tier4.action,
      message: `Tier 4: ${ttfTiers.tier4.description}`
    };
  }

  private shouldConvertToVolatilityWait(currentATR: number): boolean {
    const { volatilityWait } = this.config;

    if (!volatilityWait.enabled) {
      return false;
    }

    return currentATR >= volatilityWait.minATRForPatience;
  }

  async logPrecheckDecision(result: EEGPrecheckResult, sessionId: string): Promise<void> {
    if (!VOLATILITY_PATIENCE_CONFIG.monitoring.logAllDecisions) {
      return;
    }

    productionLogger.info('[EEG-Precheck] Decision logged', {
      passed: result.passed,
      action: result.action,
      tier: result.ttfTier,
      shouldCreateIntent: result.shouldCreateVolatilityIntent,
      sessionId,
      metadata: result.metadata
    });
  }
}

export const eegPrecheck = new ExecutionEligibilityGatePrecheck();
