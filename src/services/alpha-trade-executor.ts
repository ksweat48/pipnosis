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
 * 1.  Core Validation (Omega + Geometry + Freshness)
 * 2.  Trade Capacity (Confidence + Slots + Duplicates)
 * 3.  Risk Authority (Context + PCVL + Margin + Kelly)
 * 4.  Price Validation (Slippage + Staleness)
 * 5.  Mandatory Safety Validator (TIER 3 FIX - ONLY allowed blocker)
 * 6.  Database Boundary (Type coercion + Range check)
 *
 * CCIP-2026-03-18: Style Qualification Gate removed from pipeline.
 * Alpha is the sole authority on trade viability including volatility suitability.
 * ATR context is delivered in Alpha's briefing via the feasibility resolver.
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
import { getSymbolConfig } from '../config/symbol-registry';
import { logger, LogCategory } from '../lib/logger';
import { calculateDollarPerPip, calculatePipDistance, getCurrencyPipInfo } from '../utils/currencyHelpers';
import { mandatorySafetyValidator } from './mandatory-safety-validator';
import { creditValidationService } from './credit-validation-service';
import { EntryOverextensionValidator } from './entry-overextension-validator';
import { normalizeStyle } from '../utils/entry-overextension-calculator';
// CCIP-2026-03-18: style-qualification-gate removed — Alpha is sole authority on trade viability.
// ATR suitability context is delivered directly in Alpha's briefing via the feasibility resolver.
// entryStructureAnalyzer removed (CCIP 2026-02-17): Alpha's LLM entry advisory is sole authority
// marketSnapshotCache removed (CCIP 2026-02-17): No longer needed for entry advisory
import type { AlphaDecision } from '../brains/coordinator-alpha';
import type { TradeContext } from '../types/trade-context';
import { buildMidTradePlan } from './mid-trade-plan-engine';
import { buildAlphaWatchContract } from '../brains/alpha-midtrade-analyst';
import { recentTradeContext } from './recent-trade-context';
import { resolveCanonicalStyle, type CanonicalTradeStyle } from '../config/timeframe-hierarchy';
import { llmReasoningLogger } from './llm-reasoning-logger';

export type ExecutionMode = 'IMMEDIATE' | 'PENDING' | 'MONITORED';

type CanonicalStyle = CanonicalTradeStyle;

function normalizeToCanonicalStyle(input: string): CanonicalStyle {
  return resolveCanonicalStyle(input, 'SCALP');
}

/**
 * CCIP-2026-0321: Journal Narrative Builder
 *
 * SSOT for converting Alpha's structured answer_sheet into human-readable journal text.
 * Called exclusively from createImmediate() at trade open time so the ai_trade_journal
 * entry is created with real context rather than fallback placeholders.
 *
 * Responsibility: alpha-trade-executor.ts (single call site)
 * Governance: SSOT — no other path should call this function.
 */
function buildMarketReadFromDecision(decision: AlphaDecision): string {
  const as = decision.answer_sheet;

  if (!as) {
    const narrative = typeof decision.reasoning === 'string'
      ? decision.reasoning
      : (decision.reasoning && typeof (decision.reasoning as any).thesis_why === 'string'
          ? (decision.reasoning as any).thesis_why
          : null);
    return narrative || `${decision.action} ${decision.symbol} — trend and structure aligned.`;
  }

  const parts: string[] = [];

  if (as.Q1_trend_alignment) parts.push(`Trend: ${as.Q1_trend_alignment}`);
  if (as.Q2_structure_level) parts.push(`Structure: ${as.Q2_structure_level}`);
  if (as.Q4_momentum_stage) parts.push(`Momentum: ${as.Q4_momentum_stage}`);
  if (as.Q6_entry_trigger) parts.push(`Entry trigger: ${as.Q6_entry_trigger}`);

  const confluenceText = as.Q7_confluence_judgment || as.Q7_confluence_confirmed || as.Q7_confluence_count;
  if (confluenceText) parts.push(`Confluence: ${confluenceText}`);

  if (as.Q8C_price_location_zone) parts.push(`Price zone: ${as.Q8C_price_location_zone}`);
  if (as.Q8D_weekly_narrative) parts.push(`Weekly context: ${as.Q8D_weekly_narrative}`);
  if (as.kill_zone && as.kill_zone !== 'NONE') parts.push(`Kill zone: ${as.kill_zone}`);
  if (as.intermarket_correlation && as.intermarket_correlation !== 'UNKNOWN') {
    parts.push(`Intermarket: ${as.intermarket_correlation}`);
  }

  return parts.length > 0 ? parts.join('. ') + '.' : `${decision.action} ${decision.symbol} — market conditions favourable at entry.`;
}

