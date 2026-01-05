/**
 * Entry-Qualified Execution Flow
 *
 * SSOT for integrating Entry Qualification into the execution pipeline.
 *
 * RESPONSIBILITY CHAIN:
 * 1. Alpha Decision → (WHAT to trade, WHERE to enter/exit)
 * 2. Entry Qualification → (WHEN timing is optimal, M5 microstructure)
 * 3. Execution Eligibility → (IF economics/physics allow)
 * 4. Execution → (Execute trade or create entry intent)
 *
 * FLOW INTEGRATION:
 * - Input: Alpha decision + market context
 * - Output: Execute, Create Entry Intent, or Reject
 *
 * SSOT COMPLIANCE:
 * - Entry timing: entry-qualification-engine.ts
 * - M5 data: m5-microstructure-provider.ts
 * - Economics: execution-eligibility-gate.ts
 * - Execution: trade-execution-engine.ts
 */

import { entryQualificationEngine, type EntryQualificationInput, type EntryQualificationResult } from './entry-qualification-engine';
import { m5MicrostructureProvider, type M5Microstructure } from './m5-microstructure-provider';
import { executionEligibilityGate, type ExecutionEligibilityInput, type ExecutionEligibilityResult } from './execution-eligibility-gate';
import { EntryExecutionCoordinator } from './entry-execution-coordinator';
import { logger } from '../lib/logger';
import type { AlphaDecision } from '../brains/coordinator-alpha';

export interface EntryQualifiedExecutionInput {
  // Alpha decision
  decision: AlphaDecision;

  // Market context
  symbol: string;
  currentPrice: number;

  // M15 context
  m15Trend: 'bullish' | 'bearish' | 'sideways';
  m15SupportResistance?: {
    nearestSupport?: number;
    nearestResistance?: number;
  };

  // Execution context
  executionEligibilityInput: ExecutionEligibilityInput;

  // Session context
  userId: string;
  sessionId: string;
}

export type ExecutionFlowStatus =
  | 'EXECUTED_IMMEDIATELY'      // Trade executed right away
  | 'ENTRY_INTENT_CREATED'      // Monitoring for better entry
  | 'REJECTED_POOR_TIMING'      // Entry timing too poor, converted to NO_TRADE
  | 'REJECTED_POOR_ECONOMICS'   // Economics blocked execution
  | 'BYPASSED_NO_M5_DATA';      // M5 data unavailable, executed anyway (degraded mode)

export interface ExecutionFlowResult {
  status: ExecutionFlowStatus;
  entryQualification?: EntryQualificationResult;
  executionEligibility?: ExecutionEligibilityResult;
  intentId?: string;
  tradeId?: string;
  message: string;
  shouldConvertToNoTrade: boolean;
}

