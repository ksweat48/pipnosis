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
 * 5. Database Boundary (Type coercion + Range check)
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
import { globalDialogManager } from './global-dialog-manager';
import { notificationCoordinator } from './coordinators/notification-coordinator';
import { getOrInitializeUserBalance, validateBalanceIsReasonable } from './balance-initialization-authority';
import { toDirectionDB } from '../utils/direction-converter';
import { getRegimeBucket } from './regime-bucketing';
import { getMinConfidenceThreshold } from '../config/risk-levels';
import { logger, LogCategory } from '../lib/logger';
import type { AlphaDecision } from '../brains/coordinator-alpha';
import type { TradeContext } from '../types/trade-context';

export type ExecutionMode = 'IMMEDIATE' | 'PENDING' | 'MONITORED';

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

class AlphaTradeExecutor {
  /**
   * Execute trade decision
   * Single unified entry point for all execution modes
   */
  async execute(inputs: TradeExecutionInputs): Promise<TradeExecutionResult> {
    const { decision, tradeContext, userId, sessionId, session, mode, snapshotTimestamp } = inputs;

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
      session
    );

    if (!capacityCheck.valid) {
      return {
        success: false,
        error: capacityCheck.reason,
        blockReason: capacityCheck.reason
      };
    }

    // Layer 3: Risk Authority (Context + PCVL + Margin + Kelly)
    // SSOT RESTORATION (2026-02-02): Single source of truth for balance
    // Authority is the ONLY place that retrieves/initializes balance
    // No duplicate DB fetches - prevents data divergence and race conditions
    const balanceResult = await getOrInitializeUserBalance(
      userId,
      undefined, // Let authority decide what to fetch/initialize
      'trade_execution_flow'
    );

    if (!balanceResult.success) {
      logger.error(
        LogCategory.RISK_MANAGEMENT,
        '[AlphaTradeExecutor] Balance initialization failed',
        {
          userId,
          sessionId,
          error: balanceResult.error,
        }
      );
      return {
        success: false,
        error: balanceResult.error || 'Failed to initialize account balance',
        blockReason: 'Could not retrieve or create balance record'
      };
    }

    // SSOT TYPE SAFETY: Ensure balance is a valid positive number (prevents cascading lot size errors)
    let currentBalance: number = balanceResult.balance;

    if (!Number.isFinite(currentBalance)) {
      logger.error(
        LogCategory.RISK_MANAGEMENT,
        '[AlphaTradeExecutor] Balance is not a finite number - invalid state',
        {
          userId,
          sessionId,
          balance: currentBalance,
          type: typeof currentBalance,
        }
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
        {
          userId,
          sessionId,
          balance: currentBalance,
        }
      );
      return {
        success: false,
        error: `Account balance must be positive (current: ${currentBalance})`,
        blockReason: 'Cannot execute trades with zero or negative balance'
      };
    }

    // GOVERNANCE: Log governance flags (e.g., hardcoded default detection)
    if (balanceResult.governanceFlags?.suspectedHardcodedDefault) {
      logger.warn(
        LogCategory.RISK_MANAGEMENT,
        '[AlphaTradeExecutor] GOVERNANCE: Balance initialized with hardcoded default',
        {
          userId,
          sessionId,
          balance: currentBalance,
          message: 'This balance ($50) may be incorrect. Manual verification required before trading.'
        }
      );
    }

    // GOVERNANCE: Fail closed if balance is invalid
    const balanceValidation = validateBalanceIsReasonable(currentBalance, userId);
    if (!balanceValidation.valid) {
      logger.error(
        LogCategory.RISK_MANAGEMENT,
        '[AlphaTradeExecutor] Balance validation failed',
        {
          userId,
          sessionId,
          balance: currentBalance,
          reason: balanceValidation.reason,
        }
      );
      return {
        success: false,
        error: `Account balance validation failed: ${balanceValidation.reason}`,
        blockReason: 'Cannot assess risk without valid account balance'
      };
    }

