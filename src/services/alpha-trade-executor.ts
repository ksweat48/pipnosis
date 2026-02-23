/**
 * Alpha Trade Executor
 *
 * SSOT Authority: Single entry point for ALL trade execution
 * Consolidates: TradeExecutionEngine + EntryCoordinator + ExecutionEligibility + Audit Logging
 *
 * CCIP Compliant: Part of trade execution simplification (20260202)
 *
 * Execution Modes:
 * - IMMEDIATE: Execute at market price immediately
 * - PENDING: Create pending trade awaiting user confirmation
 * - MONITORED: Create entry intent for deferred execution
 *
 * Validation Pipeline:
 * 1. Core Validation (Omega + Geometry + Freshness)
 * 2. Risk Authority (Context + PCVL + Margin + Kelly)
 * 3. Trade Capacity (Confidence + Slots + Duplicates)
 * 4. Price Validation (Slippage + Staleness)
 * 5. Style Qualification Gate (Duration + Consensus + ATR + Targets) - HARD ENFORCEMENT
 * 6. Mandatory Safety Validator (TIER 3 FIX - ONLY allowed blocker)
 * 7. Database Boundary (Type coercion + Range check)
 *
 * Principles:
 * - Engines validate, Alpha decides
 * - Degrade intelligently (not silently)
 * - Single validation pass (no duplicate checks)
 * - Complete audit trail (governance compliant)
 */

import { supabase } from '../lib/supabase';
import { coreValidationGate } from './core-validation-gate';
import { unifiedRiskAuthority } from './unified-risk-authority';
import { goalAwareLotSizingCoordinator } from './goal-aware-lot-sizing-coordinator';
import { priceCoordinator } from './coordinators/price-coordinator';
import { notificationCoordinator } from './coordinators/notification-coordinator';
import { getOrInitializeUserBalance, validateBalanceIsReasonable } from './balance-initialization-authority';
import { toDirectionDB, toLongShort } from '../utils/direction-converter';
import { getRegimeBucket } from './regime-bucketing';
import { getMinConfidenceThreshold } from '../config/risk-levels';
import { getSymbolConfig } from '../config/symbol-registry';
import { logger, LogCategory } from '../lib/logger';
import { calculateDollarPerPip, calculatePipDistance } from '../utils/currencyHelpers';
import { mandatorySafetyValidator } from './mandatory-safety-validator';
import { creditValidationService } from './credit-validation-service';
import { EntryOverextensionValidator } from './entry-overextension-validator';
import { normalizeStyle } from '../utils/entry-overextension-calculator';
import { validateStyleQualification } from './style-qualification-gate';
// entryStructureAnalyzer removed (CCIP 2026-02-17): Alpha's LLM entry advisory is sole authority
// marketSnapshotCache removed (CCIP 2026-02-17): No longer needed for entry advisory
import type { AlphaDecision } from '../brains/coordinator-alpha';
import type { TradeContext } from '../types/trade-context';
import { buildMidTradePlan } from './mid-trade-plan-engine';

export type ExecutionMode = 'IMMEDIATE' | 'PENDING' | 'MONITORED';

type CanonicalStyle = 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY';

function normalizeToCanonicalStyle(input: string): CanonicalStyle {
  const normalized = (input || '').toLowerCase().trim();
  if (normalized === 'scalp' || normalized === 'scalper') return 'SCALP';
  if (normalized === 'micro' || normalized === 'micro_intraday') return 'MICRO_INTRADAY';
  if (normalized === 'day' || normalized === 'intraday') return 'INTRADAY';
  return 'SCALP';
}

export interface TradeExecutionInputs {
  // Alpha decision
  decision: AlphaDecision;
  tradeContext: TradeContext;

  // Session context
  userId: string;
  sessionId: string;
  session: any; // goal_sessions record

  // Execution parameters
  mode: ExecutionMode;
  autoExecute?: boolean; // Legacy flag (maps to mode)

  // Snapshot metadata
  snapshotTimestamp: Date;
  regimeSnapshot?: any;
  adversarialState?: any;
}

export interface TradeExecutionResult {
  success: boolean;
  tradeId?: string;
  message?: string;
  error?: string;
  isMonitoring?: boolean;
  blockReason?: string;
}

interface NormalizedSessionData {
  sessionId: string;
  targetValue: number;
  startingBalance: number;
  dollarRisk: number;
  currentProgress: number;
  raw: any;
}