class EntryQualifiedExecutionFlow {
  /**
   * Execute with entry qualification and execution eligibility gates
   * Returns detailed result indicating what action was taken
   */
  async executeWithQualification(input: EntryQualifiedExecutionInput): Promise<ExecutionFlowResult> {
    const { decision, symbol, currentPrice, m15Trend, m15SupportResistance, executionEligibilityInput, userId, sessionId } = input;

    // Step 1: Check if M5 data is available
    const hasM5Data = await m5MicrostructureProvider.isM5DataAvailable(symbol);

    if (!hasM5Data) {
      logger.warn(`[Entry Qualified Flow] ${symbol} has no M5 data available - bypassing entry qualification (degraded mode)`);

      // Fall back to execution eligibility only
      const eligibilityResult = executionEligibilityGate.evaluate(executionEligibilityInput);

      if (eligibilityResult.status === 'BLOCK_EXECUTION') {
        return {
          status: 'REJECTED_POOR_ECONOMICS',
          executionEligibility: eligibilityResult,
          message: executionEligibilityGate.formatBlockMessageForUser(eligibilityResult),
          shouldConvertToNoTrade: true
        };
      }

      // Execute without entry qualification (degraded mode)
      logger.info(`[Entry Qualified Flow] Executing without M5 qualification (degraded mode)`);

      return {
        status: 'BYPASSED_NO_M5_DATA',
        executionEligibility: eligibilityResult,
        message: 'M5 data unavailable - executing with execution eligibility only',
        shouldConvertToNoTrade: false
      };
    }

    // Step 2: Fetch M5 microstructure
    const m5Data = await m5MicrostructureProvider.getMicrostructure(symbol);

    if (!m5Data) {
      logger.error(`[Entry Qualified Flow] Failed to fetch M5 microstructure for ${symbol}`);

      // Fall back to execution eligibility only
      const eligibilityResult = executionEligibilityGate.evaluate(executionEligibilityInput);

      if (eligibilityResult.status === 'BLOCK_EXECUTION') {
        return {
          status: 'REJECTED_POOR_ECONOMICS',
          executionEligibility: eligibilityResult,
          message: executionEligibilityGate.formatBlockMessageForUser(eligibilityResult),
          shouldConvertToNoTrade: true
        };
      }

      return {
        status: 'BYPASSED_NO_M5_DATA',
        executionEligibility: eligibilityResult,
        message: 'M5 microstructure fetch failed - executing with execution eligibility only',
        shouldConvertToNoTrade: false
      };
    }

    // Step 3: Get current spread
    const spreadData = await m5MicrostructureProvider.getCurrentSpread(symbol);

    // Step 4: Run Entry Qualification Engine
    const qualificationInput: EntryQualificationInput = {
      symbol,
      direction: decision.action,
      entryPrice: decision.entry,
      stopLoss: decision.stopLoss,
      takeProfit: decision.takeProfit,
      confidence: decision.confidence,
      m5Candles: m5Data.candles,
      m5VWAP: m5Data.vwap,
      m5EMA20: m5Data.ema20,
      m5RSI: m5Data.rsi,
      m5VolumeAvg20: m5Data.volumeAvg20,
      m15Trend,
      m15SupportResistance,
      currentSpreadPips: spreadData.currentPips,
      averageSpreadPips: spreadData.averagePips,
      atr: m5Data.atr
    };

    const qualificationResult = entryQualificationEngine.evaluate(qualificationInput);

    // Step 5: Handle qualification result
    if (qualificationResult.status === 'REJECT_ENTRY') {
      logger.error(`[Entry Qualified Flow] Entry timing rejected for ${symbol}: ${qualificationResult.blocks[0]?.message}`);

      const message = entryQualificationEngine.formatForUser(qualificationResult);

      return {
        status: 'REJECTED_POOR_TIMING',
        entryQualification: qualificationResult,
        message,
        shouldConvertToNoTrade: true
      };
    }

    if (qualificationResult.status === 'WAIT_FOR_BETTER') {
      logger.info(`[Entry Qualified Flow] Entry timing suboptimal for ${symbol} - creating entry intent`);

      // Create entry intent via Entry Execution Coordinator
      const intentResult = await EntryExecutionCoordinator.handleAlphaDecision(
        userId,
        sessionId,
        {
          ...decision,
          action: 'WAIT', // Force wait action
          wait_condition: {
            target_entry_zone_min: decision.entry * 0.9995, // 0.05% zone
            target_entry_zone_max: decision.entry * 1.0005,
            invalidation_price: decision.stopLoss,
            wait_reasoning: qualificationResult.waitRecommendation?.reason || 'Waiting for better entry timing'
          }
        },
        symbol
      );

      const message = entryQualificationEngine.formatForUser(qualificationResult);

      return {
        status: 'ENTRY_INTENT_CREATED',
        entryQualification: qualificationResult,
        intentId: intentResult.intentId,
        message,
        shouldConvertToNoTrade: false
      };
    }

    // Step 6: Entry qualification passed - check execution eligibility
    const eligibilityResult = executionEligibilityGate.evaluate(executionEligibilityInput);

    if (eligibilityResult.status === 'BLOCK_EXECUTION') {
      logger.error(`[Entry Qualified Flow] Execution blocked for ${symbol}: ${eligibilityResult.reasons[0]?.message}`);

      const message = executionEligibilityGate.formatBlockMessageForUser(eligibilityResult);

      return {
        status: 'REJECTED_POOR_ECONOMICS',
        entryQualification: qualificationResult,
        executionEligibility: eligibilityResult,
        message,
        shouldConvertToNoTrade: true
      };
    }

    if (eligibilityResult.status === 'CONVERT_TO_ENTRY_INTENT' && eligibilityResult.entryIntentSuggestion) {
      logger.info(`[Entry Qualified Flow] Converting to entry intent for better R:R: ${eligibilityResult.entryIntentSuggestion.reason}`);

      // Create entry intent via Entry Execution Coordinator
      const intentResult = await EntryExecutionCoordinator.handleAlphaDecision(
        userId,
        sessionId,
        {
          ...decision,
          action: 'WAIT',
          wait_condition: {
            target_entry_zone_min: decision.entry * 0.9995,
            target_entry_zone_max: decision.entry * 1.0005,
            invalidation_price: decision.stopLoss,
            wait_reasoning: eligibilityResult.entryIntentSuggestion.reason
          }
        },
        symbol
      );

      const message = `Entry timing: ${qualificationResult.metrics.microstructureGrade} grade\n` +
                     `Economic quality: ${eligibilityResult.entryIntentSuggestion.reason}\n` +
                     `Creating entry intent to monitor for optimal execution.`;

      return {
        status: 'ENTRY_INTENT_CREATED',
        entryQualification: qualificationResult,
        executionEligibility: eligibilityResult,
        intentId: intentResult.intentId,
        message,
        shouldConvertToNoTrade: false
      };
    }

    // Step 7: Both gates passed - execute immediately
    logger.info(`[Entry Qualified Flow] ✅ All gates passed for ${symbol} - executing immediately`);
    logger.info(`  Entry Qualification: ${qualificationResult.qualityScore}/100 (${qualificationResult.metrics.microstructureGrade})`);
    logger.info(`  Execution Eligibility: ${eligibilityResult.metrics.expectedProfitUSD.toFixed(2)} USD profit expected`);

    const message = `✅ Entry qualification: ${qualificationResult.metrics.microstructureGrade} grade (${qualificationResult.qualityScore}/100)\n` +
                   `✅ Execution eligibility: Passed\n` +
                   `Executing trade immediately.`;

    return {
      status: 'EXECUTED_IMMEDIATELY',
      entryQualification: qualificationResult,
      executionEligibility: eligibilityResult,
      message,
      shouldConvertToNoTrade: false
    };
  }

  /**
   * Helper: Create user-friendly message about the execution flow result
   */
  formatResultForUser(result: ExecutionFlowResult): string {
    switch (result.status) {
      case 'EXECUTED_IMMEDIATELY':
        return `✅ Trade executing now\n${result.message}`;

      case 'ENTRY_INTENT_CREATED':
        return `⏳ Entry intent created\n${result.message}\nMonitoring for optimal entry conditions.`;

      case 'REJECTED_POOR_TIMING':
        return `❌ Trade rejected (poor timing)\n${result.message}\nRecommendation: Wait for better market conditions.`;

      case 'REJECTED_POOR_ECONOMICS':
        return `❌ Trade blocked (economics)\n${result.message}`;

      case 'BYPASSED_NO_M5_DATA':
        return `⚠️ Executed without M5 qualification\n${result.message}`;

      default:
        return result.message;
    }
  }
}

export const entryQualifiedExecutionFlow = new EntryQualifiedExecutionFlow();