    // ✅ SSOT FIX (2026-02-02): Calculate baseRiskPercent from user's selected dollar_risk
    // CRITICAL: This ensures user's risk selection flows through to lot sizing
    // User selects "Scalp + Aggressive 5%" → dollar_risk: $500 → baseRiskPercent: 5%
    let baseRiskPercent: number | undefined = undefined;
    if (session.dollar_risk && Number.isFinite(session.dollar_risk) && session.dollar_risk > 0) {
      baseRiskPercent = (session.dollar_risk / currentBalance) * 100;
      logger.info(
        LogCategory.RISK_MANAGEMENT,
        '[AlphaTradeExecutor] Using user-selected risk percentage',
        {
          userId,
          sessionId,
          dollarRisk: session.dollar_risk,
          accountBalance: currentBalance,
          calculatedRiskPercent: baseRiskPercent.toFixed(2) + '%',
          source: 'session.dollar_risk (SSOT)'
        }
      );
    } else {
      logger.info(
        LogCategory.RISK_MANAGEMENT,
        '[AlphaTradeExecutor] No dollar_risk found, using default risk from UnifiedRiskAuthority',
        {
          userId,
          sessionId,
          sessionDollarRisk: session.dollar_risk,
          willUseDefault: true
        }
      );
    }

    const riskAssessment = await unifiedRiskAuthority.assessTrade({
      tradeContext,
      symbol: decision.symbol,
      direction: decision.action === 'BUY' ? 'long' : 'short',
      entryPrice: decision.entry,
      stopLoss: decision.stopLoss,
      takeProfit: decision.takeProfit,
      userId,
      currentBalance: currentBalance,
      baseRiskPercent, // ✅ SSOT: Pass user's selected risk percentage
      riskMode: session.risk_mode || 'medium',
      goalSessionId: sessionId
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

    // SSOT FIX (2026-02-03): Always try goal-aware lot sizing if session has target value
    // REQUIREMENT: expectedProfitAtTP must flow from coordinator to trade record
    if (session && session.target_value) {
      lotSizingAuditRecord.sessionHadTargetValue = true;
      lotSizingAuditRecord.sessionHadCurrentProgress = session.current_progress !== undefined;

      try {
        // ✅ SSOT FIX (2026-02-02): Use user-selected risk percentage from baseRiskPercent
        // PRIORITY: baseRiskPercent (from session.dollar_risk) > fallback to trade style map
        // This ensures "Scalp + Aggressive 5%" actually uses 5%, not hardcoded value
        let riskPercentageAllowed: number;

        if (baseRiskPercent !== undefined && baseRiskPercent > 0) {
          // Use the risk percentage calculated from user's dollar_risk selection
          riskPercentageAllowed = baseRiskPercent;
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
          const tradeStyle = (session.trade_style || 'day').toLowerCase();
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

        // Use current progress if available, otherwise default to 0
        const currentProgress = session.current_progress !== undefined ? session.current_progress : 0;

        lotSizingAuditRecord.coordinatorInvoked = true;

        lotSizingDecision = await goalAwareLotSizingCoordinator.makeDecision({
          userId,
          goalSessionId: sessionId,
          symbol: decision.symbol,
          direction: decision.action === 'BUY' ? 'long' : 'short',
          accountBalance: currentBalance,
          goalAmount: session.target_value,
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
        logger.error(
          LogCategory.RISK_MANAGEMENT,
          '[AlphaTradeExecutor] Goal-aware lot sizing failed, falling back to risk assessment',
          { error, userId, sessionId, symbol: decision.symbol }
        );
        // Use risk assessment lot size as fallback
        finalLotSize = riskAssessment.recommendedLotSize;
        lotSizingAuditRecord.usedFallbackCalculation = true;
        lotSizingAuditRecord.fallbackReason = `Coordinator error: ${error instanceof Error ? error.message : String(error)}`;
        lotSizingDecision = null; // Clear so expectedProfitAtTP won't be used
      }
    } else {
      // Session has no target_value - cannot use goal-aware lot sizing
      lotSizingAuditRecord.usedFallbackCalculation = true;
      lotSizingAuditRecord.fallbackReason = 'Session has no target_value';
    }

    // MODE ROUTING (Execute based on selected mode)
    if (mode === 'IMMEDIATE') {
      return await this.executeImmediate({
        decision,
        userId,
        sessionId,
        session,
        lotSize: finalLotSize,
        riskDollars: riskAssessment.adjustedRiskDollars,
        riskWarnings: riskWarningsWithGoalContext,
        inputs,
        lotSizingDecisionId: lotSizingDecision?.auditRecordId,
        expectedProfitAtTP: lotSizingDecision?.expectedProfitAtTP, // SSOT FIX: Pass coordinator's calculation
        lotSizingAuditRecord // CCIP: Pass audit metadata for governance logging
      });
    } else if (mode === 'PENDING') {
      return await this.createPending({
        decision,
        userId,
        sessionId,
        session,
        lotSize: finalLotSize,
        riskDollars: riskAssessment.adjustedRiskDollars,
        riskWarnings: riskWarningsWithGoalContext,
        inputs,
        lotSizingDecisionId: lotSizingDecision?.auditRecordId,
        expectedProfitAtTP: lotSizingDecision?.expectedProfitAtTP, // SSOT FIX: Pass coordinator's calculation
        lotSizingAuditRecord // CCIP: Pass audit metadata for governance logging
      });
    } else {
      // MONITORED mode - create entry intent
      return await this.createMonitored({
        decision,
        userId,
        sessionId,
        lotSize: finalLotSize,
        riskDollars: riskAssessment.adjustedRiskDollars,
        lotSizingDecisionId: lotSizingDecision?.auditRecordId
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
    expectedProfitAtTP?: number; // SSOT FIX: From coordinator's calculation
    lotSizingAuditRecord?: any; // CCIP: Governance audit metadata
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

    // Apply slippage adjustment (symbol-specific)
    const slippage = this.calculateSlippage(decision.symbol);

    // GOVERNANCE: Validate slippage before arithmetic
    if (!Number.isFinite(slippage)) {
      return {
        success: false,
        error: `Invalid slippage calculated for ${decision.symbol}: ${slippage}`
      };
    }

    const adjustedEntry = decision.action === 'BUY'
      ? entryPrice + slippage
      : entryPrice - slippage;

    // GOVERNANCE: Validate adjusted entry is valid number
    if (!Number.isFinite(adjustedEntry)) {
      return {
        success: false,
        error: `Slippage adjustment resulted in invalid price: ${adjustedEntry} (base: ${entryPrice}, slippage: ${slippage})`
      };
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
        expectedProfitFromCoordinator: params.expectedProfitAtTP, // SSOT FIX: Use coordinator's calculation
        lotSizingAuditRecord: params.lotSizingAuditRecord // CCIP: Pass audit record
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

    // Update session status
    await supabase
      .from('goal_sessions')
      .update({ status: 'in_trade' })
      .eq('id', sessionId);

    // Create notification via SSOT NotificationCoordinator
    // CCIP FIX (2026-02-03): Refactored from direct DB insert to NotificationCoordinator
    // SSOT FIX (2026-02-03): Include Alpha's complete decision data in metadata for UI display
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
        thesis: decision.thesis
      }
    });

    // Trigger modal popup (only works in browser context)
    // CCIP FIX (2026-02-03): Added modal trigger for immediate user feedback
    // SSOT FIX (2026-02-03): Include Alpha's confidence and dual TP system from decision object
    try {
      globalDialogManager.showTradeEntry({
        tradeId: trade.id,
        symbol: decision.symbol,
        direction: decision.action === 'BUY' ? 'buy' : 'sell',
        action: decision.action,
        lotSize,
        entryPrice: adjustedEntry,
        stopLoss: decision.stopLoss,
        takeProfit: decision.takeProfit,
        expectedProfit: params.expectedProfitAtTP,
        reasoning: decision.reasoning,
        confidence: decision.confidence,
        setupType: decision.thesis || 'Market Setup',
        tp1: decision.tp1Price || undefined,
        tp2: decision.tp2Price || undefined,
        tp1Confidence: decision.tp1Confidence || undefined,
        autoExecuted: true
      }, 'urgent');
    } catch (err) {
      // Non-blocking - modal manager not available in server context
      console.debug('[AlphaTradeExecutor] Modal trigger skipped (server context)', err);
    }

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
    expectedProfitAtTP?: number; // SSOT FIX: From coordinator's calculation
    lotSizingAuditRecord?: any; // CCIP: Governance audit metadata
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
        expectedProfitFromCoordinator: params.expectedProfitAtTP, // SSOT FIX: Use coordinator's calculation
        lotSizingAuditRecord: params.lotSizingAuditRecord // CCIP: Pass audit record
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

    // Update session status
    await supabase
      .from('goal_sessions')
      .update({ status: 'trade_pending' })
      .eq('id', sessionId);

    // Create notification (use resolved entryPrice, not decision.entry which may be null)
    await this.createNotification({
      userId,
      sessionId,
      type: 'signal',
      title: `Trade Signal: ${decision.symbol}`,
      message: `${decision.action} ${lotSize.toFixed(2)} lots at ${entryPrice.toFixed(5)}`,
      tradeId: trade.id
    });

    return {
      success: true,
      tradeId: trade.id,
      message: `Pending trade created: ${decision.action} ${lotSize.toFixed(2)} lots`
    };
  }

  /**
   * Create monitored entry intent
   */
  private async createMonitored(params: {
    decision: AlphaDecision;
    userId: string;
    sessionId: string;
    lotSize: number;
    riskDollars: number;
    lotSizingDecisionId?: string;
  }): Promise<TradeExecutionResult> {
    const { decision, userId, sessionId, lotSize, riskDollars } = params;

    // Create entry intent
    const { data: intent, error } = await supabase
      .from('entry_intents')
      .insert({
        user_id: userId,
        goal_session_id: sessionId,
        symbol: decision.symbol,
        direction: toDirectionDB(decision.action === 'BUY' ? 'buy' : 'sell'),
        entry_price_target: decision.entry,
        stop_loss: decision.stopLoss,
        take_profit: decision.takeProfit,
        lot_size: lotSize,
        risk_dollars: riskDollars,
        status: 'active',
        should_execute_immediately: false,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error || !intent) {
      return {
        success: false,
        error: error?.message || 'Failed to create entry intent'
      };
    }

    return {
      success: true,
      isMonitoring: true,
      message: `Monitoring ${decision.symbol} for entry at ${decision.entry.toFixed(5)}`
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
    expectedProfitFromCoordinator?: number; // SSOT FIX (2026-02-03): Use coordinator's calculation
    lotSizingAuditRecord?: any; // CCIP: Governance tracking of lot sizing decisions
  }): any {
    const { decision, userId, sessionId, lotSize, riskDollars, entryPrice, status, openedAt, inputs, expectedProfitFromCoordinator, lotSizingAuditRecord } = params;

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

      expectedProfit = Math.abs(decision.takeProfit - entryPrice) * lotSize;

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
    return {
      user_id: userId,
      goal_session_id: sessionId,
      symbol: decision.symbol,
      direction: toDirectionDB(decision.action === 'BUY' ? 'buy' : 'sell'),
      entry_price: entryPrice,
      stop_loss: decision.stopLoss,
      take_profit: decision.takeProfit,
      tp1_price: decision.tp1Price,
      tp2_price: decision.tp2Price,
      lot_size: lotSize, // PHASE 1: Required NOT NULL field
      position_size: lotSize,
      risk_dollars: riskDollars,
      expected_profit_for_session: expectedProfit, // PHASE 1: Required NOT NULL field
      status,
      order_type: status === 'open' ? 'market' : 'limit',
      opened_at: openedAt,
      current_price: status === 'open' ? entryPrice : null,
      current_pnl: 0, // PHASE 1: Always provide value, never null
      trade_confidence: decision.confidence, // SSOT: Correct column name
      regime_bucket: regimeBucket
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