function buildExpectedOutcomeFromDecision(
  decision: AlphaDecision,
  entryPrice: number,
  stopLoss: number,
  takeProfit: number,
  symbol: string
): string {
  const pipInfo = symbol?.includes('JPY') ? { pipSize: 0.01, precision: 3 }
    : symbol?.toLowerCase().includes('xau') || symbol?.toLowerCase().includes('gold') ? { pipSize: 0.1, precision: 2 }
    : symbol?.toLowerCase().includes('xag') || symbol?.toLowerCase().includes('silver') ? { pipSize: 0.01, precision: 3 }
    : { pipSize: 0.0001, precision: 5 };

  const slPips = stopLoss > 0 && entryPrice > 0
    ? Math.round(Math.abs(entryPrice - stopLoss) / pipInfo.pipSize)
    : 0;
  const tpPips = takeProfit > 0 && entryPrice > 0
    ? Math.round(Math.abs(takeProfit - entryPrice) / pipInfo.pipSize)
    : 0;
  const rr = slPips > 0 ? (tpPips / slPips).toFixed(1) : 'N/A';

  const tp1 = decision.tp1Price;
  const tp2 = decision.tp2Price ?? takeProfit;

  let plan = `Entry: ${entryPrice.toFixed(pipInfo.precision)} | SL: ${stopLoss.toFixed(pipInfo.precision)} (${slPips} pips risk)`;

  if (tp1 && tp2 && tp1 !== tp2) {
    const tp1Pips = Math.round(Math.abs(tp1 - entryPrice) / pipInfo.pipSize);
    const tp2Pips = Math.round(Math.abs(tp2 - entryPrice) / pipInfo.pipSize);
    plan += ` | TP1: ${tp1.toFixed(pipInfo.precision)} (${tp1Pips}p) → TP2: ${tp2.toFixed(pipInfo.precision)} (${tp2Pips}p) | R:R ${rr}:1`;
  } else if (takeProfit > 0) {
    plan += ` | TP: ${takeProfit.toFixed(pipInfo.precision)} (${tpPips} pips) | R:R ${rr}:1`;
  }

  const as = decision.answer_sheet;
  if (as?.Q5B_objective_alignment) plan += `. Objective: ${as.Q5B_objective_alignment}`;
  if (as?.Q5_failure_mode && as.Q5_failure_mode !== 'NONE') {
    plan += `. Invalidated if: ${as.Q5_failure_mode}`;
  }

  return plan;
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
  riskPercentage: number | null; // SSOT: SL risk tolerance %, e.g. 5.0 = risk 5% of balance at SL
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
      sessionData.raw,
      decision.action === 'BUY' ? 'buy' : 'sell',
      inputs.regimeSnapshot
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

    // SSOT: Use session.risk_percentage as the authoritative SL risk tolerance %.
    // This is the % of balance the user is willing to LOSE at the stop loss.
    // It was stored once at session creation and never drifts with live balance.
    // Lot sizing formula: lot = (balance × riskPct%) / (sl_pips × $/pip_per_lot)
    let baseRiskPercent: number | undefined = undefined;
    if (sessionData.riskPercentage !== null && sessionData.riskPercentage > 0) {
      baseRiskPercent = sessionData.riskPercentage / 100;
      logger.info(
        LogCategory.RISK_MANAGEMENT,
        '[AlphaTradeExecutor] RISK-FIRST: Using session.risk_percentage as SL risk tolerance',
        {
          userId,
          sessionId,
          riskPercentage: sessionData.riskPercentage,
          riskDollars: (sessionData.riskPercentage / 100 * currentBalance).toFixed(2),
          accountBalance: currentBalance,
          source: 'session.risk_percentage (SSOT — set at session creation)'
        }
      );
    } else if (sessionData.dollarRisk > 0) {
      // Legacy fallback: session predates risk_percentage column (sessions before 2026-02-25)
      baseRiskPercent = sessionData.dollarRisk / currentBalance;
      logger.warn(
        LogCategory.RISK_MANAGEMENT,
        '[AlphaTradeExecutor] LEGACY FALLBACK: risk_percentage not found, deriving from dollar_risk/balance',
        {
          userId,
          sessionId,
          dollarRisk: sessionData.dollarRisk,
          accountBalance: currentBalance,
          derivedRiskPercent: (baseRiskPercent * 100).toFixed(2) + '%',
          note: 'Session predates risk_percentage column. Re-run session to get correct sizing.'
        }
      );
    } else {
      logger.info(
        LogCategory.RISK_MANAGEMENT,
        '[AlphaTradeExecutor] No risk_percentage or dollar_risk found, using default from UnifiedRiskAuthority',
        { userId, sessionId }
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

    // SSOT: Recalculate riskDollars from finalLotSize so the stored value always
    // matches the actual exposure. The URA progressive-risk-scaling path may reduce
    // riskDollars while the goal-aware coordinator independently overrides lotSize,
    // leaving the two values inconsistent. The lot size is the ground truth — derive
    // riskDollars from it here, after all lot-size decisions are complete.
    //
    // CCIP-FIX (risk_dollars double-count):
    // calculateDollarPerPip(symbol, lotSize) already returns (lotSize × dollarPerPipPerLot),
    // i.e. the full dollar-per-pip for the entire position. Multiplying by finalLotSize again
    // would apply lot size twice: lotSize² × slPips × dollarPerPipPerLot.
    // Correct formula: slPips × calculateDollarPerPip(symbol, finalLotSize).
    // SSOT authority: currencyHelpers.calculateDollarPerPip (sole pip-value calculator).
    const slPips = calculatePipDistance(decision.symbol, decision.entry, decision.stopLoss);
    const pipInfoForRisk = calculateDollarPerPip(decision.symbol, finalLotSize);
    const recalculatedRiskDollars = slPips > 0 && pipInfoForRisk > 0
      ? slPips * pipInfoForRisk
      : (riskAssessment.trueRiskDollars || riskAssessment.adjustedRiskDollars);
    const finalRiskDollars = Number.isFinite(recalculatedRiskDollars) && recalculatedRiskDollars > 0
      ? recalculatedRiskDollars
      : (riskAssessment.trueRiskDollars || riskAssessment.adjustedRiskDollars);

    // LAYER 6: ENTRY OVEREXTENSION ADVISORY (CCIP-2026-0328A-SOVEREIGNTY)
    //
    // GOVERNANCE: Hard block removed per Alpha Sovereignty Completion.
    // Entry overextension is a trading judgment — Alpha priced the entry location
    // into his reasoning. Code must not binary-cancel based on distance from an
    // optimal zone computed post-hoc by the executor.
    //
    // The overextension validator is retained for AUDIT LOGGING ONLY.
    // No execution path may return blocked:true based on overextension.
    // Alpha's SL/TP deviation adjustment (applied elsewhere) already preserves
    // risk geometry for any price deviation — binary cancellation is redundant.
    //
    // SSOT: alpha-identity.ts LEGITIMATE_BLOCK_CONDITIONS is the exhaustive list
    // of valid block conditions. Entry overextension is not on that list.

    // Get trade style for audit logging (SSOT normalizeStyle)
    const tradeStyle = normalizeStyle(sessionData.raw.trade_style);

    // Calculate optimal zone for audit log context only (no execution gating)
    let optimalZoneMin: number;
    let optimalZoneMax: number;

    if (tradeContext.atr && tradeContext.atr.value) {
      const atrBuffer = tradeContext.atr.value * 0.3;
      optimalZoneMin = decision.entry - atrBuffer;
      optimalZoneMax = decision.entry + atrBuffer;
    } else {
      const percentBuffer = decision.symbol.includes('USD') || decision.symbol.includes('EUR') || decision.symbol.includes('GBP') || decision.symbol.includes('JPY')
        ? 0.0015
        : 0.0025;
      optimalZoneMin = decision.entry * (1 - percentBuffer);
      optimalZoneMax = decision.entry * (1 + percentBuffer);
    }

    const overextensionValidation = EntryOverextensionValidator.validateEntry({
      symbol: decision.symbol,
      direction: decision.action === 'BUY' ? 'buy' : 'sell',
      currentPrice: decision.entry,
      optimalZoneMin,
      optimalZoneMax,
      style: tradeStyle,
      alphaConfidence: decision.confidence,
      omegaConsensusCount: decision.omegaConsensusCount
    });

    // Log for governance audit trail — never blocks execution
    const overextensionEventId = await EntryOverextensionValidator.logOverextensionEvent(
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

    if (!overextensionValidation.isValid) {
      logger.warn(
        LogCategory.RISK_MANAGEMENT,
        '[AlphaTradeExecutor] Entry overextension advisory — proceeding per Alpha sovereignty',
        {
          userId,
          sessionId,
          symbol: decision.symbol,
          style: tradeStyle,
          overextensionType: overextensionValidation.overextensionType,
          overextensionPct: overextensionValidation.overextensionPercentage.toFixed(1),
          threshold: overextensionValidation.maxAllowedOverextension,
          overextensionEventId
        }
      );
    }

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
        confidence: decision.confidence
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
        riskDollars: finalRiskDollars,
        riskWarnings: riskWarningsWithGoalContext,
        inputs,
        lotSizingDecisionId: lotSizingDecision?.auditRecordId,
        expectedProfitAtTP: lotSizingDecision?.expectedProfitAtTP,
        impliedRRRatio: lotSizingDecision?.impliedRR,
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
        riskDollars: finalRiskDollars,
        riskWarnings: riskWarningsWithGoalContext,
        inputs,
        lotSizingDecisionId: lotSizingDecision?.auditRecordId,
        expectedProfitAtTP: lotSizingDecision?.expectedProfitAtTP,
        impliedRRRatio: lotSizingDecision?.impliedRR,
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
        riskDollars: finalRiskDollars,
        lotSizingDecisionId: lotSizingDecision?.auditRecordId,
        overextensionEventId,
        canonicalStyle,
        rawTradeStyle
      });
    }
  }

  /**
   * Check trade capacity (confidence floor, slots, duplicates)
   *
   * CCIP-2026-0328A-SOVEREIGNTY: Session-level min_confidence gate removed.
   * The only hard confidence gate is the 50% structural floor defined in
   * ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE. Session config may not impose
   * a higher threshold — that is a trading judgment that belongs to Alpha.
   * Alpha receives his calibration advisory in the briefing and self-calibrates.
   *
   * Re-entry bias block: Documented in prior CCIP but intentionally not implemented.
   * Alpha has full authority to re-enter a symbol — the re-entry judgment is his.
   *
   * Max concurrent trades: Retained — this is an account management constraint
   * set explicitly by the user's risk mode preference, not a trading judgment.
   */
  private async checkTradeCapacity(
    symbol: string,
    confidence: number,
    sessionId: string,
    session: any,
    direction: 'buy' | 'sell',
    currentRegimeSnapshot?: any
  ): Promise<{ valid: boolean; reason?: string }> {
    // Hard confidence floor — the only confidence gate (SSOT: alpha-identity.ts)
    // A trade below 50 has less than coin-flip structural edge. This is physics, not judgment.
    if (confidence < 50) {
      return { valid: false, reason: 'Confidence too low (< 50%)' };
    }

    // Trade slots check
    // SSOT: max_concurrent_trades column is authoritative (set at session creation).
    // Falls back to risk_mode inference only for legacy sessions missing the column.
    // This is a user-set account management preference, not a trading judgment gate.
    const { data: openTrades } = await supabase
      .from('goal_session_trades')
      .select('*')
      .eq('goal_session_id', sessionId)
      .in('status', ['open', 'pending']);

    const maxConcurrentTrades: number =
      session.max_concurrent_trades ??
      (session.risk_mode === 'low' ? 1 : session.risk_mode === 'high' ? 3 : 2);

    if (openTrades && openTrades.length >= maxConcurrentTrades) {
      return {
        valid: false,
        reason: `Maximum concurrent trades (${maxConcurrentTrades}) reached for this session`
      };
    }

    // Duplicate symbol check — per user session (goal_session_id is already user-scoped).
    // Blocks same symbol regardless of direction: a user may not hold a BUY and a SELL
    // on the same symbol concurrently in one session, and may not duplicate the same direction.
    // Different users in their own sessions are unaffected — this is intentionally session-scoped.
    // CCIP-2026-0328-GOV: direction parity does not matter — any open position on the symbol
    // for this user's session constitutes a duplicate and is blocked.
    const existingSymbolTrade = openTrades?.find(trade => trade.symbol === symbol);
    if (existingSymbolTrade) {
      const existingDirection = existingSymbolTrade.direction ?? existingSymbolTrade.action;
      const conflictType = existingDirection === direction ? 'duplicate direction' : 'opposite direction';
      return {
        valid: false,
        reason: `Already have an open/pending ${existingDirection?.toUpperCase()} position on ${symbol} (${conflictType} conflict)`
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
    impliedRRRatio?: number;
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

    // CCIP-ALPHA-GOV-LEVELS: Alpha's SL and TP are structural levels set by Alpha's professional judgment.
    // They are executed exactly as issued. Fill price differences do not shift these levels.
    // Alpha places SL behind specific structural features (swing highs/lows, FVGs, key levels)
    // and TP at specific target zones — shifting those levels breaks the structural validity
    // of the trade regardless of whether R:R is numerically preserved.
    //
    // Audit-only: log the fill deviation for observability but do not act on it.
    const plannedEntry = decision.entry;
    const entryDeviation = adjustedEntry - plannedEntry;

    if (Number.isFinite(entryDeviation) && Math.abs(entryDeviation) > 1e-8) {
      const pipInfo = getCurrencyPipInfo(decision.symbol);
      const reasoningPipSize = pipInfo.pipValue;
      const deviationReasoningPips = Math.abs(entryDeviation) / reasoningPipSize;
      const styleUpper = (params.canonicalStyle || 'INTRADAY').toUpperCase();

      await supabase.from('entry_price_deviation_events').insert({
        user_id: userId,
        session_id: sessionId,
        symbol: decision.symbol,
        alpha_style: styleUpper,
        direction: decision.action as 'BUY' | 'SELL',
        planned_entry: plannedEntry,
        actual_entry: adjustedEntry,
        deviation_pips: Math.round(deviationReasoningPips * 10) / 10,
        max_allowed_pips: null,
        alpha_max_deviation_pips: decision.max_entry_deviation_pips ?? null,
        action_taken: 'AUDIT_ONLY',
        planned_sl: decision.stopLoss,
        planned_tp: decision.takeProfit,
        execution_sl: decision.stopLoss,
        execution_tp: decision.takeProfit,
      });

      logger.info(
        LogCategory.TRADE_EXECUTION,
        '[AlphaTradeExecutor] Fill deviation observed — Alpha levels unchanged (structural integrity preserved)',
        {
          symbol: decision.symbol,
          plannedEntry,
          actualEntry: adjustedEntry,
          deviationReasoningPips: Math.round(deviationReasoningPips * 10) / 10,
          sl: decision.stopLoss,
          tp: decision.takeProfit,
          ccip: 'CCIP-ALPHA-GOV-LEVELS — Alpha levels stand as issued'
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
        impliedRRRatio: params.impliedRRRatio,
        lotSizingAuditRecord: params.lotSizingAuditRecord,
        executionStopLoss: undefined,
        executionTakeProfit: undefined,
        executionTP1: undefined,
        executionTP2: undefined,
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
    // CCIP-ALPHA-GOV-LEVELS: Alpha's SL/TP stand as issued — no fill-price scaling applied
    const safetyValidation = await mandatorySafetyValidator.validate(
      userId,
      sessionId,
      decision.symbol,
      decision.action as 'BUY' | 'SELL',
      adjustedEntry,
      decision.stopLoss,
      decision.takeProfit,
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

    // CCIP-2026-0321: Create ai_trade_journal entry at open time.
    // SSOT: alpha-trade-executor.ts is the SINGLE authority for Alpha-executed trade journal
    // creation. Previously no journal entry was created here, so post-trade-analyzer.ts
    // produced retroactive fallback placeholders ("Entry conditions were not captured at
    // open time." / "Target levels not recorded.") because Alpha's full decision context
    // (answer_sheet, reasoning, omega9) is only available at this moment.
    // Non-blocking: journal failure must never prevent trade execution from succeeding.
    try {
      const omega9 = decision.omega9_validation;
      const finalSLForJournal = trade.stop_loss ?? decision.stopLoss;
      const finalTPForJournal = trade.take_profit ?? decision.takeProfit;

      await llmReasoningLogger.logTradeEntry({
        userId,
        tradeId: trade.id,
        sessionId,
        symbol: decision.symbol || '',
        direction: decision.action === 'BUY' ? 'buy' : 'sell',
        entryTime: new Date(),
        entryPrice: adjustedEntry,
        stopLoss: finalSLForJournal,
        takeProfit: finalTPForJournal,
        llmReasoning: typeof decision.reasoning === 'string'
          ? decision.reasoning
          : (decision.reasoning && typeof (decision.reasoning as any).thesis_why === 'string'
              ? (decision.reasoning as any).thesis_why
              : JSON.stringify(decision.reasoning) || ''),
        marketRead: buildMarketReadFromDecision(decision),
        expectedOutcome: buildExpectedOutcomeFromDecision(
          decision,
          adjustedEntry,
          finalSLForJournal,
          finalTPForJournal,
          decision.symbol || ''
        ),
        patternIdentified: decision.thesis || 'AI Trade',
        convictionLevel: decision.confidence,
        rankAtTime: 'System',
        omega8_liquidity_bias: decision.omega8_liquidity_bias || undefined,
        omega8_reasoning: (decision as any).omega8_reasoning || undefined,
        omega8_patterns: (decision as any).omega8_patterns || undefined,
        omega9_pass: omega9?.pass ?? true,
        omega9_flags: omega9?.flags || [],
        omega9_confidence_adjustment: omega9?.confidence_adjustment ?? 0,
        omega9_corrections: omega9?.corrections || null,
        omega9_reasoning: omega9?.reasoning || undefined,
      });
    } catch (journalErr) {
      logger.warn(
        LogCategory.GOVERNANCE,
        '[AlphaTradeExecutor] CCIP-2026-0321: Journal entry creation failed (non-blocking)',
        { error: journalErr, tradeId: trade.id, userId }
      );
    }

    return {
      success: true,
      tradeId: trade.id,
      message: `Trade opened: ${decision.action} ${lotSize.toFixed(2)} lots at ${adjustedEntry.toFixed(5)}`
    };
  }

  /**
   * Create pending trade (awaiting user confirmation of a trade already at the correct price).
   *
   * SSOT: Uses priceCoordinator.extractExecutionPrice() if decision.entry is null
   * CCIP COMPLIANCE (2026-02-02): Fetch live price and extract direction-specific component
   * GOAL-AWARE: Uses expectedProfitAtTP from lot sizing coordinator (SSOT fix 2026-02-03)
   *
   * CCIP-2026-0319B GOVERNANCE GUARD:
   * createPending must NEVER be reached for wait-intent decisions (wait_pullback /
   * push_confirmation). Those paths are blocked at coordinator-alpha.ts before the decision
   * leaves the coordinator. If a wait-intent somehow reaches this method it means the
   * upstream SSOT gate was bypassed — this is a critical governance failure that must
   * fail loudly rather than silently create an unmonitored entry intent.
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
    impliedRRRatio?: number;
    lotSizingAuditRecord?: any;
    overextensionEventId?: string | null;
    canonicalStyle: CanonicalStyle;
    rawTradeStyle: string;
  }): Promise<TradeExecutionResult> {
    const { decision, userId, sessionId, lotSize, riskDollars, inputs } = params;

    // CCIP-2026-0319B: Guard against wait-intent leakage into createPending.
    // coordinator-alpha.ts is the SSOT gate — wait-modes with monitor off become NO_TRADE there.
    // resolveExecutionMode() routes wait-modes to MONITORED (createMonitored), never here.
    // If a wait-intent reaches createPending it is a governance architecture violation.
    if (decision.entry_mode === 'wait_pullback' || decision.entry_mode === 'push_confirmation') {
      logger.error(
        LogCategory.RISK_MANAGEMENT,
        '[AlphaTradeExecutor] GOVERNANCE VIOLATION: wait-intent decision reached createPending. ' +
        'This should never happen — coordinator-alpha.ts should have blocked this. ' +
        'Rejecting trade to prevent an unmonitored orphaned entry intent. CCIP-2026-0319B.',
        { userId, sessionId, entryMode: decision.entry_mode, symbol: decision.symbol }
      );
      await this.logCCIPChange({
        changeType: 'WAIT_INTENT_REACHED_CREATE_PENDING',
        tableAffected: 'goal_session_trades',
        recordId: userId,
        userId,
        sessionId,
        metadata: {
          entryMode: decision.entry_mode,
          symbol: decision.symbol,
          action: decision.action,
          violation: 'CCIP-2026-0319B: wait-intent must be blocked at coordinator-alpha or routed to createMonitored'
        }
      });
      return {
        success: false,
        error: 'GOVERNANCE_VIOLATION: Wait-intent entry reached createPending — entry monitor gate failure. Review CCIP-2026-0319B.'
      };
    }

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
        impliedRRRatio: params.impliedRRRatio,
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

    // CCIP FIX (2026-02-27): Pass full trade metadata so push notification body
    // is populated with real values instead of 'Unknown'. The notificationCoordinator
    // stores this under goal_notifications.metadata, and App.tsx reads it directly.
    await this.createNotification({
      userId,
      sessionId,
      type: 'signal',
      title: `Trade Signal: ${decision.symbol}`,
      message: `${decision.action} ${lotSize.toFixed(2)} lots at ${entryPrice.toFixed(5)} | SL: ${decision.stopLoss.toFixed(5)} | TP: ${decision.takeProfit.toFixed(5)}`,
      tradeId: trade.id,
      metadata: {
        symbol: decision.symbol,
        direction: decision.action.toLowerCase(),
        action: decision.action,
        confidence: decision.confidence,
        setupType: decision.setupType,
        entryPrice,
        stopLoss: decision.stopLoss,
        takeProfit: decision.takeProfit,
        tp1: decision.tp1Price,
        tp2: decision.tp2Price,
        tp1Confidence: decision.tp1Confidence,
        lotSize,
        sessionId,
      }
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

    // CCIP-2026-0318A: Use Alpha's estimated wait time as primary timeout source.
    // Alpha states expected_wait_minutes inside wait_condition when it defers entry.
    // Cap at 120 minutes to prevent runaway intents. Fall back to entry_intent or 60 min default.
    // CCIP-2026-0404B: Global minimum floor of 30 minutes applied AFTER all fallbacks.
    // This prevents near-zero timeouts caused by missing wait_condition or corrupt entry_intent values.
    const alphaExpectedWait = decision.wait_condition?.expected_wait_minutes;
    const rawTimeoutMinutes = alphaExpectedWait != null
      ? Math.min(Math.max(alphaExpectedWait, 5), 120)
      : (decision.entry_intent?.timeout_minutes || 60);

    // Hard floor: no monitored intent may expire in less than 30 minutes regardless of source.
    const MINIMUM_MONITOR_TIMEOUT_MINUTES = 30;
    if (rawTimeoutMinutes < MINIMUM_MONITOR_TIMEOUT_MINUTES) {
      logger.warn(
        LogCategory.GOVERNANCE,
        `[AlphaTradeExecutor] CCIP-2026-0404B: Timeout too short (${rawTimeoutMinutes} min) — overriding to ${MINIMUM_MONITOR_TIMEOUT_MINUTES} min floor. ` +
        'Likely caused by missing wait_condition.expected_wait_minutes and corrupt entry_intent.timeout_minutes.',
        { symbol: decision.symbol, rawTimeoutMinutes, alphaExpectedWait, entryIntentTimeout: decision.entry_intent?.timeout_minutes }
      );
    }
    const timeoutMinutes = Math.max(rawTimeoutMinutes, MINIMUM_MONITOR_TIMEOUT_MINUTES);

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
        alphaEntryMode: decision.entry_mode || 'MISSING',
        runawayPolicy: decision.entry_spec?.runawayPolicy ?? 'RESCAN',
        verdict: monitorVerdict,
        alphaVerdict: monitorAdvisory?.verdict || 'GOOD_ENTRY (default)',
        pullbackZone: monitorPullbackMin && monitorPullbackMax ? `${monitorPullbackMin}-${monitorPullbackMax}` : 'none'
      }
    );

    const isPushConfirmMode = decision.entry_mode === 'push_confirmation';
    const resolvedIntentMode: 'pullback_to_zone' | 'push_confirmation_zone' = isPushConfirmMode
      ? 'push_confirmation_zone'
      : 'pullback_to_zone';

    // CCIP-2026-0319B: Alpha SL/TP Authority Guard — SSOT enforcement
    // Alpha is the sole authority for stopLoss and takeProfit. No other system
    // may fabricate, derive, or substitute these values.
    // If Alpha failed to provide them, we fail loudly — no silent fallback.
    if (!Number.isFinite(decision.stopLoss) || decision.stopLoss <= 0) {
      logger.error(
        LogCategory.GOVERNANCE,
        '[AlphaTradeExecutor] ALPHA_AUTHORITY_VIOLATION: stopLoss is missing or invalid — monitored intent BLOCKED. ' +
        'Alpha must always provide stopLoss. No fallback is permitted. CCIP-2026-0319B.',
        { symbol: decision.symbol, stopLoss: decision.stopLoss, action: decision.action }
      );
      return {
        success: false,
        error: 'ALPHA_AUTHORITY_VIOLATION: Alpha did not provide a valid stopLoss. Trade blocked by SSOT enforcement.'
      };
    }

    const resolvedTakeProfit = decision.tp2Price ?? decision.takeProfit;
    if (!Number.isFinite(resolvedTakeProfit) || resolvedTakeProfit <= 0) {
      logger.error(
        LogCategory.GOVERNANCE,
        '[AlphaTradeExecutor] ALPHA_AUTHORITY_VIOLATION: takeProfit is missing or invalid — monitored intent BLOCKED. ' +
        'Alpha must always provide takeProfit. No fallback is permitted. CCIP-2026-0319B.',
        { symbol: decision.symbol, takeProfit: decision.takeProfit, tp2Price: decision.tp2Price, action: decision.action }
      );
      return {
        success: false,
        error: 'ALPHA_AUTHORITY_VIOLATION: Alpha did not provide a valid takeProfit. Trade blocked by SSOT enforcement.'
      };
    }

    // CCIP-2026-0318A: Zone source priority — SSOT governance chain
    // 1. wait_condition (Alpha's explicit LLM-parsed zone — PRIMARY authority)
    // 2. entry_advisory pullback zone (secondary fallback)
    // 3. entry_intent zone or raw entry price (last resort)
    const hasWaitConditionZone =
      decision.wait_condition?.target_entry_zone_min != null &&
      decision.wait_condition?.target_entry_zone_max != null;

    const zoneMin = hasWaitConditionZone
      ? decision.wait_condition!.target_entry_zone_min
      : monitorPullbackMin ?? (decision.entry_intent?.entry_zone_min || decision.entry);
    const zoneMax = hasWaitConditionZone
      ? decision.wait_condition!.target_entry_zone_max
      : monitorPullbackMax ?? (decision.entry_intent?.entry_zone_max || decision.entry);

    const zoneSource = hasWaitConditionZone
      ? 'wait_condition'
      : monitorPullbackMin != null
        ? 'entry_advisory'
        : 'entry_price_fallback';

    logger.info(
      LogCategory.GOVERNANCE,
      '[AlphaTradeExecutor] Entry zone source resolved',
      {
        symbol: decision.symbol,
        zoneSource,
        zoneMin,
        zoneMax,
        timeoutMinutes,
        timeoutSource: decision.wait_condition?.expected_wait_minutes != null ? 'wait_condition' : 'default',
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
        entry_zone_min: zoneMin,
        entry_zone_max: zoneMax,
        timeout_at: timeoutAt,
        timeout_minutes: timeoutMinutes,
        status: 'monitoring',
        alpha_reasoning: decision.reasoning,
        alpha_confidence: decision.confidence,
        market_context: this.buildAlphaAdvisoryContext(decision, decision.entry, monitorAdvisory),
        entry_mode: this.toDbEntryMode(decision.entry_mode),
        style: params.canonicalStyle,
        thesis: decision.thesis,
        style_intent: this.toSafeStyleIntent(decision.style_intent),
        execution_preference: decision.execution_preference || 'WAIT_PULLBACK',
        runaway_policy: decision.entry_spec?.runawayPolicy ?? 'RESCAN',
        structural_verdict: monitorVerdict,
        structural_level_price: null,
        structural_level_type: null,
        structural_level_strength: null,
        structural_level_touches: null,
        pullback_target_price: monitorPullbackMid,
        pullback_improvement_pips: null,
        intent_mode: resolvedIntentMode,
        wait_reasoning: decision.wait_condition?.wait_reasoning ?? null,
        expected_wait_minutes: decision.wait_condition?.expected_wait_minutes ?? null,
        // CCIP-2026-0319B: Alpha SL/TP authority — SSOT write point.
        // These are Alpha's exact decided values. No system downstream may modify
        // or substitute them. The entry monitor reads these columns directly.
        alpha_stop_loss: decision.stopLoss,
        alpha_take_profit: resolvedTakeProfit,
        alpha_tp1_price: decision.tp1Price ?? null,
        alpha_tp2_price: decision.tp2Price ?? null,
        invalidation_price: decision.stopLoss
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

    logger.info(
      LogCategory.GOVERNANCE,
      '[AlphaTradeExecutor] Alpha SL/TP persisted to entry_intents (CCIP-2026-0319B)',
      {
        symbol: decision.symbol,
        intentId: intent.id,
        alpha_stop_loss: decision.stopLoss,
        alpha_take_profit: resolvedTakeProfit,
        alpha_tp1_price: decision.tp1Price ?? null,
        alpha_tp2_price: decision.tp2Price ?? null,
        source: 'Alpha sole authority — no fallback path exists'
      }
    );

    const entryModeLabel = isPushConfirmMode
      ? 'push_confirmation'
      : 'wait_pullback';

    const monitorTitle = isPushConfirmMode
      ? `Trade Found — Waiting Zone Confirmation: ${decision.symbol}`
      : `Trade Found — Wait for Pullback: ${decision.symbol}`;

    const monitorMessage = isPushConfirmMode
      ? `Alpha is waiting for ${decision.symbol} to push into the confirmation zone ${zoneMin.toFixed(5)} – ${zoneMax.toFixed(5)}.`
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
        entry_mode: decision.entry_mode || null,
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
      message: `[${entryModeLabel}] Monitoring ${decision.symbol} for entry — ${isPushConfirmMode ? 'waiting for push into confirmation zone' : 'waiting for pullback to zone'}`
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
    impliedRRRatio?: number;
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
      inputs, expectedProfitFromCoordinator, impliedRRRatio, lotSizingAuditRecord,
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
    // CCIP-ALPHA-GOV-LEVELS: Alpha's SL/TP stand as issued. executionStopLoss/executionTakeProfit
    // are always undefined now (fill-price scaling removed). Alpha's structural levels are final.
    let finalSL = decision.stopLoss;
    const finalTP = decision.takeProfit;

    // CCIP-2026-0320C: PROXIMITY_RISK SL Widening Guard
    // Audit trace (2026-03-20): XAUUSD SELL had SL only 2.5 pips from nearest wick (Q9=PROXIMITY_RISK).
    // Alpha flagged the risk but the SL was not widened. The wick consumed the SL.
    // GOVERNANCE: When Alpha's own answer_sheet flags PROXIMITY_RISK on Q9, extract the
    // wick proximity distance and add it as a structural buffer to the SL.
    // This respects Alpha's risk geometry while acting on Alpha's own caution flag.
    // Only applies when the Q9 text contains "PROXIMITY_RISK" and a numeric distance.
    if (decision.answer_sheet?.Q9_sl_wick_proximity) {
      const q9 = decision.answer_sheet.Q9_sl_wick_proximity;
      if (q9.includes('PROXIMITY_RISK')) {
        const distanceMatch = q9.match(/(\d+(?:\.\d+)?)\s*pips?\s*from\s*SL/i);
        if (distanceMatch) {
          const proximityGapPips = parseFloat(distanceMatch[1]);
          if (proximityGapPips > 0 && proximityGapPips <= 10) {
            const pipInfo = getCurrencyPipInfo(decision.symbol);
            const bufferPoints = proximityGapPips * pipInfo.pipValue;
            const direction = decision.action === 'BUY' ? 1 : -1;
            const widenedSL = finalSL - direction * bufferPoints;
            logger.info(
              LogCategory.TRADE_EXECUTION,
              '[AlphaTradeExecutor] PROXIMITY_RISK SL BUFFER: Alpha flagged wick proximity risk — widening SL by gap distance.',
              {
                symbol: decision.symbol,
                originalSL: finalSL,
                widenedSL,
                proximityGapPips,
                bufferPoints,
                q9Text: q9,
                governance: 'CCIP-2026-0320C'
              }
            );
            finalSL = widenedSL;
          }
        }
      }
    }

    // CCIP GOVERNANCE (2026-02-16): Defensive guard — scalp trades never have TP2
    // coordinator-alpha.ts is SSOT, but executor enforces as defensive layer
    const isScalpTrade = canonicalStyle === 'SCALP';
    const finalTP2 = isScalpTrade ? null : decision.tp2Price;

    // CCIP-2026-0320B: TP1 Midpoint Governance Safety Net
    // Alpha is SOLE authority for TP placement (CCIP-2026-02-16).
    // However, when Alpha provides NO tp1 for non-SCALP styles that have a full TP target,
    // the monitoring system cannot trigger TP1 milestone → SL-to-breakeven protection.
    // Audit trace (2026-03-20): XAUUSD SELL peaked at +$447 with tp1_price=null,
    // no partial protection triggered, reversed to -$915 (a $1,362 swing preventable by TP1).
    // GOVERNANCE: Compute midpoint TP1 ONLY as a last-resort fallback when:
    //   1. Trade is NOT scalp (scalps use tp1 as sole target)
    //   2. Alpha provided no tp1 (tp1Price is null/undefined)
    //   3. A full TP target exists (finalTP2 is non-null)
    // The midpoint is the standard market practice for partial profit protection.
    // This does NOT override Alpha — it fills the gap when Alpha is silent on TP1.
    let rawTP1 = decision.tp1Price;

    if (!isScalpTrade && (rawTP1 == null || !Number.isFinite(rawTP1 as number)) && finalTP2 != null && Number.isFinite(finalTP2)) {
      const midpointTP1 = entryPrice + (finalTP2 - entryPrice) * 0.5;
      rawTP1 = midpointTP1;
      logger.info(
        LogCategory.TRADE_EXECUTION,
        '[AlphaTradeExecutor] TP1 MIDPOINT FALLBACK: Alpha provided no TP1. Computed midpoint as governance safety net.',
        {
          symbol: decision.symbol,
          style: canonicalStyle,
          entryPrice,
          finalTP2,
          computedTP1: midpointTP1,
          action: decision.action,
          governance: 'CCIP-2026-0320B'
        }
      );
    }

    const finalTP1 = rawTP1;

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
    // CCIP-FIX: coordinator-alpha attaches patternIntelligence using camelCase keys
    // (htfPattern, mtfPattern, ltfPattern, invalidationPoint) per the AlphaDecision interface.
    // Previously the executor read snake_case keys (htf_pattern, mtf_pattern, ltf_pattern,
    // invalidation_price) which silently resolved to undefined, causing patterns: {} in every
    // stored mid_trade_plan and generic fallback entry_narrative text.
    // SSOT: AlphaDecision.patternIntelligence shape defined in coordinator-alpha.ts (interface).
    const patternIntelligence = decision.patternIntelligence;

    // CCIP-2026-0322A: Build Alpha Watch Contract — trade-specific monitoring conditions
    // prescribed by Alpha at entry. Stored in alpha_watch_contract (immutable post-entry).
    // The escalation engine reads this to know which triggers Alpha cares about for THIS trade.
    const answerSheetForContract = decision.answer_sheet as any;
    const alphaWatchContract = buildAlphaWatchContract({
      stopLoss: finalSL,
      takeProfit: finalTP,
      direction: tradeDirection,
      expectedDurationMinutes: decision.expectedFillTimeHours
        ? Math.round(decision.expectedFillTimeHours * 60) + 30
        : null,
      failureMode: answerSheetForContract?.Q5_failure_mode ?? null,
      failureProbability: answerSheetForContract?.Q5_failure_probability ?? null,
      invalidationPrice: patternIntelligence?.invalidationPoint?.price ?? null,
      patternInvalidationReasoning: patternIntelligence?.invalidationPoint?.reasoning ?? null,
      confidence: decision.confidence,
    });

    const midTradePlan = buildMidTradePlan({
      reasoning: typeof decision.reasoning === 'string'
        ? decision.reasoning
        : (decision.reasoning && typeof (decision.reasoning as any).thesis_why === 'string'
            ? (decision.reasoning as any).thesis_why
            : JSON.stringify(decision.reasoning) || ''),
      entryPrice,
      stopLoss: finalSL,
      takeProfit: finalTP,
      direction: tradeDirection,
      symbol: decision.symbol || '',
      marketRegime: (decision as any).market_regime || regimeBucket || null,
      patternInvalidationPrice: patternIntelligence?.invalidationPoint?.price ?? null,
      patternInvalidationReasoning: patternIntelligence?.invalidationPoint?.reasoning ?? null,
      htfPattern: patternIntelligence?.htfPattern ?? null,
      mtfPattern: patternIntelligence?.mtfPattern ?? null,
      ltfPattern: patternIntelligence?.ltfPattern ?? null,
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
      implied_rr_ratio: (impliedRRRatio !== undefined && Number.isFinite(impliedRRRatio))
        ? impliedRRRatio
        : null,
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
      alpha_reasoning_snapshot: decision.answer_sheet
        ? JSON.stringify({ answer_sheet: decision.answer_sheet, narrative: decision.reasoning || null })
        : (decision.reasoning || null),
      market_regime_at_entry: (decision as any).market_regime || regimeBucket || null,
      // CCIP-FIX: Persist the full regime and adversarial snapshots Alpha received at
      // decision time. Previously only the string bucket (regime_bucket) was saved.
      // The full objects are required for post-trade audit, learning loop closure,
      // and Mid-Trade Monitor context. SSOT: decision.regime_advisory /
      // decision.adversarial_advisory set by coordinator-alpha after Omega council.
      regime_snapshot: decision.regime_advisory ? JSON.stringify(decision.regime_advisory) : null,
      adversarial_snapshot: decision.adversarial_advisory ? JSON.stringify(decision.adversarial_advisory) : null,
      // CCIP-FIX: Write resolved trade style to alpha_style column. Previously only
      // requested_style / resolved_style were written — alpha_style was always null,
      // breaking style-based filtering in admin dashboards and learning queries.
      // SSOT: canonicalStyle is the governance-resolved style (coordinator authority).
      alpha_style: canonicalStyle ?? null,
      mid_trade_plan: midTradePlan,
      alpha_watch_contract: alphaWatchContract,
      thesis_status: 'new',
      alpha_recheck_count: 0,
      // GOVERNANCE (2026-03-30): Record the micro-regime that was active at entry.
      // This is the SSOT for regime-to-outcome calibration. The post-trade-analyzer
      // reads these fields to update regime_outcome_log after closure.
      micro_regime_at_entry: (decision as any).microRegime?.regime ?? null,
      regime_confidence_at_entry: (decision as any).microRegime?.confidence ?? null,
      regime_used_dynamic_baseline: (decision as any).microRegime?.thresholds?.thresholdSource === 'dynamic',
    };
  }

  /**
   * Create notification via SSOT NotificationCoordinator
   * DEPRECATED METHOD - Use notificationCoordinator.send() directly
   * CCIP FIX (2026-02-03): Refactored to use NotificationCoordinator
   */
  // CCIP FIX (2026-02-27): Added metadata param — callers must pass structured trade
  // data so the push notification body is populated with real values (symbol, direction,
  // confidence, prices) instead of fallback 'Unknown'. SSOT: notification-coordinator
  // stores this under goal_notifications.metadata, read by App.tsx realtime listener.
  private async createNotification(params: {
    userId: string;
    sessionId: string;
    type: string;
    title: string;
    message: string;
    tradeId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await notificationCoordinator.send({
        userId: params.userId,
        sessionId: params.sessionId,
        type: params.type as any,
        title: params.title,
        message: params.message,
        priority: 'critical',
        tradeId: params.tradeId,
        metadata: params.metadata,
      });
    } catch (error) {
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

      const safeThesis = decision.thesis && VALID_THESIS.includes(decision.thesis) ? decision.thesis : null;

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
          reasoning: alphaAdvisory?.reasoning || null
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
        style_intent: this.toSafeStyleIntent(decision.style_intent),
        execution_preference: decision.execution_preference || 'IMMEDIATE',
        structural_verdict: structuralVerdict,
        structural_level_price: null,
        structural_level_type: null,
        structural_level_strength: null,
        structural_level_touches: null,
        pullback_target_price: pullbackMidpoint,
        pullback_improvement_pips: null,
        alpha_stop_loss: decision.stopLoss,
        alpha_take_profit: decision.tp2Price ?? decision.takeProfit,
        alpha_tp1_price: decision.tp1Price ?? null,
        alpha_tp2_price: decision.tp2Price ?? null,
        invalidation_price: decision.stopLoss
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

  /**
   * SSOT: Translates Alpha's internal entry_mode vocabulary to the DB-enforced vocabulary.
   *
   * This is the SINGLE authoritative translation point (CCIP-2026-0319-ENTRYMODE).
   * Alpha's coordinator uses its own internal enum values; the entry_intents table
   * enforces a separate DB check constraint. All writes to entry_intents.entry_mode
   * MUST pass through this method to prevent constraint violations.
   *
   * Translation map (SSOT — do not duplicate elsewhere):
   *   Alpha 'execute_now'       -> DB 'immediate'
   *   Alpha 'wait_pullback'     -> DB 'wait_pullback'
   *   Alpha 'push_confirmation' -> DB 'wait_confirmation'
   */
  private toDbEntryMode(
    alphaEntryMode: string | undefined | null
  ): 'immediate' | 'wait_pullback' | 'wait_confirmation' {
    switch (alphaEntryMode) {
      case 'execute_now':   return 'immediate';
      case 'wait_pullback': return 'wait_pullback';
      case 'push_confirmation': return 'wait_confirmation';
      default: return 'wait_pullback';
    }
  }

  /**
   * SSOT guard for entry_intents.style_intent DB constraint.
   * Allowed DB values: 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY'
   * Any unrecognised or missing LLM output degrades to null rather than
   * violating the check constraint and blocking trade execution.
   *
   * CCIP-GOVERNANCE (CCIP-2026-0319-STYLEINTENT): This is the SINGLE
   * authoritative sanitisation point for style_intent. Do NOT inline
   * VALID_STYLE_INTENT checks elsewhere in this file.
   */
  private toSafeStyleIntent(
    rawValue: string | undefined | null
  ): 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY' | null {
    const VALID: ReadonlyArray<string> = ['SCALP', 'MICRO_INTRADAY', 'INTRADAY'];
    if (rawValue && VALID.includes(rawValue)) {
      return rawValue as 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY';
    }
    return null;
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

    // CCIP-2026-0319B: Alpha's SL/TP are written into market_context as defense-in-depth.
    // The authoritative values are always on the dedicated columns (alpha_stop_loss,
    // alpha_take_profit, alpha_tp1_price, alpha_tp2_price). These JSONB copies exist
    // only for backward-compatible reads by older code paths. The entry monitor must
    // always prefer the dedicated columns.
    const resolvedTP = decision.tp2Price ?? decision.takeProfit;
    const context: Record<string, any> = {
      atr_value: slDistance > 0 ? slDistance : undefined,
      volatility,
      structure: regime?.structure,
      market_bias: regime?.market_bias,
      is_high_risk_regime: regime?.is_high_risk_regime ?? false,
      confidence: decision.confidence,
      style: decision.resolvedStyle,
      stop_loss: decision.stopLoss,
      take_profit: resolvedTP,
      tp1_price: decision.tp1Price ?? null,
      tp1_confidence: decision.tp1Confidence ?? null,
      tp1_reasoning: decision.tp1Reasoning ?? null,
      tp2_price: decision.tp2Price ?? null,
      tp2_reasoning: decision.tp2Reasoning ?? null,
      alpha_entry_advisory: {
        verdict: alphaAdvisory?.verdict || (decision.entry_mode === 'wait_pullback' ? 'PULLBACK_EXPECTED' : 'GOOD_ENTRY'),
        pullback_zone_min: alphaAdvisory?.pullback_zone_min || null,
        pullback_zone_max: alphaAdvisory?.pullback_zone_max || null,
        reasoning: alphaAdvisory?.reasoning || null
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
    // SSOT: risk_percentage is the authoritative SL risk tolerance (e.g. 5.0 = risk 5% at SL).
    // Stored once at session creation. Never recomputed from live balance.
    // Fallback chain: risk_percentage column → risk_mode string mapping → null
    const riskPercentageRaw = parseFloat(String(session.risk_percentage ?? ''));
    const riskPercentageFromMode = session.risk_mode === 'high' ? 5.0
      : session.risk_mode === 'medium' ? 3.0
      : session.risk_mode === 'low' ? 1.0
      : null;
    const sessionRiskPercentage: number | null = Number.isFinite(riskPercentageRaw) && riskPercentageRaw > 0
      ? riskPercentageRaw
      : riskPercentageFromMode;

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
        riskPercentage: sessionRiskPercentage,
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