class AlphaTradeExecutor {
  /**
   * Execute trade decision
   * Single unified entry point for all execution modes
   */
  async execute(inputs: TradeExecutionInputs): Promise<TradeExecutionResult> {
    const { decision, tradeContext, userId, sessionId, session, mode, snapshotTimestamp } = inputs;

    // SSOT SESSION NORMALIZATION (2026-02-09)
    // Supabase returns PostgreSQL `numeric` columns as JavaScript strings to avoid precision loss.
    // Number.isFinite("324") returns false (no type coercion). All numeric session fields
    // must be parsed ONCE here. All downstream code uses these normalized values.
    // This single normalization point prevents inconsistent type handling across the executor.
    const normalizedSession = this.normalizeSessionData(session, sessionId, userId);

    if (!normalizedSession.valid) {
      return {
        success: false,
        error: normalizedSession.error || 'Session data normalization failed',
        blockReason: normalizedSession.blockReason || 'HARD-BLOCK: Invalid session data'
      };
    }

    const sessionData = normalizedSession.data!;

    // VALIDATION PIPELINE (Run all layers in sequence)

    // Layer 1: Core Validation (Omega + Geometry + Snapshot)
    const coreValidation = await coreValidationGate.validateTrade(
      decision,
      {
        direction: decision.action === 'BUY' ? 'buy' : 'sell',
        entryPrice: decision.entry,
        stopLoss: decision.stopLoss,
        takeProfit: decision.takeProfit,
        tp1Price: decision.tp1Price,
        tp2Price: decision.tp2Price
      },
      { snapshotTimestamp },
      userId
    );

    if (!coreValidation.passed) {
      return {
        success: false,
        error: coreValidation.reason,
        blockReason: coreValidation.reason
      };
    }

    // Layer 2: Trade Capacity (Confidence + Slots + Duplicates)
    const capacityCheck = await this.checkTradeCapacity(
      decision.symbol,
      decision.confidence,
      sessionId,
      sessionData.raw
    );

    if (!capacityCheck.valid) {
      return {
        success: false,
        error: capacityCheck.reason,
        blockReason: capacityCheck.reason
      };
    }

    // Layer 3: Risk Authority (Context + PCVL + Margin + Kelly)
    const balanceResult = await getOrInitializeUserBalance(
      userId,
      undefined,
      'trade_execution_flow'
    );

    if (!balanceResult.success) {
      logger.error(
        LogCategory.RISK_MANAGEMENT,
        '[AlphaTradeExecutor] Balance initialization failed',
        { userId, sessionId, error: balanceResult.error }
      );
      return {
        success: false,
        error: balanceResult.error || 'Failed to initialize account balance',
        blockReason: 'Could not retrieve or create balance record'
      };
    }

    let currentBalance: number = balanceResult.balance;

    if (!Number.isFinite(currentBalance)) {
      logger.error(
        LogCategory.RISK_MANAGEMENT,
        '[AlphaTradeExecutor] Balance is not a finite number - invalid state',
        { userId, sessionId, balance: currentBalance, type: typeof currentBalance }
      );
      return {
        success: false,
        error: `Account balance is invalid: ${currentBalance}`,
        blockReason: 'Account balance data is corrupted'
      };
    }

    if (currentBalance <= 0) {
      logger.error(
        LogCategory.RISK_MANAGEMENT,
        '[AlphaTradeExecutor] Account balance is zero or negative',
        { userId, sessionId, balance: currentBalance }
      );
      return {
        success: false,
        error: `Account balance must be positive (current: ${currentBalance})`,
        blockReason: 'Cannot execute trades with zero or negative balance'
      };
    }

    if (balanceResult.governanceFlags?.suspectedHardcodedDefault) {
      logger.warn(
        LogCategory.RISK_MANAGEMENT,
        '[AlphaTradeExecutor] GOVERNANCE: Balance initialized with hardcoded default',
        { userId, sessionId, balance: currentBalance }
      );
    }

    const balanceValidation = validateBalanceIsReasonable(currentBalance, userId);
    if (!balanceValidation.valid) {
      logger.error(
        LogCategory.RISK_MANAGEMENT,
        '[AlphaTradeExecutor] Balance validation failed',
        { userId, sessionId, balance: currentBalance, reason: balanceValidation.reason }
      );
      return {
        success: false,
        error: `Account balance validation failed: ${balanceValidation.reason}`,
        blockReason: 'Cannot assess risk without valid account balance'
      };
    }

    // SSOT (2026-02-09): Trading balance comes from normalized session.starting_balance
    // The user_token_balance ($50 credit balance) is a token/credit system, NOT the trading account balance
    const tradingBalance = sessionData.startingBalance;
    logger.info(
      LogCategory.RISK_MANAGEMENT,
      '[AlphaTradeExecutor] SSOT: Using session.starting_balance as authoritative trading balance',
      {
        userId,
        sessionId,
        tradingBalance,
        tokenBalance: currentBalance,
        source: 'goal_sessions.starting_balance (normalized)'
      }
    );
    currentBalance = tradingBalance;

    // SSOT (2026-02-09): dollar_risk comes from normalized session data (already a proper number)
    let baseRiskPercent: number | undefined = undefined;
    if (sessionData.dollarRisk > 0) {
      baseRiskPercent = sessionData.dollarRisk / currentBalance;
      logger.info(
        LogCategory.RISK_MANAGEMENT,
        '[AlphaTradeExecutor] Using user-selected risk percentage',
        {
          userId,
          sessionId,
          dollarRisk: sessionData.dollarRisk,
          accountBalance: currentBalance,
          calculatedRiskPercent: (baseRiskPercent * 100).toFixed(2) + '%',
          source: 'session.dollar_risk (SSOT normalized)'
        }
      );
    } else {
      logger.info(
        LogCategory.RISK_MANAGEMENT,
        '[AlphaTradeExecutor] No dollar_risk found, using default risk from UnifiedRiskAuthority',
        { userId, sessionId, sessionDollarRisk: sessionData.dollarRisk, willUseDefault: true }
      );
    }

    const riskStyleForEV = normalizeToCanonicalStyle(sessionData.raw.trade_style || '');

    const riskAssessment = await unifiedRiskAuthority.assessTrade({
      tradeContext,
      symbol: decision.symbol,
      direction: decision.action === 'BUY' ? 'long' : 'short',
      entryPrice: decision.entry,
      stopLoss: decision.stopLoss,
      takeProfit: decision.takeProfit,
      userId,
      currentBalance: currentBalance,
      baseRiskPercent,
      riskMode: sessionData.raw.risk_mode || 'medium',
      goalSessionId: sessionId,
      tradeStyle: riskStyleForEV
    });

    if (!riskAssessment.approved) {
      return {
        success: false,
        error: riskAssessment.blockReason || 'Risk assessment failed',
        blockReason: riskAssessment.blockReason
      };
    }

    // GOAL-AWARE LOT SIZING (SSOT: Single decision authority)
    // If goal session exists with target value, calculate goal-aware lot size
    let finalLotSize = riskAssessment.recommendedLotSize;
    let lotSizingDecision: any = null;
    let lotSizingAuditRecord: any = {
      sessionHadTargetValue: false,
      sessionHadCurrentProgress: false,
      coordinatorInvoked: false,
      coordinatorSucceeded: false,
      usedFallbackCalculation: false,
      fallbackReason: null
    };
    let riskWarningsWithGoalContext = [...riskAssessment.criticalWarnings];

    // GOVERNANCE: Pre-validation of lot sizing input (catch cascading errors early)
    if (!Number.isFinite(finalLotSize) || finalLotSize <= 0) {
      logger.error(
        LogCategory.RISK_MANAGEMENT,
        '[AlphaTradeExecutor] Risk assessment returned invalid lot size',
        {
          userId,
          sessionId,
          symbol: decision.symbol,
          lotSize: finalLotSize,
          type: typeof finalLotSize,
        }
      );
      return {
        success: false,
        error: `Risk assessment produced invalid lot size: ${finalLotSize}`,
        blockReason: 'Cannot determine safe lot size for trade'
      };
    }

    // SSOT (2026-02-07): Goal-aware lot sizing is MANDATORY for every trade
    // HARD-BLOCK above guarantees session.target_value is always valid at this point
    {
      lotSizingAuditRecord.sessionHadTargetValue = true;
      lotSizingAuditRecord.sessionHadCurrentProgress = sessionData.raw.current_progress !== undefined;

      try {
        // ✅ SSOT FIX (2026-02-02): Use user-selected risk percentage from baseRiskPercent
        // PRIORITY: baseRiskPercent (from session.dollar_risk) > fallback to trade style map
        // This ensures "Scalp + Aggressive 5%" actually uses 5%, not hardcoded value
        let riskPercentageAllowed: number;

        if (baseRiskPercent !== undefined && baseRiskPercent > 0) {
          riskPercentageAllowed = baseRiskPercent * 100;
          logger.info(
            LogCategory.RISK_MANAGEMENT,
            '[AlphaTradeExecutor] Using user-selected risk percentage for goal-aware lot sizing',
            {
              userId,
              sessionId,
              riskPercentageAllowed: riskPercentageAllowed.toFixed(2) + '%',
              source: 'session.dollar_risk (SSOT)'
            }
          );
        } else {
          // Fallback: Determine risk from trade style map (legacy behavior)
          const tradeStyleRiskMap: { [key: string]: number } = {
            'scalp': 5,
            'day': 3,
            'swing': 2,
            'precision': 1
          };
          const tradeStyle = (sessionData.raw.trade_style || 'day').toLowerCase();
          riskPercentageAllowed = tradeStyleRiskMap[tradeStyle] || 3;
          logger.info(
            LogCategory.RISK_MANAGEMENT,
            '[AlphaTradeExecutor] Using fallback trade style risk mapping',
            {
              userId,
              sessionId,
              tradeStyle,
              riskPercentageAllowed: riskPercentageAllowed + '%',
              source: 'trade_style_map (legacy fallback)'
            }
          );
        }

        const currentProgress = sessionData.currentProgress;

        lotSizingAuditRecord.coordinatorInvoked = true;

        lotSizingDecision = await goalAwareLotSizingCoordinator.makeDecision({
          userId,
          goalSessionId: sessionId,
          symbol: decision.symbol,
          direction: decision.action === 'BUY' ? 'long' : 'short',
          accountBalance: currentBalance,
          goalAmount: sessionData.targetValue,
          currentProgress,
          riskPercentageAllowed,
          entryPrice: decision.entry,
          stopLossPrice: decision.stopLoss,
          takeProfitPrice: decision.takeProfit,
          tradeContext
        });

        // GOVERNANCE: Validate lot sizing decision output
        if (!Number.isFinite(lotSizingDecision.chosenLotSize) || lotSizingDecision.chosenLotSize <= 0) {
          logger.warn(
            LogCategory.RISK_MANAGEMENT,
            '[AlphaTradeExecutor] Goal-aware lot sizing produced invalid result, degrading to risk-only',
            {
              userId,
              sessionId,
              symbol: decision.symbol,
              chosenLotSize: lotSizingDecision.chosenLotSize,
              reason: lotSizingDecision.decisionReason,
            }
          );
          // Degrade to risk assessment lot size (already validated above)
          riskWarningsWithGoalContext.push('[Goal-Aware] Lot sizing degraded due to invalid calculation');
          lotSizingAuditRecord.usedFallbackCalculation = true;
          lotSizingAuditRecord.fallbackReason = 'Coordinator returned invalid lot size';
          lotSizingDecision = null; // Clear so expectedProfitAtTP won't be used
        } else {
          finalLotSize = lotSizingDecision.chosenLotSize;
          lotSizingAuditRecord.coordinatorSucceeded = true;

          // Add goal context to risk warnings
          riskWarningsWithGoalContext.push(
            `[Goal-Aware] ${lotSizingDecision.reasoning}`
          );

          logger.info(
            LogCategory.RISK_MANAGEMENT,
            '[AlphaTradeExecutor] Goal-aware lot sizing applied',
            {
              symbol: decision.symbol,
              riskFromRM: riskAssessment.recommendedLotSize.toFixed(3),
              requiredForGoal: lotSizingDecision.requiredLotForGoal.toFixed(3),
              chosen: finalLotSize.toFixed(3),
              expectedProfitAtTP: lotSizingDecision.expectedProfitAtTP,
              reason: lotSizingDecision.decisionReason
            }
          );
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(
          LogCategory.RISK_MANAGEMENT,
          '[AlphaTradeExecutor] Goal-aware lot sizing failed — degrading to risk assessment lot size',
          {
            error: errorMsg,
            userId,
            sessionId,
            symbol: decision.symbol,
            fallbackLotSize: riskAssessment.recommendedLotSize,
            tradingBalance: currentBalance,
            dollarRisk: sessionData.dollarRisk,
          }
        );

        finalLotSize = riskAssessment.recommendedLotSize;
        lotSizingAuditRecord.usedFallbackCalculation = true;
        lotSizingAuditRecord.fallbackReason = `Coordinator error: ${errorMsg}`;
        lotSizingDecision = null;

        // GOVERNANCE: Sanity check the fallback lot size against the trading balance
        // If the fallback is suspiciously small relative to what the user's risk should produce,
        // log a critical warning so the issue is visible (but do NOT block — degrade intelligently)
        const expectedMinLot = sessionData.dollarRisk / (currentBalance * 0.10);
        if (finalLotSize < expectedMinLot * 0.1 && expectedMinLot > 0) {
          logger.warn(
            LogCategory.RISK_MANAGEMENT,
            '[AlphaTradeExecutor] GOVERNANCE: Fallback lot size is suspiciously small relative to user risk',
            {
              finalLotSize,
              expectedMinLot: expectedMinLot.toFixed(4),
              dollarRisk: sessionData.dollarRisk,
              tradingBalance: currentBalance,
              message: 'Fallback degradation may be using incorrect balance or risk inputs'
            }
          );
        }
      }
    }

    // LAYER 6: ENTRY OVEREXTENSION VALIDATOR (CCIP 2026-02-11 - HARD INVALIDATION)
    // Validates if current price is overextended beyond optimal zone
    // PRINCIPLE: Overextension is a precision violation, not a risk parameter
    // Alpha must either enter correctly or not enter. No "enter badly but smaller."
    // Governance: Logs all events for audit trail
    let overextensionEventId: string | null = null;

    // Calculate optimal zone using ATR if available, otherwise use percentage-based
    let optimalZoneMin: number;
    let optimalZoneMax: number;

    if (tradeContext.atr && tradeContext.atr.value) {
      // ATR-based zone (optimal entry is ±0.3 ATR from decision entry price)
      const atrBuffer = tradeContext.atr.value * 0.3;
      optimalZoneMin = decision.entry - atrBuffer;
      optimalZoneMax = decision.entry + atrBuffer;
    } else {
      // Percentage-based fallback (±0.15% for forex, ±0.25% for indices/commodities)
      const percentBuffer = decision.symbol.includes('USD') || decision.symbol.includes('EUR') || decision.symbol.includes('GBP') || decision.symbol.includes('JPY')
        ? 0.0015 // 0.15% for forex pairs
        : 0.0025; // 0.25% for indices/commodities/metals
      optimalZoneMin = decision.entry * (1 - percentBuffer);
      optimalZoneMax = decision.entry * (1 + percentBuffer);
    }

    // Get trade style for threshold determination (TIER 3 FIX: Uses SSOT normalizeStyle)
    const tradeStyle = normalizeStyle(sessionData.raw.trade_style);

    // HARD INVALIDATION: Binary VALID/INVALID decision
    const overextensionValidation = EntryOverextensionValidator.validateEntry({
      symbol: decision.symbol,
      direction: decision.action === 'BUY' ? 'buy' : 'sell',
      currentPrice: decision.entry, // Current market price at decision time
      optimalZoneMin,
      optimalZoneMax,
      style: tradeStyle,
      alphaConfidence: decision.confidence,
      omegaConsensusCount: decision.omegaConsensusCount
    });

    // Log overextension event for governance (always log, even if valid)
    overextensionEventId = await EntryOverextensionValidator.logOverextensionEvent(
      sessionId,
      overextensionValidation,
      {
        symbol: decision.symbol,
        direction: decision.action === 'BUY' ? 'buy' : 'sell',
        currentPrice: decision.entry,
        optimalZoneMin,
        optimalZoneMax,
        style: tradeStyle,
        alphaConfidence: decision.confidence,
        omegaConsensusCount: decision.omegaConsensusCount
      }
    );

    // BLOCK TRADE if invalid (no position size mutation)
    if (!overextensionValidation.isValid) {
      logger.error(
        LogCategory.RISK_MANAGEMENT,
        '[AlphaTradeExecutor] ENTRY INVALID - Overextension exceeds threshold',
        {
          userId,
          sessionId,
          symbol: decision.symbol,
          style: tradeStyle,
          overextensionType: overextensionValidation.overextensionType,
          overextensionPct: overextensionValidation.overextensionPercentage.toFixed(1),
          threshold: overextensionValidation.maxAllowedOverextension,
          severity: overextensionValidation.severity,
          reasoning: overextensionValidation.reasoning
        }
      );

      // HARD BLOCK - No execution, Alpha must re-evaluate
      return {
        success: false,
        error: overextensionValidation.blockReason || 'Entry overextension exceeds threshold',
        blockReason: overextensionValidation.blockReason || 'PRECISION VIOLATION: Entry outside acceptable zone'
      };
    }

    // Entry is VALID - proceed with execution
    logger.info(
      LogCategory.RISK_MANAGEMENT,
      '[AlphaTradeExecutor] Entry validation passed',
      {
        userId,
        sessionId,
        symbol: decision.symbol,
        style: tradeStyle,
        overextensionType: overextensionValidation.overextensionType,
        overextensionPct: overextensionValidation.overextensionPercentage.toFixed(1),
        threshold: overextensionValidation.maxAllowedOverextension,
        optimalZone: `[${optimalZoneMin.toFixed(5)}, ${optimalZoneMax.toFixed(5)}]`
      }
    );

    // ============================================================================
    // Layer 6: Style Qualification Gate (HARD ENFORCEMENT)
    // ============================================================================
    // Validates that trade characteristics match the selected style's execution contract
    // - SCALP must execute like SCALP (M5, 15-60 min duration, appropriate targets)
    // - INTRADAY must execute like INTRADAY (H1, 2-10 hour duration)
    // Blocks trades that violate style execution boundaries

    const userSessionStyle = normalizeToCanonicalStyle(tradeStyle);
    const canonicalStyle = userSessionStyle;

    if (decision.resolvedStyle && decision.resolvedStyle !== userSessionStyle) {
      logger.error(
        LogCategory.AI_TRADING,
        `[STYLE IMMUTABILITY GUARD] BLOCKED: Decision resolvedStyle "${decision.resolvedStyle}" differs from user session style "${userSessionStyle}". Enforcing user style. This is a governance violation that was caught at the executor level.`,
        { userId, sessionId, symbol: decision.symbol, decisionStyle: decision.resolvedStyle, userStyle: userSessionStyle }
      );
      decision.resolvedStyle = userSessionStyle;
    }

    logger.info(
      LogCategory.AI_TRADING,
      '[Style Gate] Validating trade qualification for style execution contract',
      {
        userId,
        sessionId,
        symbol: decision.symbol,
        style: canonicalStyle,
        confidence: decision.confidence,
        omegaConsensus: decision.omegaConsensusPercent
      }
    );

    const expectedFillTimeHours = decision.expectedFillTimeHours || 0;

    const targetPips = calculatePipDistance(
      tradeContext.symbol,
      decision.entry,
      decision.takeProfit
    );
    const stopPips = calculatePipDistance(
      tradeContext.symbol,
      decision.entry,
      decision.stopLoss
    );

    const symbolConfig = getSymbolConfig(tradeContext.symbol);
    const assetClass = symbolConfig?.category === 'forex' ? 'FOREX' :
                       symbolConfig?.category === 'crypto' ? 'CRYPTO' :
                       symbolConfig?.category === 'metal' ? 'METAL' : 'INDEX';

    const styleQualification = await validateStyleQualification({
      symbol: decision.symbol,
      style: canonicalStyle,
      assetClass,
      expectedFillTimeHours,
      omegaConsensusPercent: decision.omegaConsensusPercent || 0,
      alphaFinalConfidence: decision.confidence,
      atrPercent: decision.atrPercent || 0,
      targetPips,
      stopPips,
      sessionId,
      userId,
      goalAmount: sessionData.targetValue
    });

    // ✅ GOVERNANCE FIX: Style Gate is ADVISORY, not BLOCKING
    // Philosophy: "Engines validate. Alpha decides. Trades degrade intelligently."
    // Style mismatches (duration too long) are warnings, not safety violations.
    if (!styleQualification.qualified) {
      logger.warn(
        LogCategory.AI_TRADING,
        '[Style Gate] ⚠️ STYLE ADVISORY - Trade proceeds with style mismatch warning',
        {
          userId,
          sessionId,
          symbol: decision.symbol,
          style: canonicalStyle,
          advisory: styleQualification.blockReason,
          violations: styleQualification.violations.map(v => ({
            type: v.type,
            severity: v.severity,
            actual: v.actual,
            required: v.required,
            detail: v.detail
          })),
          decision: 'PROCEED - Alpha has final authority'
        }
      );

      const criticalViolations = styleQualification.violations.filter(v =>
        v.severity === 'CRITICAL'
      );

      if (criticalViolations.length > 0) {
        logger.error(
          LogCategory.AI_TRADING,
          '[Style Gate] SAFETY BLOCK - Critical severity violations detected',
          { criticalViolations }
        );
        return {
          success: false,
          error: `SAFETY VIOLATION: ${criticalViolations.map(v => v.detail).join('; ')}`,
          blockReason: `SAFETY VIOLATION: ${criticalViolations.map(v => v.detail).join('; ')}`
        };
      }

      const advisoryViolations = styleQualification.violations.filter(v =>
        v.severity !== 'CRITICAL'
      );
      if (advisoryViolations.length > 0) {
        logger.warn(
          LogCategory.AI_TRADING,
          '[Style Gate] Advisory violations logged - Alpha authority upheld, trade proceeds',
          {
            advisoryCount: advisoryViolations.length,
            advisories: advisoryViolations.map(v => `${v.type}(${v.severity}): ${v.detail}`)
          }
        );
      } else {
        logger.info(
          LogCategory.AI_TRADING,
          '[Style Gate] Trade proceeding - Alpha authority upheld'
        );
      }
    }

    logger.info(
      LogCategory.AI_TRADING,
      '[Style Gate] Trade qualified for style execution',
      {
        userId,
        sessionId,
        symbol: decision.symbol,
        style: canonicalStyle,
        violations: styleQualification.violations.length,
        advisory: styleQualification.advisory
      }
    );

    const rawTradeStyle = sessionData.raw.trade_style || '';

    // MODE ROUTING (Execute based on selected mode)
    if (mode === 'IMMEDIATE') {
      return await this.executeImmediate({
        decision,
        userId,
        sessionId,
        session: sessionData.raw,
        lotSize: finalLotSize,
        riskDollars: riskAssessment.trueRiskDollars || riskAssessment.adjustedRiskDollars,
        riskWarnings: riskWarningsWithGoalContext,
        inputs,
        lotSizingDecisionId: lotSizingDecision?.auditRecordId,
        expectedProfitAtTP: lotSizingDecision?.expectedProfitAtTP,
        lotSizingAuditRecord,
        overextensionEventId,
        canonicalStyle,
        rawTradeStyle
      });
    } else if (mode === 'PENDING') {
      return await this.createPending({
        decision,
        userId,
        sessionId,
        session: sessionData.raw,
        lotSize: finalLotSize,
        riskDollars: riskAssessment.trueRiskDollars || riskAssessment.adjustedRiskDollars,
        riskWarnings: riskWarningsWithGoalContext,
        inputs,
        lotSizingDecisionId: lotSizingDecision?.auditRecordId,
        expectedProfitAtTP: lotSizingDecision?.expectedProfitAtTP,
        lotSizingAuditRecord,
        overextensionEventId,
        canonicalStyle,
        rawTradeStyle
      });
    } else {
      return await this.createMonitored({
        decision,
        userId,
        sessionId,
        lotSize: finalLotSize,
        riskDollars: riskAssessment.trueRiskDollars || riskAssessment.adjustedRiskDollars,
        lotSizingDecisionId: lotSizingDecision?.auditRecordId,
        overextensionEventId,
        canonicalStyle,
        rawTradeStyle
      });
    }
  }

  /**
   * Check trade capacity (confidence, slots, duplicates)
   */
  private async checkTradeCapacity(
    symbol: string,
    confidence: number,
    sessionId: string,
    session: any
  ): Promise<{ valid: boolean; reason?: string }> {
    // Confidence check
    if (confidence < 50) {
      return { valid: false, reason: 'Confidence too low (< 50%)' };
    }

    const threshold = session.min_confidence || getMinConfidenceThreshold(session.risk_mode);
    if (confidence < threshold) {
      return {
        valid: false,
        reason: `Confidence ${confidence}% below ${session.risk_mode} mode threshold (${threshold}%)`
      };
    }

    // Trade slots check
    const { data: openTrades } = await supabase
      .from('goal_session_trades')
      .select('*')
      .eq('goal_session_id', sessionId)
      .in('status', ['open', 'pending']);

    const maxConcurrentTrades = session.risk_mode === 'low' ? 1 : session.risk_mode === 'high' ? 3 : 2;
    if (openTrades && openTrades.length >= maxConcurrentTrades) {
      return {
        valid: false,
        reason: `Maximum concurrent trades (${maxConcurrentTrades}) reached for ${session.risk_mode} mode`
      };
    }

    // Duplicate symbol check
    const existingSymbolTrade = openTrades?.find(trade => trade.symbol === symbol);
    if (existingSymbolTrade) {
      return {
        valid: false,
        reason: `Already have an open/pending position on ${symbol}`
      };
    }

    return { valid: true };
  }

  /**
   * Execute immediately at market price
   * SSOT: Uses priceCoordinator.extractExecutionPrice() to get correct price component
   * CCIP: Logs price extraction failures for governance audit
   * GOAL-AWARE: Uses expectedProfitAtTP from lot sizing coordinator (SSOT fix 2026-02-03)
   */
  private async executeImmediate(params: {
    decision: AlphaDecision;
    userId: string;
    sessionId: string;
    session: any;
    lotSize: number;
    riskDollars: number;
    riskWarnings: string[];
    inputs: TradeExecutionInputs;
    lotSizingDecisionId?: string;
    expectedProfitAtTP?: number;
    lotSizingAuditRecord?: any;
    overextensionEventId?: string | null;
    canonicalStyle: CanonicalStyle;
    rawTradeStyle: string;
  }): Promise<TradeExecutionResult> {
    const { decision, userId, sessionId, lotSize, riskDollars, inputs } = params;

    // Fetch live price
    const priceResult = await priceCoordinator.getPrice(decision.symbol, {
      allowStale: true,
      useCacheFirst: false
    });

    if (!priceResult.success || !priceResult.price) {
      return {
        success: false,
        error: 'Could not fetch live price'
      };
    }

    const priceData = priceResult.price;
    let entryPrice: number;

    // SSOT: Extract correct price component for trade direction
    try {
      const direction = decision.action === 'BUY' ? 'buy' : 'sell';
      entryPrice = priceCoordinator.extractExecutionPrice(priceData, direction);
    } catch (error: any) {
      // CCIP: Log price extraction failure
      console.error('[AlphaTradeExecutor] Price extraction failed:', {
        symbol: decision.symbol,
        direction: decision.action,
        error: error.message,
        userId,
        sessionId
      });

      await this.logCCIPChange({
        changeType: 'PRICE_EXTRACTION_ERROR',
        tableAffected: 'goal_session_trades',
        recordId: userId,
        userId,
        metadata: {
          symbol: decision.symbol,
          direction: decision.action,
          error: error.message,
          priceSource: priceData.source
        }
      });

      return {
        success: false,
        error: error.message || 'Failed to extract execution price'
      };
    }

    // Directional pricing (ASK for BUY, BID for SELL) already accounts for spread.
    // No additional static slippage is applied to avoid double-counting.
    const adjustedEntry = entryPrice;

    // GOVERNANCE: Validate adjusted entry is valid number
    if (!Number.isFinite(adjustedEntry)) {
      return {
        success: false,
        error: `Slippage adjustment resulted in invalid price: ${adjustedEntry} (base: ${entryPrice}, slippage: ${slippage})`
      };
    }

    // CCIP (2026-02-12): Preserve Alpha's intended risk geometry at actual fill price
    // Alpha's decision authority is the risk DISTANCE (pips), not absolute price levels.
    // When actual fill differs from planned entry, shift SL/TP to maintain planned distances.
    // This is NOT mutation of Alpha's decision - it preserves Alpha's intent.
    const plannedEntry = decision.entry;
    const entryDeviation = adjustedEntry - plannedEntry;
    let executionSL = decision.stopLoss;
    let executionTP = decision.takeProfit;
    let executionTP1 = decision.tp1Price;
    let executionTP2 = decision.tp2Price;
    let slTpRecalculated = false;

    if (Number.isFinite(entryDeviation) && Math.abs(entryDeviation) > 1e-8) {
      executionSL = decision.stopLoss + entryDeviation;
      executionTP = decision.takeProfit + entryDeviation;
      if (decision.tp1Price != null && Number.isFinite(decision.tp1Price)) {
        executionTP1 = decision.tp1Price + entryDeviation;
      }
      if (decision.tp2Price != null && Number.isFinite(decision.tp2Price)) {
        executionTP2 = decision.tp2Price + entryDeviation;
      }
      slTpRecalculated = true;

      const symbolConfig = getSymbolConfig(decision.symbol);
      const pipSize = symbolConfig?.pipValue || 0.0001;
      const deviationPips = entryDeviation / pipSize;

      logger.info(
        LogCategory.TRADE_EXECUTION,
        '[AlphaTradeExecutor] SL/TP recalculated to preserve Alpha risk geometry',
        {
          symbol: decision.symbol,
          plannedEntry,
          actualEntry: adjustedEntry,
          deviationPips: Math.round(deviationPips * 10) / 10,
          originalSL: decision.stopLoss,
          executionSL,
          originalTP: decision.takeProfit,
          executionTP,
          recalculationReason: 'Actual fill price differs from Alpha planned entry'
        }
      );
    }

    // Insert trade
    let tradeData: any;
    try {
      tradeData = this.buildTradeRecord({
        decision,
        userId,
        sessionId,
        lotSize,
        riskDollars,
        entryPrice: adjustedEntry,
        status: 'open',
        openedAt: new Date().toISOString(),
        inputs,
        expectedProfitFromCoordinator: params.expectedProfitAtTP,
        lotSizingAuditRecord: params.lotSizingAuditRecord,
        executionStopLoss: slTpRecalculated ? executionSL : undefined,
        executionTakeProfit: slTpRecalculated ? executionTP : undefined,
        executionTP1: slTpRecalculated ? executionTP1 : undefined,
        executionTP2: slTpRecalculated ? executionTP2 : undefined,
        canonicalStyle: params.canonicalStyle,
        rawTradeStyle: params.rawTradeStyle,
      });
    } catch (error: any) {
      console.error('[AlphaTradeExecutor] Trade record validation failed:', {
        error: error.message,
        decision,
        userId,
        sessionId
      });
      return {
        success: false,
        error: error.message || 'Trade record validation failed'
      };
    }

    // GOVERNANCE: Pre-insertion validation
    this.validateTradeRecord(tradeData, 'immediate');

    // TIER 3 FIX: Mandatory Safety Validator - ONLY allowed blocker
    // CRITICAL: This is the ONLY service that can block trades for safety reasons
    // All other checks (confidence, EQS, etc.) are advisory only
    // CCIP (2026-02-12): Pass execution SL/TP (recalculated if needed), not Alpha's planned levels
    const safetyValidation = await mandatorySafetyValidator.validate(
      userId,
      sessionId,
      decision.symbol,
      decision.action as 'BUY' | 'SELL',
      adjustedEntry,
      executionSL,
      executionTP,
      lotSize,
      inputs.tradeContext
    );

    if (!safetyValidation.allowed) {
      logger.error(
        LogCategory.RISK_MANAGEMENT,
        '[AlphaTradeExecutor] MANDATORY SAFETY BLOCK - Trade rejected',
        {
          userId,
          sessionId,
          symbol: decision.symbol,
          blockReason: safetyValidation.blockReason,
          message: safetyValidation.message,
          details: safetyValidation.details
        }
      );

      // Log to CCIP for governance tracking
      await this.logCCIPChange({
        changeType: 'MANDATORY_SAFETY_BLOCK',
        tableAffected: 'goal_session_trades',
        recordId: userId,
        userId,
        sessionId,
        metadata: {
          symbol: decision.symbol,
          direction: decision.action,
          blockReason: safetyValidation.blockReason,
          message: safetyValidation.message,
          ...safetyValidation.details
        }
      });

      return {
        success: false,
        error: safetyValidation.message || 'Mandatory safety check failed',
        blockReason: `SAFETY_BLOCK: ${safetyValidation.blockReason}`
      };
    }

    const { data: trade, error } = await supabase
      .from('goal_session_trades')
      .insert(tradeData)
      .select()
      .single();

    if (error || !trade) {
      // DIAGNOSTIC: Log full error details to identify schema mismatch
      console.error('[AlphaTradeExecutor] Database insertion failed:', {
        error,
        errorMessage: error?.message,
        errorDetails: error?.details,
        errorHint: error?.hint,
        errorCode: error?.code,
        tradeData // Log the payload being sent
      });

      return {
        success: false,
        error: error?.message || error?.details || JSON.stringify(error) || 'Failed to create trade'
      };
    }

    // Link lot sizing decision to trade (for governance learning)
    if (params.lotSizingDecisionId) {
      try {
        await goalAwareLotSizingCoordinator.linkTradeToDecision(
          params.lotSizingDecisionId,
          trade.id,
          userId
        );
      } catch (error) {
        logger.warn(
          LogCategory.GOVERNANCE,
          '[AlphaTradeExecutor] Failed to link lot sizing decision to trade',
          { error, tradeId: trade.id }
        );
        // Continue execution - this is non-blocking
      }
    }

    // Log lot sizing audit record for governance tracking
    try {
      await this.logLotSizingAudit({
        userId,
        sessionId,
        tradeId: trade.id,
        auditRecord: params.lotSizingAuditRecord,
        expectedProfitValue: trade.expected_profit_for_session,
        symbol: decision.symbol,
        entryPrice: trade.entry_price,
        takeProfit: trade.take_profit,
        lotSize: trade.lot_size
      });
    } catch (error) {
      // Non-blocking - governance logging shouldn't prevent trade execution
      logger.warn(
        LogCategory.GOVERNANCE,
        '[AlphaTradeExecutor] Failed to log lot sizing audit record',
        { error, tradeId: trade.id }
      );
    }

    // CCIP: Log successful trade creation
    await this.logCCIPChange({
      changeType: 'TRADE_CREATED',
      tableAffected: 'goal_session_trades',
      recordId: trade.id,
      userId,
      metadata: {
        sessionId,
        symbol: decision.symbol,
        mode: 'immediate',
        entryPrice: adjustedEntry,
        lotSize,
        lotSizingDecisionId: params.lotSizingDecisionId
      }
    });

    try {
      await creditValidationService.deductSignalCredits(userId, sessionId, {
        symbol: decision.symbol,
        intentId: trade.id,
        intentType: 'trade_executed',
        confidence: decision.confidence
      });
    } catch (creditErr) {
      logger.warn(LogCategory.GOVERNANCE, '[AlphaTradeExecutor] Credit deduction failed (non-blocking)', {
        error: creditErr, tradeId: trade.id, userId
      });
    }

    const { goalSessionStateMachine } = await import('./coordinators/goal-session-state-machine');
    await goalSessionStateMachine.transition(sessionId, 'active', {
      reason: 'Trade executed - session now active',
      triggeredBy: 'alpha-trade-executor',
    });

    await notificationCoordinator.send({
      userId,
      sessionId,
      type: 'trade_opened',
      title: `Trade Opened: ${decision.symbol}`,
      message: `${decision.action} ${lotSize.toFixed(2)} lots at ${adjustedEntry.toFixed(5)}`,
      priority: 'critical',
      tradeId: trade.id,
      metadata: {
        symbol: decision.symbol,
        action: decision.action,
        lotSize,
        entryPrice: adjustedEntry,
        stopLoss: decision.stopLoss,
        takeProfit: decision.takeProfit,
        expectedProfit: params.expectedProfitAtTP,
        confidence: decision.confidence,
        tp1Price: decision.tp1Price,
        tp2Price: decision.tp2Price,
        tp1Confidence: decision.tp1Confidence,
        thesis: decision.thesis,
        sessionId
      }
    });

    // SSOT FIX (2026-02-13): Removed direct showTradeEntry call
    // The realtime-trade-notification-listener is the SINGLE authority for trade entry modals
    // The notificationCoordinator.send above creates the goal_notification record
    // which the realtime listener picks up to show the modal with full metadata
    // This eliminates the duplicate modal/sound that occurred when both paths triggered

    // CCIP FIX (2026-02-06): Create entry_intents record for Entry Quality Advisor
    // SSOT: entry_intents is the authoritative record linking trade execution to quality analysis
    // Without this record, EntryPriceMonitor shows placeholder instead of entry quality data
    await this.createPostExecutionEntryIntent({
      userId,
      sessionId,
      tradeId: trade.id,
      decision,
      entryPrice: adjustedEntry,
      canonicalStyle: params.canonicalStyle
    });

    return {
      success: true,
      tradeId: trade.id,
      message: `Trade opened: ${decision.action} ${lotSize.toFixed(2)} lots at ${adjustedEntry.toFixed(5)}`
    };
  }

  /**
   * Create pending trade (awaiting user confirmation)
   * SSOT: Uses priceCoordinator.extractExecutionPrice() if decision.entry is null
   * CCIP COMPLIANCE (2026-02-02): Fetch live price and extract direction-specific component
   * GOAL-AWARE: Uses expectedProfitAtTP from lot sizing coordinator (SSOT fix 2026-02-03)
   */
  private async createPending(params: {
    decision: AlphaDecision;
    userId: string;
    sessionId: string;
    session: any;
    lotSize: number;
    riskDollars: number;
    riskWarnings: string[];
    inputs: TradeExecutionInputs;
    lotSizingDecisionId?: string;
    expectedProfitAtTP?: number;
    lotSizingAuditRecord?: any;
    overextensionEventId?: string | null;
    canonicalStyle: CanonicalStyle;
    rawTradeStyle: string;
  }): Promise<TradeExecutionResult> {
    const { decision, userId, sessionId, lotSize, riskDollars, inputs } = params;

    // GOVERNANCE FIX: If decision.entry is null, fetch live price
    let entryPrice = decision.entry;
    if (!entryPrice) {
      const priceResult = await priceCoordinator.getPrice(decision.symbol, {
        allowStale: true,
        useCacheFirst: false
      });

      if (!priceResult.success || !priceResult.price) {
        return {
          success: false,
          error: 'Could not fetch live price for pending trade'
        };
      }

      const priceData = priceResult.price;

      // SSOT: Extract correct price component for trade direction
      try {
        const direction = decision.action === 'BUY' ? 'buy' : 'sell';
        entryPrice = priceCoordinator.extractExecutionPrice(priceData, direction);
      } catch (error: any) {
        // CCIP: Log price extraction failure
        console.error('[AlphaTradeExecutor] Pending trade price extraction failed:', {
          symbol: decision.symbol,
          direction: decision.action,
          error: error.message,
          userId,
          sessionId
        });

        await this.logCCIPChange({
          changeType: 'PRICE_EXTRACTION_ERROR',
          tableAffected: 'goal_session_trades',
          recordId: userId,
          userId,
          metadata: {
            symbol: decision.symbol,
            direction: decision.action,
            tradeMode: 'pending',
            error: error.message,
            priceSource: priceData.source
          }
        });

        return {
          success: false,
          error: error.message || 'Failed to extract execution price for pending trade'
        };
      }
    }

    // Insert trade
    let tradeData: any;
    try {
      tradeData = this.buildTradeRecord({
        decision,
        userId,
        sessionId,
        lotSize,
        riskDollars,
        entryPrice,
        status: 'pending',
        openedAt: null,
        inputs,
        expectedProfitFromCoordinator: params.expectedProfitAtTP,
        lotSizingAuditRecord: params.lotSizingAuditRecord,
        canonicalStyle: params.canonicalStyle,
        rawTradeStyle: params.rawTradeStyle,
      });
    } catch (error: any) {
      console.error('[AlphaTradeExecutor] Pending trade record validation failed:', {
        error: error.message,
        decision,
        userId,
        sessionId
      });
      return {
        success: false,
        error: error.message || 'Trade record validation failed'
      };
    }

    // GOVERNANCE: Pre-insertion validation
    this.validateTradeRecord(tradeData, 'pending');

    // TIER 3 FIX: Mandatory Safety Validator - ONLY allowed blocker (Pending trades)
    // CRITICAL: Even pending trades must pass safety validation before creation
    const safetyValidation = await mandatorySafetyValidator.validate(
      userId,
      sessionId,
      decision.symbol,
      decision.action as 'BUY' | 'SELL',
      entryPrice,
      decision.stopLoss,
      decision.takeProfit,
      lotSize,
      inputs.tradeContext
    );

    if (!safetyValidation.allowed) {
      logger.error(
        LogCategory.RISK_MANAGEMENT,
        '[AlphaTradeExecutor] MANDATORY SAFETY BLOCK - Pending trade rejected',
        {
          userId,
          sessionId,
          symbol: decision.symbol,
          blockReason: safetyValidation.blockReason,
          message: safetyValidation.message,
          details: safetyValidation.details
        }
      );

      // Log to CCIP for governance tracking
      await this.logCCIPChange({
        changeType: 'MANDATORY_SAFETY_BLOCK',
        tableAffected: 'goal_session_trades',
        recordId: userId,
        userId,
        sessionId,
        metadata: {
          tradeMode: 'pending',
          symbol: decision.symbol,
          direction: decision.action,
          blockReason: safetyValidation.blockReason,
          message: safetyValidation.message,
          ...safetyValidation.details
        }
      });

      return {
        success: false,
        error: safetyValidation.message || 'Mandatory safety check failed',
        blockReason: `SAFETY_BLOCK: ${safetyValidation.blockReason}`
      };
    }

    const { data: trade, error } = await supabase
      .from('goal_session_trades')
      .insert(tradeData)
      .select()
      .single();

    if (error || !trade) {
      // DIAGNOSTIC: Log full error details to identify schema mismatch
      console.error('[AlphaTradeExecutor] Pending trade creation failed:', {
        error,
        errorMessage: error?.message,
        errorDetails: error?.details,
        errorHint: error?.hint,
        errorCode: error?.code,
        tradeData // Log the payload being sent
      });

      return {
        success: false,
        error: error?.message || error?.details || JSON.stringify(error) || 'Failed to create pending trade'
      };
    }

    // Link lot sizing decision to trade (for governance learning)
    if (params.lotSizingDecisionId) {
      try {
        await goalAwareLotSizingCoordinator.linkTradeToDecision(
          params.lotSizingDecisionId,
          trade.id,
          userId
        );
      } catch (error) {
        logger.warn(
          LogCategory.GOVERNANCE,
          '[AlphaTradeExecutor] Failed to link lot sizing decision to pending trade',
          { error, tradeId: trade.id }
        );
        // Continue execution - this is non-blocking
      }
    }

    // Log lot sizing audit record for governance tracking
    try {
      await this.logLotSizingAudit({
        userId,
        sessionId,
        tradeId: trade.id,
        auditRecord: params.lotSizingAuditRecord,
        expectedProfitValue: trade.expected_profit_for_session,
        symbol: decision.symbol,
        entryPrice: trade.entry_price,
        takeProfit: trade.take_profit,
        lotSize: trade.lot_size
      });
    } catch (error) {
      // Non-blocking - governance logging shouldn't prevent trade execution
      logger.warn(
        LogCategory.GOVERNANCE,
        '[AlphaTradeExecutor] Failed to log lot sizing audit record for pending trade',
        { error, tradeId: trade.id }
      );
    }

    // CCIP: Log successful pending trade creation
    await this.logCCIPChange({
      changeType: 'TRADE_CREATED',
      tableAffected: 'goal_session_trades',
      recordId: trade.id,
      userId,
      metadata: {
        sessionId,
        symbol: decision.symbol,
        mode: 'pending',
        entryPrice,
        lotSize,
        lotSizingDecisionId: params.lotSizingDecisionId
      }
    });

    const { goalSessionStateMachine } = await import('./coordinators/goal-session-state-machine');
    await goalSessionStateMachine.transition(sessionId, 'active', {
      reason: 'Pending trade created - session now active',
      triggeredBy: 'alpha-trade-executor',
    });

    // Create notification (use resolved entryPrice, not decision.entry which may be null)
    await this.createNotification({
      userId,
      sessionId,
      type: 'signal',
      title: `Trade Signal: ${decision.symbol}`,
      message: `${decision.action} ${lotSize.toFixed(2)} lots at ${entryPrice.toFixed(5)}`,
      tradeId: trade.id
    });

    // CCIP FIX (2026-02-06): Create entry_intents record for Entry Quality Advisor
    // Pending trades still get an entry intent so the advisor can show data once executed
    await this.createPostExecutionEntryIntent({
      userId,
      sessionId,
      tradeId: trade.id,
      decision,
      entryPrice,
      canonicalStyle: params.canonicalStyle
    });

    return {
      success: true,
      tradeId: trade.id,
      message: `Pending trade created: ${decision.action} ${lotSize.toFixed(2)} lots`
    };
  }

  /**
   * Create monitored entry intent
   *
   * CCIP FIX (2026-02-06): Corrected column names to match entry_intents schema
   * SSOT: entry_intents table uses session_id (not goal_session_id),
   *       direction as 'long'/'short' (not 'buy'/'sell'),
   *       and requires intent_type, urgency, entry_zone_min/max, timeout_at
   */
  private async createMonitored(params: {
    decision: AlphaDecision;
    userId: string;
    sessionId: string;
    lotSize: number;
    riskDollars: number;
    lotSizingDecisionId?: string;
    overextensionEventId?: string | null;
    canonicalStyle: CanonicalStyle;
    rawTradeStyle: string;
  }): Promise<TradeExecutionResult> {
    const { decision, userId, sessionId } = params;

    const now = new Date();
    const timeoutMinutes = decision.entry_intent?.timeout_minutes || 60;
    const timeoutAt = new Date(now.getTime() + timeoutMinutes * 60 * 1000).toISOString();
    const direction = toLongShort(decision.action === 'BUY' ? 'buy' : 'sell');

    // CCIP 2026-02-17: Alpha's LLM entry advisory is SOLE authority for Entry Monitor
    const monitorAdvisory = decision.entry_advisory || null;
    const monitorIsGoodEntry = !monitorAdvisory || monitorAdvisory.verdict === 'GOOD_ENTRY';
    const monitorVerdict = monitorIsGoodEntry ? 'OPTIMAL_ENTRY' : 'WAIT_FOR_PULLBACK';
    const monitorPullbackMin = monitorAdvisory?.pullback_zone_min ?? null;
    const monitorPullbackMax = monitorAdvisory?.pullback_zone_max ?? null;
    const monitorPullbackMid = (monitorPullbackMin != null && monitorPullbackMax != null)
      ? (monitorPullbackMin + monitorPullbackMax) / 2
      : null;

    logger.info(
      LogCategory.GOVERNANCE,
      '[AlphaTradeExecutor] Alpha entry advisory applied (MONITORED mode)',
      {
        symbol: decision.symbol,
        alphaEntryMode: decision.entry_mode || 'WAIT_ENTRY',
        runawayPolicy: decision.entry_spec?.runawayPolicy ?? 'RESCAN',
        verdict: monitorVerdict,
        alphaVerdict: monitorAdvisory?.verdict || 'GOOD_ENTRY (default)',
        pullbackZone: monitorPullbackMin && monitorPullbackMax ? `${monitorPullbackMin}-${monitorPullbackMax}` : 'none'
      }
    );

    const { data: intent, error } = await supabase
      .from('entry_intents')
      .insert({
        session_id: sessionId,
        user_id: userId,
        symbol: decision.symbol,
        direction,
        intent_type: decision.entry_intent?.intent_type || 'pullback_to_support',
        urgency: decision.entry_intent?.urgency || 'MEDIUM',
        entry_zone_min: monitorPullbackMin ?? (decision.entry_intent?.entry_zone_min || decision.entry),
        entry_zone_max: monitorPullbackMax ?? (decision.entry_intent?.entry_zone_max || decision.entry),
        timeout_at: timeoutAt,
        timeout_minutes: timeoutMinutes,
        status: 'monitoring',
        alpha_reasoning: decision.reasoning,
        alpha_confidence: decision.confidence,
        market_context: this.buildAlphaAdvisoryContext(decision, decision.entry, monitorAdvisory),
        entry_mode: decision.entry_mode || 'WAIT_ENTRY',
        style: params.canonicalStyle,
        thesis: decision.thesis,
        style_intent: decision.style_intent,
        execution_preference: decision.execution_preference || 'WAIT_PULLBACK',
        runaway_policy: decision.entry_spec?.runawayPolicy ?? 'RESCAN',
        structural_verdict: monitorVerdict,
        structural_level_price: null,
        structural_level_type: null,
        structural_level_strength: null,
        structural_level_touches: null,
        pullback_target_price: monitorPullbackMid,
        pullback_improvement_pips: null
      })
      .select()
      .single();

    if (error || !intent) {
      logger.error(
        LogCategory.GOVERNANCE,
        '[AlphaTradeExecutor] Failed to create monitored entry intent',
        { error: error?.message, userId, sessionId, symbol: decision.symbol }
      );
      return {
        success: false,
        error: error?.message || 'Failed to create entry intent'
      };
    }

    const entryModeLabel = decision.entry_mode === 'WAIT_HIGHER_EDGE'
      ? 'WAIT_HIGHER_EDGE'
      : 'WAIT_ENTRY';

    const monitorTitle = decision.entry_mode === 'WAIT_HIGHER_EDGE'
      ? `Trade Found — Wait for Edge: ${decision.symbol}`
      : `Trade Found — Wait for Pullback: ${decision.symbol}`;

    const monitorMessage = decision.entry_mode === 'WAIT_HIGHER_EDGE'
      ? `Alpha is waiting for higher-edge conditions on ${decision.symbol} before entering.`
      : monitorPullbackMin && monitorPullbackMax
        ? `Alpha recommends waiting for pullback to ${monitorPullbackMin.toFixed(5)} – ${monitorPullbackMax.toFixed(5)}`
        : `Alpha is monitoring ${decision.symbol} for a better entry.`;

    await notificationCoordinator.send({
      userId,
      sessionId,
      type: 'entry_monitoring_started',
      title: monitorTitle,
      message: monitorMessage,
      priority: 'high',
      metadata: {
        symbol: decision.symbol,
        direction: direction,
        entry_mode: decision.entry_mode || 'WAIT_ENTRY',
        pullback_zone_min: monitorPullbackMin,
        pullback_zone_max: monitorPullbackMax,
        pullback_target_price: monitorPullbackMid,
        confidence: decision.confidence,
        setupType: decision.thesis,
        reasoning: decision.reasoning,
        sessionId
      }
    });

    return {
      success: true,
      isMonitoring: true,
      message: `[${entryModeLabel}] Monitoring ${decision.symbol} for entry — waiting for pullback to zone`
    };
  }

  /**
   * Build trade record for database insertion
   * PHASE 1 GOVERNANCE COMPLIANCE (20260202):
   * - Includes all NOT NULL fields (lot_size, expected_profit_for_session, current_pnl)
   * - Validates entry_price is not null
   * - Calculates expected_profit_for_session based on TP - Entry distance
   * - current_pnl is never null (0 for open, recalculated as needed)
   *
   * SSOT FIX (2026-02-03): expectedProfitFromCoordinator flows from goal-aware lot sizing
   * CCIP COMPLIANCE: lotSizingAuditRecord enables governance tracking of fallback usage
   */
  private buildTradeRecord(params: {
    decision: AlphaDecision;
    userId: string;
    sessionId: string;
    lotSize: number;
    riskDollars: number;
    entryPrice: number;
    status: 'open' | 'pending';
    openedAt: string | null;
    inputs: TradeExecutionInputs;
    expectedProfitFromCoordinator?: number;
    lotSizingAuditRecord?: any;
    executionStopLoss?: number;
    executionTakeProfit?: number;
    executionTP1?: number | null;
    executionTP2?: number;
    canonicalStyle: CanonicalStyle;
    rawTradeStyle: string;
    alphaDecisionId?: string;
  }): any {
    const {
      decision, userId, sessionId, lotSize, riskDollars, entryPrice, status, openedAt,
      inputs, expectedProfitFromCoordinator, lotSizingAuditRecord,
      executionStopLoss, executionTakeProfit, executionTP1, executionTP2,
      canonicalStyle, rawTradeStyle, alphaDecisionId
    } = params;

    // GOVERNANCE: Comprehensive price validation (catches NaN from previous cascading errors)
    if (entryPrice === null || entryPrice === undefined) {
      throw new Error('[AlphaTradeExecutor] buildTradeRecord: entryPrice cannot be null or undefined');
    }

    if (!Number.isFinite(entryPrice)) {
      throw new Error(
        `[AlphaTradeExecutor] buildTradeRecord: entryPrice must be a finite number, got: ${entryPrice} (type: ${typeof entryPrice})`
      );
    }

    if (entryPrice <= 0) {
      throw new Error(
        `[AlphaTradeExecutor] buildTradeRecord: entryPrice must be positive, got: ${entryPrice} for ${decision.symbol}`
      );
    }

    // Get regime bucket
    const regimeBucket = inputs.regimeSnapshot && inputs.adversarialState
      ? getRegimeBucket(inputs.regimeSnapshot, inputs.adversarialState)
      : null;

    // SSOT FIX (2026-02-03): Use coordinator's expectedProfitAtTP if available
    // The coordinator calculates profit WITH proper pip-to-dollar conversion
    // This ensures trade target on dashboard is accurate (~$133, not ~$1)
    let expectedProfit: number;
    let usedFallback = false;

    if (expectedProfitFromCoordinator !== undefined && expectedProfitFromCoordinator >= 0) {
      // SSOT: Coordinator's value is authoritative for goal-aware trading
      expectedProfit = expectedProfitFromCoordinator;
    } else if (decision.takeProfit && decision.takeProfit > 0) {
      // FALLBACK: Only if coordinator profit unavailable
      // NOTE: This fallback lacks pip conversion, so it will be inaccurate
      usedFallback = true;

      // CCIP: Log fallback usage with full context
      const fallbackReason = expectedProfitFromCoordinator === undefined
        ? 'Coordinator data not available'
        : expectedProfitFromCoordinator < 0
        ? 'Coordinator returned negative profit'
        : 'Unknown coordinator issue';

      logger.warn(
        LogCategory.RISK_MANAGEMENT,
        '[AlphaTradeExecutor] Using fallback expectedProfit calculation (lacks pip conversion)',
        {
          symbol: decision.symbol,
          fallbackReason,
          coordinatorValue: expectedProfitFromCoordinator,
          fallbackCalculated: Math.abs(decision.takeProfit - entryPrice) * lotSize,
          entryPrice,
          takeProfit: decision.takeProfit,
          lotSize,
          note: 'Fallback calculation does not account for pip value differences (e.g., JPY vs USD pairs)'
        }
      );

      // FIXED: Use proper pip-to-dollar conversion instead of direct price difference
      // This ensures JPY pairs calculate profit correctly (1 pip = $10, not $0.01)
      const pipDistance = Math.abs(decision.takeProfit - entryPrice);
      const dollarPerPipForTp = calculateDollarPerPip(decision.symbol, lotSize);
      const pipDifference = calculatePipDistance(decision.symbol, entryPrice, decision.takeProfit);
      expectedProfit = Math.abs(pipDifference) * dollarPerPipForTp;

      // Update audit record to track fallback usage
      if (lotSizingAuditRecord) {
        lotSizingAuditRecord.usedFallbackCalculation = true;
        lotSizingAuditRecord.fallbackReason = `Coordinator data unavailable: ${fallbackReason}`;
      }
    } else {
      expectedProfit = 0;
    }

    // SSOT: goal_session_trades schema compliance (20260202)
    // Fields omega8/omega9 removed from schema - data lives in alpha_decisions table
    // CCIP (2026-02-12): Use execution SL/TP overrides if provided (recalculated for actual fill)
    const finalSL = executionStopLoss ?? decision.stopLoss;
    const finalTP = executionTakeProfit ?? decision.takeProfit;
    const finalTP1 = executionTP1 !== undefined ? executionTP1 : decision.tp1Price;

    // CCIP GOVERNANCE (2026-02-16): Defensive guard — scalp trades never have TP2
    // coordinator-alpha.ts is SSOT, but executor enforces as defensive layer
    const isScalpTrade = canonicalStyle === 'SCALP';
    const finalTP2 = isScalpTrade ? null : (executionTP2 ?? decision.tp2Price);

    // Calculate total confidence penalty from all adjustments (0-100 range)
    let totalPenalty = 0;
    if (decision.confidenceAdjustments && Array.isArray(decision.confidenceAdjustments)) {
      totalPenalty = Math.round(
        decision.confidenceAdjustments.reduce((sum: number, adj: any) => sum + (adj.penalty || 0), 0) * 100
      );
      totalPenalty = Math.max(0, Math.min(100, totalPenalty));
    }

    // Build immutable mid-trade plan snapshot (SSOT for deterministic trigger evaluation)
    const tradeDirection = decision.action === 'BUY' ? 'buy' : 'sell';
    const patternIntelligence = (decision as any).patternIntelligence;
    const midTradePlan = buildMidTradePlan({
      reasoning: decision.reasoning || '',
      entryPrice,
      stopLoss: finalSL,
      takeProfit: finalTP,
      direction: tradeDirection,
      symbol: decision.symbol || '',
      marketRegime: (decision as any).market_regime || regimeBucket || null,
      patternInvalidationPrice: patternIntelligence?.invalidation_price ?? null,
      patternInvalidationReasoning: patternIntelligence?.invalidation_reasoning ?? null,
      htfPattern: patternIntelligence?.htf_pattern ?? null,
      mtfPattern: patternIntelligence?.mtf_pattern ?? null,
      ltfPattern: patternIntelligence?.ltf_pattern ?? null,
      omegaConsensus: decision.omega_summary || null,
      confidence: decision.confidence,
      expectedFillMinutes: decision.expectedFillTimeHours ? Math.round(decision.expectedFillTimeHours * 60) : null,
      scalpPattern: (decision as any).scalp_pattern ?? null,
      scalpSubMode: (decision as any).scalp_sub_mode ?? null,
      scalpMomentumPhase: (decision as any).scalp_momentum_phase ?? null,
      scalpAtrTraveled: (decision as any).scalp_atr_traveled ?? null
    });

    return {
      user_id: userId,
      goal_session_id: sessionId,
      symbol: decision.symbol,
      direction: toDirectionDB(decision.action === 'BUY' ? 'buy' : 'sell'),
      entry_price: entryPrice,
      stop_loss: finalSL,
      take_profit: finalTP,
      tp1_price: finalTP1,
      tp2_price: finalTP2,
      lot_size: lotSize,
      position_size: lotSize,
      risk_dollars: riskDollars,
      expected_profit_for_session: expectedProfit,
      status,
      order_type: status === 'open' ? 'market' : 'limit',
      opened_at: openedAt,
      current_price: status === 'open' ? entryPrice : null,
      current_pnl: 0,
      trade_confidence: decision.confidence,
      confidence_penalty: totalPenalty,
      regime_bucket: regimeBucket,
      planned_entry_price: decision.entry,
      planned_stop_loss: decision.stopLoss,
      planned_take_profit: decision.takeProfit,
      requested_style: normalizeToCanonicalStyle(rawTradeStyle),
      resolved_style: canonicalStyle,
      alpha_decision_id: alphaDecisionId ?? null,
      alpha_reasoning_snapshot: decision.reasoning || null,
      market_regime_at_entry: (decision as any).market_regime || regimeBucket || null,
      mid_trade_plan: midTradePlan
    };
  }

  /**
   * Create notification via SSOT NotificationCoordinator
   * DEPRECATED METHOD - Use notificationCoordinator.send() directly
   * CCIP FIX (2026-02-03): Refactored to use NotificationCoordinator
   */
  private async createNotification(params: {
    userId: string;
    sessionId: string;
    type: string;
    title: string;
    message: string;
    tradeId?: string;
  }): Promise<void> {
    try {
      await notificationCoordinator.send({
        userId: params.userId,
        sessionId: params.sessionId,
        type: params.type as any,
        title: params.title,
        message: params.message,
        priority: 'critical',
        tradeId: params.tradeId
      });
    } catch (error) {
      // Non-blocking
      console.warn('[AlphaTradeExecutor] Failed to create notification:', error);
    }
  }

  /**
   * Validate trade record has all required fields (Phase 1 Governance)
   */
  private validateTradeRecord(tradeData: any, mode: 'immediate' | 'pending' | 'monitored'): void {
    const requiredFields = [
      'user_id',
      'goal_session_id',
      'symbol',
      'direction',
      'entry_price',
      'lot_size',
      'current_pnl',
      'expected_profit_for_session',
      'status'
    ];

    const missingFields = requiredFields.filter(field => {
      const value = tradeData[field];
      // Allow null/undefined for optional fields, but not for required ones
      return value === null || value === undefined;
    });

    if (missingFields.length > 0) {
      throw new Error(`[AlphaTradeExecutor] Trade record missing required fields for ${mode} mode: ${missingFields.join(', ')}`);
    }

    // Type validations
    if (typeof tradeData.entry_price !== 'number' || !isFinite(tradeData.entry_price)) {
      throw new Error('[AlphaTradeExecutor] entry_price must be a valid number');
    }

    if (typeof tradeData.lot_size !== 'number' || !isFinite(tradeData.lot_size)) {
      throw new Error(
        `[AlphaTradeExecutor] lot_size must be a finite number (got: ${tradeData.lot_size}, type: ${typeof tradeData.lot_size})`
      );
    }

    // GOVERNANCE: Enforce database constraint (0.001 <= lot_size <= 1000)
    if (tradeData.lot_size < 0.001) {
      throw new Error(
        `[AlphaTradeExecutor] lot_size must be >= 0.001 (got: ${tradeData.lot_size}). ` +
        `This often indicates invalid account balance or risk calculation.`
      );
    }

    if (tradeData.lot_size > 1000) {
      throw new Error(
        `[AlphaTradeExecutor] lot_size must be <= 1000 (got: ${tradeData.lot_size}). ` +
        `This indicates corrupted risk data.`
      );
    }

    if (tradeData.lot_size <= 0) {
      throw new Error(
        `[AlphaTradeExecutor] lot_size must be positive (got: ${tradeData.lot_size})`
      );
    }

    if (typeof tradeData.current_pnl !== 'number' || !isFinite(tradeData.current_pnl)) {
      throw new Error('[AlphaTradeExecutor] current_pnl must be a valid number');
    }

    if (typeof tradeData.expected_profit_for_session !== 'number' || !isFinite(tradeData.expected_profit_for_session)) {
      throw new Error('[AlphaTradeExecutor] expected_profit_for_session must be a valid number');
    }
  }

  /**
   * Log lot sizing audit record for governance tracking
   * Enables identification of trades using fallback calculations vs coordinator calculations
   * CCIP Compliance: Governance audit trail for SSOT data flow issues
   */
  private async logLotSizingAudit(params: {
    userId: string;
    sessionId: string;
    tradeId: string;
    auditRecord?: any;
    expectedProfitValue: number;
    symbol: string;
    entryPrice: number;
    takeProfit: number;
    lotSize: number;
  }): Promise<void> {
    if (!params.auditRecord) {
      return; // No audit record to log
    }

    try {
      await supabase.from('lot_sizing_audit_log').insert({
        user_id: params.userId,
        goal_session_id: params.sessionId,
        trade_id: params.tradeId,
        session_had_target_value: params.auditRecord.sessionHadTargetValue || false,
        session_had_current_progress: params.auditRecord.sessionHadCurrentProgress || false,
        coordinator_invoked: params.auditRecord.coordinatorInvoked || false,
        coordinator_succeeded: params.auditRecord.coordinatorSucceeded || false,
        coordinator_decision_id: params.auditRecord.coordinatorDecisionId,
        used_fallback_calculation: params.auditRecord.usedFallbackCalculation || false,
        fallback_reason: params.auditRecord.fallbackReason,
        coordinator_expected_profit: params.auditRecord.coordinatorExpectedProfit,
        fallback_expected_profit: params.auditRecord.fallbackExpectedProfit,
        actual_recorded_profit: params.expectedProfitValue,
        symbol: params.symbol,
        entry_price: params.entryPrice,
        take_profit: params.takeProfit,
        lot_size: params.lotSize
      });
    } catch (error) {
      // Non-blocking - log at debug level since governance logging failures shouldn't break trades
      console.debug('[AlphaTradeExecutor] Failed to log lot sizing audit record:', {
        error: error instanceof Error ? error.message : String(error),
        tradeId: params.tradeId,
        note: 'This may indicate RLS policy issue. Check lot_sizing_audit_log table permissions.'
      });
    }
  }

  /**
   * Log CCIP change event (governance tracking)
   * CCIP Compliance (20260202): Track all database mutations for audit trail
   *
   * SSOT COMPLIANCE: Uses correct ccip_change_tracking schema
   * - operation_type: The type of change (TRADE_CREATED, PRICE_EXTRACTION_ERROR, etc)
   * - table_name: Which table was affected
   * - record_id: UUID of affected record
   * - change_details: JSONB metadata about the change
   *
   * ARCHITECTURE NOTE:
   * This is a frontend operation attempting to log to CCIP. The ccip_change_tracking table
   * has RLS policies that only allow service_role (backend) writes. The authenticated user
   * context (frontend) cannot insert into this table.
   *
   * EXPECTED BEHAVIOR:
   * Frontend CCIP logging will fail with 403 Forbidden (RLS policy). This is DEFENSIVE.
   * For true CCIP governance tracking, trade mutations should be logged by backend functions
   * that have service_role access.
   *
   * Non-blocking: CCIP logging failures never prevent trade execution, but are logged for diagnostics
   */
  private async logCCIPChange(params: {
    changeType: string;
    tableAffected: string;
    recordId: string;
    userId: string;
    metadata?: any;
  }): Promise<void> {
    try {
      // Validate all required parameters before insert
      if (!params.changeType || typeof params.changeType !== 'string') {
        console.debug('[AlphaTradeExecutor] CCIP validation skipped: Invalid operation_type', {
          value: params.changeType,
          type: typeof params.changeType
        });
        return;
      }

      if (!params.tableAffected || typeof params.tableAffected !== 'string') {
        console.debug('[AlphaTradeExecutor] CCIP validation skipped: Invalid table_name', {
          value: params.tableAffected,
          type: typeof params.tableAffected
        });
        return;
      }

      // Validate record_id is a non-empty string (UUID)
      if (!params.recordId || typeof params.recordId !== 'string' || params.recordId.trim() === '') {
        console.debug('[AlphaTradeExecutor] CCIP validation skipped: Invalid record_id', {
          value: params.recordId,
          type: typeof params.recordId,
          isEmpty: !params.recordId || params.recordId.trim() === ''
        });
        return;
      }

      // Validate user_id is a non-empty string (UUID)
      if (!params.userId || typeof params.userId !== 'string' || params.userId.trim() === '') {
        console.debug('[AlphaTradeExecutor] CCIP validation skipped: Invalid user_id', {
          value: params.userId,
          type: typeof params.userId,
          isEmpty: !params.userId || params.userId.trim() === ''
        });
        return;
      }

      // Ensure metadata is a valid object
      const changeDetails = params.metadata && typeof params.metadata === 'object' ? params.metadata : {};

      const { error } = await supabase.from('ccip_change_tracking').insert({
        operation_type: params.changeType.trim(),
        table_name: params.tableAffected.trim(),
        record_id: params.recordId.trim(),
        user_id: params.userId.trim(),
        change_details: changeDetails
      });

      if (error) {
        // Frontend CCIP logging will fail with 403 Forbidden (RLS policy blocks authenticated users).
        // This is expected and defensive - CCIP governance should be logged by backend functions only.
        // Log at debug level to reduce noise in production console.
        console.debug('[AlphaTradeExecutor] CCIP insert result (expected to fail in frontend)', {
          status: (error as any).status,
          errorMessage: error.message,
          note: 'Frontend cannot write to ccip_change_tracking due to RLS policy (service_role only). This is defensive and expected.'
        });
      }
    } catch (error) {
      // Non-blocking - CCIP tracking failure shouldn't break trade execution
      // Log at debug level since this is expected behavior (RLS blocking authenticated users)
      console.debug('[AlphaTradeExecutor] CCIP logging exception (expected in frontend context)', {
        error: error instanceof Error ? error.message : String(error),
        note: 'Frontend CCIP logging disabled by RLS policy. Use backend functions for governance tracking.'
      });
    }
  }

  /**
   * Create entry_intents record + quality advisory after trade execution
   *
   * CCIP FIX (2026-02-06): Bridges trade execution to Entry Quality Advisor UI
   * SSOT: entry_intents is the authoritative record for EntryPriceMonitor
   * GOVERNANCE: Non-blocking -- advisory creation never prevents trade execution
   *
   * Flow:
   * 1. Insert entry_intents with status='executed', advisor_mode='post_execution_advisory'
   * 2. Call record_entry_quality_advisory() RPC to calculate retrospective optimal zone
   * 3. RPC populates entry_quality_advisories table + updates entry_intents with grade
   */
  private async createPostExecutionEntryIntent(params: {
    userId: string;
    sessionId: string;
    tradeId: string;
    decision: AlphaDecision;
    entryPrice: number;
    canonicalStyle: CanonicalStyle;
  }): Promise<void> {
    const { userId, sessionId, tradeId, decision, entryPrice } = params;

    try {
      const now = new Date().toISOString();
      const direction = toLongShort(decision.action === 'BUY' ? 'buy' : 'sell');

      const VALID_THESIS = ['momentum_scalp', 'liquidity_sweep_reversal', 'trend_pullback', 'breakout_continuation', 'mean_reversion', 'failed_move', 'range_extreme'];
      const VALID_STYLE_INTENT = ['SCALP', 'MICRO_INTRADAY', 'INTRADAY'];

      const safeThesis = decision.thesis && VALID_THESIS.includes(decision.thesis) ? decision.thesis : null;
      const safeStyleIntent = decision.style_intent && VALID_STYLE_INTENT.includes(decision.style_intent) ? decision.style_intent : null;

      const classifierZoneMin = decision.entry_intent?.entry_zone_min;
      const classifierZoneMax = decision.entry_intent?.entry_zone_max;
      let advisoryZoneMin = entryPrice;
      let advisoryZoneMax = entryPrice;

      if (classifierZoneMin != null && classifierZoneMax != null) {
        const zoneHalfWidth = (classifierZoneMax - classifierZoneMin) / 2;
        advisoryZoneMin = entryPrice - zoneHalfWidth;
        advisoryZoneMax = entryPrice + zoneHalfWidth;
      }

      // CCIP 2026-02-17: Alpha's LLM entry advisory is the SOLE authority for Entry Monitor
      // EntryStructureAnalyzer is deprecated as SSOT - Alpha's intelligence drives the UI
      const alphaAdvisory = decision.entry_advisory || null;
      const isGoodEntry = !alphaAdvisory || alphaAdvisory.verdict === 'GOOD_ENTRY';
      const structuralVerdict = isGoodEntry ? 'OPTIMAL_ENTRY' : 'WAIT_FOR_PULLBACK';

      let pullbackZoneMin: number | null = null;
      let pullbackZoneMax: number | null = null;
      if (alphaAdvisory?.verdict === 'PULLBACK_EXPECTED') {
        pullbackZoneMin = alphaAdvisory.pullback_zone_min;
        pullbackZoneMax = alphaAdvisory.pullback_zone_max;
      }

      const pullbackMidpoint = (pullbackZoneMin != null && pullbackZoneMax != null)
        ? (pullbackZoneMin + pullbackZoneMax) / 2
        : null;

      logger.info(
        LogCategory.GOVERNANCE,
        '[AlphaTradeExecutor] Alpha entry advisory applied to Entry Monitor',
        {
          symbol: decision.symbol,
          verdict: structuralVerdict,
          alphaVerdict: alphaAdvisory?.verdict || 'GOOD_ENTRY (default)',
          pullbackZone: pullbackZoneMin && pullbackZoneMax ? `${pullbackZoneMin}-${pullbackZoneMax}` : 'none',
          reasoning: alphaAdvisory?.reasoning || 'Alpha assessed good entry'
        }
      );

      const entryIntentData: Record<string, any> = {
        session_id: sessionId,
        user_id: userId,
        symbol: decision.symbol,
        direction,
        intent_type: decision.entry_intent?.intent_type || 'immediate_momentum',
        urgency: decision.entry_intent?.urgency || 'HIGH',
        entry_zone_min: pullbackZoneMin ?? advisoryZoneMin,
        entry_zone_max: pullbackZoneMax ?? advisoryZoneMax,
        timeout_at: now,
        status: 'executed',
        executed_at: now,
        actual_entry_price: entryPrice,
        execution_price: entryPrice,
        advisor_mode: 'post_execution_advisory',
        alpha_reasoning: decision.reasoning,
        alpha_confidence: decision.confidence,
        market_context: this.buildAlphaAdvisoryContext(decision, entryPrice, alphaAdvisory),
        entry_mode: 'immediate',
        style: params.canonicalStyle,
        thesis: safeThesis,
        style_intent: safeStyleIntent,
        execution_preference: decision.execution_preference || 'IMMEDIATE',
        structural_verdict: structuralVerdict,
        structural_level_price: null,
        structural_level_type: null,
        structural_level_strength: null,
        structural_level_touches: null,
        pullback_target_price: pullbackMidpoint,
        pullback_improvement_pips: null
      };

      const { data: entryIntent, error: intentError } = await supabase
        .from('entry_intents')
        .insert(entryIntentData)
        .select('id')
        .single();

      if (intentError || !entryIntent?.id) {
        logger.error(
          LogCategory.GOVERNANCE,
          '[AlphaTradeExecutor] GOVERNANCE ALERT: Entry intent INSERT failed - Entry Price Monitor will not function',
          { error: intentError?.message, code: intentError?.code, details: intentError?.details, tradeId, sessionId, symbol: decision.symbol }
        );
        return;
      }

      logger.info(
        LogCategory.GOVERNANCE,
        '[AlphaTradeExecutor] Entry intent created for quality advisory',
        { intentId: entryIntent.id, tradeId, symbol: decision.symbol }
      );

      const { error: rpcError } = await supabase.rpc('record_entry_quality_advisory', {
        p_user_id: userId,
        p_entry_intent_id: entryIntent.id,
        p_trade_id: tradeId,
        p_session_id: sessionId
      });

      if (rpcError) {
        logger.warn(
          LogCategory.GOVERNANCE,
          '[AlphaTradeExecutor] Entry quality advisory RPC failed (non-blocking)',
          { error: rpcError.message, intentId: entryIntent.id, tradeId }
        );
      }
    } catch (err) {
      logger.error(
        LogCategory.GOVERNANCE,
        '[AlphaTradeExecutor] GOVERNANCE ALERT: Post-execution entry intent pipeline threw exception',
        { error: err instanceof Error ? err.message : String(err), tradeId, sessionId }
      );
    }
  }

  private buildAlphaAdvisoryContext(
    decision: AlphaDecision,
    entryPrice: number,
    alphaAdvisory?: { verdict: string; pullback_zone_min: number | null; pullback_zone_max: number | null; reasoning: string } | null
  ): Record<string, any> {
    const slDistance = Math.abs(entryPrice - decision.stopLoss);
    const regime = decision.regime_advisory;

    let volatility: string = 'medium';
    if (regime) {
      if (regime.volatility_score > 70 || regime.atr_expansion) {
        volatility = 'high';
      } else if (regime.volatility_score < 30 || regime.atr_compression) {
        volatility = 'low';
      }
    }

    const context: Record<string, any> = {
      atr_value: slDistance > 0 ? slDistance : undefined,
      volatility,
      structure: regime?.structure,
      market_bias: regime?.market_bias,
      is_high_risk_regime: regime?.is_high_risk_regime ?? false,
      confidence: decision.confidence,
      style: decision.resolvedStyle,
      alpha_entry_advisory: {
        verdict: alphaAdvisory?.verdict || 'GOOD_ENTRY',
        pullback_zone_min: alphaAdvisory?.pullback_zone_min || null,
        pullback_zone_max: alphaAdvisory?.pullback_zone_max || null,
        reasoning: alphaAdvisory?.reasoning || 'Alpha assessed this as a good entry point'
      }
    };

    return context;
  }

  /**
   * SSOT SESSION NORMALIZATION (2026-02-09)
   *
   * Supabase JS client returns PostgreSQL `numeric` columns as JavaScript strings
   * to avoid floating-point precision loss. This means:
   *   Number.isFinite("324") === false  (no type coercion)
   *   Number.isFinite(324)   === true
   *
   * This single normalization point parses ALL numeric session fields once.
   * All downstream code in the executor uses the normalized values.
   *
   * Defensive recovery: If session.id is falsy (e.g., stripped during serialization),
   * falls back to the sessionId parameter passed from the caller.
   */
  private normalizeSessionData(
    session: any,
    sessionId: string,
    userId: string
  ): { valid: boolean; data?: NormalizedSessionData; error?: string; blockReason?: string } {
    if (!session) {
      logger.error(
        LogCategory.RISK_MANAGEMENT,
        '[AlphaTradeExecutor] Session object is null/undefined',
        { userId, sessionId, sessionType: typeof session }
      );
      return {
        valid: false,
        error: 'Session record is null or undefined',
        blockReason: 'HARD-BLOCK: No session data provided to executor'
      };
    }

    const resolvedSessionId = session.id || sessionId;
    if (!resolvedSessionId) {
      logger.error(
        LogCategory.RISK_MANAGEMENT,
        '[AlphaTradeExecutor] No valid session ID available',
        { userId, sessionId, sessionObjectId: session.id }
      );
      return {
        valid: false,
        error: 'No valid session ID could be resolved',
        blockReason: 'HARD-BLOCK: Session identification failed'
      };
    }

    const targetValue = parseFloat(String(session.target_value ?? ''));
    const startingBalance = parseFloat(String(session.starting_balance ?? ''));
    const dollarRisk = parseFloat(String(session.dollar_risk ?? '0'));
    const currentProgress = parseFloat(String(session.current_progress ?? '0'));

    if (!Number.isFinite(targetValue) || targetValue <= 0) {
      logger.error(
        LogCategory.RISK_MANAGEMENT,
        '[AlphaTradeExecutor] Session target_value invalid after parsing',
        {
          userId,
          sessionId: resolvedSessionId,
          raw: session.target_value,
          parsed: targetValue,
          rawType: typeof session.target_value
        }
      );
      return {
        valid: false,
        error: `Session target_value is invalid: raw="${session.target_value}", parsed=${targetValue}`,
        blockReason: 'HARD-BLOCK: Goal target value is missing or invalid'
      };
    }

    if (!Number.isFinite(startingBalance) || startingBalance <= 0) {
      logger.error(
        LogCategory.RISK_MANAGEMENT,
        '[AlphaTradeExecutor] Session starting_balance invalid after parsing',
        {
          userId,
          sessionId: resolvedSessionId,
          raw: session.starting_balance,
          parsed: startingBalance,
          rawType: typeof session.starting_balance
        }
      );
      return {
        valid: false,
        error: `Session starting_balance is invalid: raw="${session.starting_balance}", parsed=${startingBalance}`,
        blockReason: 'HARD-BLOCK: Starting balance is missing or invalid'
      };
    }

    const safeDollarRisk = Number.isFinite(dollarRisk) ? dollarRisk : 0;
    const safeCurrentProgress = Number.isFinite(currentProgress) ? currentProgress : 0;

    logger.info(
      LogCategory.RISK_MANAGEMENT,
      '[AlphaTradeExecutor] Session data normalized successfully',
      {
        userId,
        sessionId: resolvedSessionId,
        targetValue,
        startingBalance,
        dollarRisk: safeDollarRisk,
        currentProgress: safeCurrentProgress,
        rawTypes: {
          target_value: typeof session.target_value,
          starting_balance: typeof session.starting_balance,
          dollar_risk: typeof session.dollar_risk,
          current_progress: typeof session.current_progress
        }
      }
    );

    return {
      valid: true,
      data: {
        sessionId: resolvedSessionId,
        targetValue,
        startingBalance,
        dollarRisk: safeDollarRisk,
        currentProgress: safeCurrentProgress,
        raw: session
      }
    };
  }

  /**
   * Calculate slippage for symbol
   */
  private calculateSlippage(symbol: string): number {
    // Symbol-specific slippage
    if (symbol.includes('JPY')) return 0.005; // 0.5 pips
    if (symbol.startsWith('US') || symbol.startsWith('NAS') || symbol.startsWith('SPX')) return 0.3; // 3 points for indices
    if (symbol === 'XAUUSD') return 0.05; // 5 cents
    return 0.00005; // 0.5 pips for standard forex
  }
}

export const alphaTradeExecutor = new AlphaTradeExecutor();
