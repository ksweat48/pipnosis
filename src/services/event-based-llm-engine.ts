/**
 * Pipnosis Alpha Brain Engine
 *
 * The unified autonomous trading brain for both backtesting and live trading.
 * Uses intelligent strategy planning + condition monitoring + execution decisions.
 * NO legacy systems, NO Flow V2 - Pure Pipnosis Alpha architecture.
 */

import { supabase } from '../lib/supabase';
import SystemTableRPCWrapper from './system-table-rpc-wrapper';
import { PIPNOSIS_CORE_RULES } from '../lib/pipnosis-core-rules';
import { triggerDetectionRules, TriggerEvent, MarketSnapshot } from './trigger-detection-rules';
import { llmSnapshotBuilder, LLMTradeDecision } from './llm-snapshot-builder';
import { rewardEngine } from './reward-engine';
import { type PlatformScore, type TraderScore } from './ai-identity';

const NEUTRAL_TRADER_SCORE: TraderScore = {
  current_score: 50,
  lifetime_profit: 0,
  lifetime_loss: 0,
  streak_wins: 0,
  streak_losses: 0,
  confidence_level: 'balanced',
  risk_appetite: 3.0,
  trading_style: 'steady',
  total_trades: 0,
  win_rate: 0.5
};
import { llmStrategyBrain, StrategyPlan } from './llm-strategy-brain';
import { strategyMemoryService } from './strategy-memory-service';
import { conditionMonitor } from './condition-monitor';
import { llmExecutionBrain } from './llm-execution-brain';
import { alphaOmegaOrchestrator, type FullMarketState } from './alpha-omega-orchestrator';
import type { MidTradeDecision } from '../brains/midtrade-monitor';
import { safetyEnforcer } from './safety-enforcer';
import { performanceAnalyzer } from './performance-analyzer';
import { developerModeLogger } from './developer-mode-logger';
import { getCurrencyPipInfo, calculateDollarPerPip } from '../utils/currencyHelpers';
import { alphaThoughtStream } from './alpha-thought-stream';
import { alphaLearningTracker } from './alpha-learning-tracker';

export interface EventBasedEngineConfig {
  symbol: string;
  timeframe: string;
  useLLM: boolean;
  riskMode: 'low' | 'medium' | 'high';
  maxConcurrentTrades: number;
  initialBalance?: number;
  tradeStyle?: string;
  goalContext?: {
    goalSessionId?: string;
    targetAmount?: number;
    targetValue?: number;
    currentProgress: number;
    remainingAmount?: number;
    progressPercentage?: number;
    timeframe?: string;
    riskMode?: string;
    tradeStyle?: string;
    tradesRemaining?: number;
    tradesCompleted?: number;
    tradesPlanned?: number;
  };
}

export interface SimulatedTrade {
  id: string;
  symbol: string;
  timeframe: string;
  direction: 'buy' | 'sell';
  entryTime: Date;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  positionSize: number;
  confidence: number;
  reasoning: string;
  triggerType: string;
  maxHoldMinutes: number;
  exitTime?: Date;
  exitPrice?: number;
  exitReason?: string;
  pnl: number;
  outcome: 'win' | 'loss' | 'breakeven' | 'open';
  holdingMinutes?: number;
  // Playbook tracking for learning system
  playbook_id?: string;
  regime_bucket?: string;
  regimeSnapshot?: any; // Full regime data at trade entry
  adversarialSignal?: any; // Full adversarial data at trade entry
}

export interface EngineStatistics {
  totalCandles: number;
  triggersDetected: number;
  llmCallsMade: number;
  tradesExecuted: number;
  tradesWon: number;
  tradesLost: number;
  totalPnL: number;
  winRate: number;
  avgHoldTime: number;
  triggerToTradeRatio: number;
  autonomousDecisions: number;
  safetyBlocks: number;
}

class EventBasedLLMEngine {
  private readonly GPT_MODEL = 'gpt-4o';
  private sessionTokenUsage: number = 0;
  private readonly MAX_TOKENS_PER_SESSION = 50000;
  private readonly TOKEN_RESET_WINDOW_HOURS = 4;
  private userId: string | null = null;
  private sessionId: string | null = null;
  private tokenWindowStart: number = Date.now();

  // Autonomous brain state
  private platformScore: PlatformScore | null = null;
  private currentStrategy: StrategyPlan | null = null;
  private currentStrategyId: string | null = null; // Track active strategy in memory
  private strategyPlanCount: number = 0;
  private lastRegime: any = null; // Track last regime snapshot for playbook evaluation
  private lastAdversarial: any = null; // Track last adversarial signal for playbook evaluation
  private currentConfig: EventBasedEngineConfig | null = null; // Store config for playbook lookups
  // Pipnosis Alpha is ALWAYS active - no fallback systems

  constructor() {
  }

  /**
   * Initialize Pipnosis Alpha Brain with user context
   */
  async initialize(userId: string, sessionId: string | null = null, supabaseClient?: any): Promise<void> {
    this.userId = userId;
    this.sessionId = sessionId;
    this.sessionTokenUsage = 0;
    this.tokenWindowStart = Date.now();
    await developerModeLogger.initialize(userId);

    // Load platform score (global streak-based modifier — no user ID)
    this.platformScore = await rewardEngine.loadPlatformScore(supabaseClient);
    console.log(`[Event Engine] Autonomous Pipnosis Alpha initialized`);
    console.log(`[Event Engine] Platform streak modifier: ${this.platformScore.confidence_modifier >= 0 ? '+' : ''}${this.platformScore.confidence_modifier}%`);
  }

  /**
   * Check if token budget needs to be reset (sliding window)
   */
  private checkTokenBudgetReset(): void {
    const now = Date.now();
    const windowElapsed = (now - this.tokenWindowStart) / (1000 * 60 * 60); // hours

    if (windowElapsed >= this.TOKEN_RESET_WINDOW_HOURS) {
      const previousUsage = this.sessionTokenUsage;
      this.sessionTokenUsage = 0;
      this.tokenWindowStart = now;
      console.log(`[Event Engine] 🔄 Token budget reset after ${windowElapsed.toFixed(1)}h (Used: ${previousUsage} tokens)`);
    }
  }

  /**
   * Pipnosis Alpha Brain is always enabled - no configuration needed
   */
  setAutonomousBrain(enabled: boolean): void {
    // Deprecated: Alpha is always active
    console.log('[Pipnosis Alpha] Brain is always enabled');
  }

  /**
   * Process a single candle and check for trade opportunities
   */
  async processCandle(
    candles: any[],
    config: EventBasedEngineConfig,
    openTrades: SimulatedTrade[] = [],
    goalContext?: {
      goalSessionId?: string;
      targetAmount: number;
      currentProgress: number;
      remainingAmount: number;
      tradesCompleted: number;
      tradesPlanned: number;
    }
  ): Promise<{ trade: SimulatedTrade | null; trigger: TriggerEvent | null; llmCalled: boolean }> {
    // Store config for playbook lookups
    this.currentConfig = config;

    // Pipnosis Alpha is the ONLY trading path
    return this.processCandleAutonomous(candles, config, openTrades, goalContext);
  }

  /**
   * Process candle using autonomous Pipnosis Alpha brain
   */
  private async processCandleAutonomous(
    candles: any[],
    config: EventBasedEngineConfig,
    openTrades: SimulatedTrade[] = [],
    goalContext?: {
      goalSessionId?: string;
      targetAmount: number;
      currentProgress: number;
      remainingAmount: number;
      tradesCompleted: number;
      tradesPlanned: number;
    }
  ): Promise<{ trade: SimulatedTrade | null; trigger: TriggerEvent | null; llmCalled: boolean }> {
    // Check weekend shutdown
    const { weekendProtectionService } = await import('./weekend-protection-service');
    if (weekendProtectionService.isLLMDisabled()) {
      console.log('[Autonomous Brain] LLM APIs disabled for weekend shutdown');
      return { trade: null, trigger: null, llmCalled: false };
    }

    if (candles.length < 50) {
      return { trade: null, trigger: null, llmCalled: false };
    }

    if (openTrades.length >= config.maxConcurrentTrades) {
      return { trade: null, trigger: null, llmCalled: false };
    }

    // STEP 1: Plan strategy (once per 100 candles)
    if (!this.currentStrategy || this.strategyPlanCount >= 100) {
      const marketState = llmSnapshotBuilder.buildMarketState(candles);
      const levels = llmSnapshotBuilder.detectSupportResistance(candles, marketState.price);

      const strategySnapshot = llmStrategyBrain.buildStrategySnapshot(
        candles,
        config.symbol,
        config.timeframe,
        {
          ema20: marketState.ema20,
          ema50: marketState.ema50,
          ema200: marketState.ema200,
          rsi: marketState.rsi,
          stochRsi: marketState.stochRsi,
          atr: marketState.atr,
          vwap: marketState.vwap
        },
        {
          trend: marketState.trend,
          momentum: marketState.momentum,
          volatility: marketState.volatility
        },
        {
          support: levels.support,
          resistance: levels.resistance,
          swingHigh: marketState.swingHigh,
          swingLow: marketState.swingLow
        }
      );

      // Get regime and adversarial data for strategy planning
      const prelimCheck = conditionMonitor.checkConditions(
        { mode: 'trend', conditions: [], entry_logic: '', sl_calculation: '', tp_calculation: '', risk_pct: 3, riskLevel: 3, confidence: 70, rationale: '', watch_indicators: [] },
        marketState,
        candles[candles.length - 1].open_time,
        candles
      );

      this.currentStrategy = await llmStrategyBrain.planStrategy(
        strategySnapshot,
        NEUTRAL_TRADER_SCORE,
        this.userId || undefined,
        prelimCheck.regime,
        prelimCheck.adversarial,
        config.tradeStyle
      );

      // Save strategy to memory
      if (this.userId) {
        try {
          this.currentStrategyId = await strategyMemoryService.saveStrategyPlan(
            this.userId,
            this.currentStrategy,
            {
              symbol: config.symbol,
              timeframe: config.timeframe,
              regime: marketState.trend,
              volatility: marketState.volatility,
              price: marketState.price,
              ema50: marketState.ema50,
              ema200: marketState.ema200,
              rsi: marketState.rsi,
              atr: marketState.atr,
              trend_strength: marketState.momentum,
              indicators: marketState
            },
            this.sessionId || undefined
          );
          console.log(`[Autonomous Brain] 💾 Strategy saved to memory (ID: ${this.currentStrategyId})`);
        } catch (error) {
          console.warn('[Autonomous Brain] Failed to save strategy to memory:', error);
        }
      }
      this.strategyPlanCount = 0;
      console.log(`[Autonomous Brain] ✅ Strategy planned: ${this.currentStrategy.mode}`);
      console.log(`[Autonomous Brain] Watching for: ${this.currentStrategy.conditions.join(', ')}`);
      console.log(`[Autonomous Brain] Risk Level: ${this.currentStrategy.riskLevel}%`);
    }
    this.strategyPlanCount++;

    // STEP 2: Check conditions (NO LLM) with error recovery
    let conditionCheck;
    let marketState;
    try {
      marketState = llmSnapshotBuilder.buildMarketState(candles);
      conditionCheck = conditionMonitor.checkConditions(
        this.currentStrategy,
        marketState,
        candles[candles.length - 1].open_time,
        candles
      );

      // Store regime and adversarial for playbook evaluation
      this.lastRegime = conditionCheck.regime;
      this.lastAdversarial = conditionCheck.adversarial;

      if (!conditionCheck.ready) {
        const statusMsg = this.getDetailedConditionStatus(conditionCheck, marketState);
        console.log(`[Autonomous Brain] ${statusMsg}`);

        // ALPHA THOUGHTS: Show transparency about why no trade
        if (conditionCheck.alphaThoughts) {
          console.log(`\n💭 [ALPHA THOUGHTS]\n${conditionCheck.alphaThoughts}\n`);

          // Emit to UI for real-time visibility
          // SSOT: Use singleton instance from alpha-thought-stream.ts
          try {
            await alphaThoughtStream.emitConditionEvaluation(
              this.sessionId,
              this.userId,
              config.symbol,
              conditionCheck.alphaThoughts,
              conditionCheck.conditionsMet.length,
              conditionCheck.conditionsMet.length + conditionCheck.conditionsFailed.length
            );
          } catch (error) {
            // Governance: Degrade gracefully - Alpha continues even if UI emission fails
            console.warn('[Autonomous Brain] Failed to emit Alpha thoughts to UI:', error);
          }
        }

        console.log(`[Autonomous Brain] Monitoring conditions... waiting for setup`);
        return { trade: null, trigger: null, llmCalled: false };
      }

      console.log(`[Autonomous Brain] ✅ Conditions met: ${conditionCheck.trigger}`);
    } catch (error) {
      console.error('[Autonomous Brain] ❌ Condition check failed:', error);
      console.log('[Autonomous Brain] Continuing to next scan (error recovery)');
      return { trade: null, trigger: null, llmCalled: false };
    }

    // STEP 3: Alpha + Omega Council Decision
    console.log(`[Autonomous Brain] 🎯 Calling Alpha + Omega Council...`);

    // Build full market state for Alpha+Omega
    const fullMarketState: FullMarketState = {
      symbol: config.symbol,
      price: marketState.price,
      ema20: marketState.ema20,
      ema50: marketState.ema50,
      ema200: marketState.ema200,
      rsi: marketState.rsi,
      stochRsi: marketState.stochRsi,
      atr: marketState.atr,
      vwap: marketState.vwap,
      trend: marketState.trend,
      volatility: marketState.volatility,
      momentum: marketState.momentum,
      support: [],
      resistance: [],
      swingHigh: marketState.swingHigh,
      swingLow: marketState.swingLow,
      recentCandles: candles.slice(-20),
      omegaSensors: marketState.omegaSensors,
      regime: conditionCheck.regime, // Pass regime intelligence to Omegas
      adversarial: conditionCheck.adversarial // Pass adversarial intelligence to Omegas
    };

    // Calculate proposed SL/TP based on strategy
    const direction = conditionCheck.trigger.toLowerCase().includes('buy') ? 'buy' : 'sell';
    const proposedSL = direction === 'buy'
      ? marketState.price - (marketState.atr * 1.5)
      : marketState.price + (marketState.atr * 1.5);
    const proposedTP = direction === 'buy'
      ? marketState.price + (marketState.atr * 2.5)
      : marketState.price - (marketState.atr * 2.5);

    // Call Alpha + Omega
    // PRIORITY 3 FIX: Pass userId to makeTradeDecision for proper tracking
    // CCIP-2026-0526C: Pass goalContext so thought stream works for single-pair scans
    const goalTargetValue = config.goalContext?.targetAmount || config.goalContext?.targetValue || 0;
    const goalCurrentProgress = config.goalContext?.currentProgress || 0;
    const goalContextForAlpha = config.goalContext?.goalSessionId ? {
      hasGoal: true,
      currentBalance: config.initialBalance || 10000,
      targetGoal: goalTargetValue,
      currentProgress: goalCurrentProgress,
      remainingGoal: config.goalContext.remainingAmount || (goalTargetValue - goalCurrentProgress),
      goalPercentage: 0,
      pipsNeededEstimate: 0,
      riskMode: config.riskMode,
      sessionId: config.goalContext.goalSessionId,
      tradeStyle: config.tradeStyle || config.goalContext.tradeStyle,
    } as import('../brains/coordinator-alpha').GoalContext : undefined;

    const decision = await alphaOmegaOrchestrator.makeTradeDecision(
      fullMarketState,
      NEUTRAL_TRADER_SCORE,
      proposedSL,
      proposedTP,
      goalContextForAlpha,
      this.userId || undefined
    );

    // CCIP-2026-0526C: Log ALL decisions to alpha_decisions (Path 2 parity with Path 1)
    if (config.goalContext?.goalSessionId && this.userId) {
      try {
        const omegaVotes = decision.omega_votes || {};
        const voteEntries = Object.values(omegaVotes).filter(Boolean);
        const buyVotes = voteEntries.filter((v: any) => v?.vote === 'BUY' || v?.direction === 'BUY' || v?.bias === 'BUY').length;
        const sellVotes = voteEntries.filter((v: any) => v?.vote === 'SELL' || v?.direction === 'SELL' || v?.bias === 'SELL').length;
        const majorityDirection = buyVotes > sellVotes ? 'BUY' : sellVotes > buyVotes ? 'SELL' : 'MIXED';

        await alphaLearningTracker.logDecision(
          this.userId,
          decision,
          omegaVotes as any,
          {
            direction: majorityDirection as 'BUY' | 'SELL' | 'MIXED',
            confidence: decision.confidence || 0,
            agreement_count: Math.max(buyVotes, sellVotes),
            total_votes: voteEntries.length,
          },
          decision.conflictInfo || { detected: false, type: 'NONE' as const },
          {
            symbol: config.symbol,
            timeframe: config.timeframe,
            currentPrice: marketState.price,
            atr: marketState.atr,
            session: 'unknown',
          },
          NEUTRAL_TRADER_SCORE,
          config.goalContext.goalSessionId
        );
      } catch (logErr) {
        console.warn('[Autonomous Brain] Failed to log alpha_decision (non-blocking):', logErr);
      }
    }

    if (decision.action === 'NO_TRADE') {
      console.log(`[Autonomous Brain] ✗ Alpha declined trade: ${decision.reasoning}`);
      console.log(`[Autonomous Brain] Omega Summary: ${decision.omega_summary}`);
      return { trade: null, trigger: null, llmCalled: true };
    }

    console.log(`[Autonomous Brain] ✅ Alpha approved: ${decision.action} ${config.symbol}`);
    console.log(`[Autonomous Brain] Omega Summary: ${decision.omega_summary}`);

    // STEP 4: Safety validation (GOVERNANCE COMPLIANT)
    const balance = config.initialBalance || 10000;
    const currentExposure = openTrades.reduce((sum, t) => {
      const risk = Math.abs(t.entryPrice - t.stopLoss) * t.positionSize;
      return sum + (risk / balance);
    }, 0);

    const safetyCheck = safetyEnforcer.validateTrade(decision, {
      balance,
      currentExposure,
      openTrades: openTrades.length,
      dailyDrawdown: 0,
      atr: marketState.atr,
      currentPrice: marketState.price,
      regime: conditionCheck.regime,
      adversarial: conditionCheck.adversarial
    });

    // GOVERNANCE: Only block on system integrity violations
    if (!safetyCheck.passed) {
      console.error(`[Autonomous] 🚫 SYSTEM ERROR - Trade blocked:`);
      safetyCheck.hardBlocks.forEach(v => console.error(`  ❌ ${v}`));
      return { trade: null, trigger: null, llmCalled: true };
    }

    // CCIP-2026-03-15: Alpha Sovereignty — advisory signals are audit-logged as context only.
    // Alpha self-prices all risk signals into his stated confidence during LLM reasoning.
    // No code arithmetic is applied to Alpha's confidence after he outputs it.
    // safetyCheck.advisoryPenalties are passed as briefing context to Alpha, not applied here.
    const { advisoryPenaltyAggregator } = await import('./advisory-penalty-aggregator');
    advisoryPenaltyAggregator.applyPenalties(
      decision.confidence,
      safetyCheck.advisoryPenalties
    ); // Audit log only — finalConfidence === decision.confidence (see advisory-penalty-aggregator.ts)

    // Alpha's confidence is final. Use the decision as-is (hard-block fallback preserves
    // safetyCheck.adjustedDecision which only activates on system integrity failures, not risk advisories).
    const finalDecision = safetyCheck.adjustedDecision || decision;

    if (safetyCheck.advisories.length > 0) {
      console.log(`[Alpha Authority] Advisory signals logged (informational — Alpha's confidence ${decision.confidence}% unchanged):`);
      safetyCheck.advisories.forEach(a => console.log(`  • ${a}`));
    }

    // STEP 5: Calculate proper position size and create trade
    // ✅ PHASE 2 SECTION 1: Use ProfessionalRiskManager (SSOT for position sizing)
    // Replaces calculatePositionSize() to ensure Kelly Criterion, EV Gating,
    // volatility adjustments, correlation checks, and progressive risk scaling are applied
    const { professionalRiskManager } = await import('./professional-risk-manager');
    const { calculatePipDistance } = await import('../utils/currencyHelpers');
    const { getRiskPercentage } = await import('../config/risk-levels');

    const baseRiskPercent = getRiskPercentage(config.riskMode);

    // Calculate pip distances for risk assessment
    const stopPips = calculatePipDistance(config.symbol, finalDecision.entry, finalDecision.stopLoss);
    const takeProfitPips = calculatePipDistance(config.symbol, finalDecision.entry, finalDecision.takeProfit);

    // Use ProfessionalRiskManager for comprehensive risk evaluation
    const riskAssessment = await professionalRiskManager.evaluateTrade({
      userId: this.userId || 'event-engine',
      symbol: config.symbol,
      direction: finalDecision.direction,
      currentBalance: balance,
      baseRiskPercent,
      stopLossPips: stopPips,
      takeProfitPips: takeProfitPips,
      goalSessionId: config.goalContext?.goalSessionId,
      riskMode: config.riskMode,
      entryPrice: finalDecision.entry,
      currentPrice: finalDecision.entry
    });

    if (!riskAssessment.approved) {
      console.warn(`[Event Engine] ProfessionalRiskManager rejected trade: ${riskAssessment.criticalWarnings.join(', ')}`);
      this.stats.safetyBlocks++;
      return null; // Trade blocked by risk management
    }

    const positionSize = riskAssessment.recommendedLotSize;
    console.log(`[Event Engine] ProfessionalRiskManager approved: ${positionSize.toFixed(2)} lots (Risk Score: ${riskAssessment.riskScore}/100)`);

    const currentCandle = candles[candles.length - 1];

    // Get active playbook and regime bucket for learning system
    let playbookId: string | undefined;
    let regimeBucket: string | undefined;
    try {
      const { strategyPlaybookManager } = await import('./strategy-playbook-manager');
      const { getRegimeBucket } = await import('./regime-bucketing');

      regimeBucket = getRegimeBucket(conditionCheck.regime, conditionCheck.adversarial);

      const activePlaybook = await strategyPlaybookManager.getActivePlaybook(
        this.userId || 'event-engine',
        config.symbol,
        config.timeframe,
        this.currentStrategy.mode,
        regimeBucket || 'unknown'
      );

      if (activePlaybook) {
        playbookId = activePlaybook.id;
      } else if (this.userId) {
        // Auto-create playbook entry for this new strategy variant
        console.log(`[Playbook] No playbook found - creating variant for ${this.currentStrategy.mode} in ${regimeBucket}`);
        const rrTarget = takeProfitPips / Math.max(stopPips, 0.01);
        const newPlaybookId = await strategyPlaybookManager.createPlaybookVariant(
          this.userId,
          config.symbol,
          config.timeframe,
          this.currentStrategy.mode,
          regimeBucket || 'unknown',
          {
            rr_target: parseFloat(rrTarget.toFixed(2)),
            sl_factor_atr: 1.0,
            tp_factor_atr: rrTarget,
            risk_pct: baseRiskPercent,
            entry_filters: this.currentStrategy.conditions || []
          },
          finalDecision.reasoning
        );
        playbookId = newPlaybookId || undefined;
        console.log(`[Playbook] Created playbook variant: ${playbookId}`);
      }
    } catch (err) {
      console.warn('[Autonomous] Failed to load playbook context:', err);
    }

    const trade: SimulatedTrade = {
      id: Math.random().toString(36).substring(7),
      symbol: config.symbol,
      timeframe: config.timeframe,
      direction: finalDecision.action.toLowerCase() as 'buy' | 'sell',
      entryTime: new Date(currentCandle.open_time),
      entryPrice: finalDecision.entry,
      stopLoss: finalDecision.stopLoss,
      takeProfit: finalDecision.takeProfit,
      positionSize: positionSize,
      confidence: finalDecision.confidence,
      reasoning: finalDecision.reasoning,
      triggerType: this.currentStrategy.mode,
      maxHoldMinutes: 240,
      pnl: 0,
      outcome: 'open',
      // Playbook tracking for learning system
      playbook_id: playbookId,
      regime_bucket: regimeBucket,
      regimeSnapshot: conditionCheck.regime,
      adversarialSignal: conditionCheck.adversarial
    };

    console.log(`[Autonomous] ✓ Trade: ${trade.direction} @ ${trade.entryPrice}`);
    return { trade, trigger: null, llmCalled: true };
  }


  // Removed legacy methods:
  // - executeSingleLLMCall (Layer 5 fallback)
  // - logPipelineCompletion (5-layer logging)
  // - executeRuleBasedDecision (non-LLM fallback)
  // - createTradeFromLLMDecision (used by deleted processCandleLegacy)
  // All trade decisions now handled by Pipnosis Alpha Brain

  /**
   * Update open trades with current price + mid-trade monitoring
   */
  async updateOpenTradesWithMonitoring(
    openTrades: SimulatedTrade[],
    currentCandle: any,
    candles: any[]
  ): Promise<SimulatedTrade[]> {
    const currentPrice = currentCandle.close;
    const candleTime = new Date(currentCandle.open_time);
    const updatedTrades: SimulatedTrade[] = [];

    for (const trade of openTrades) {
      const isTP = trade.direction === 'buy'
        ? currentPrice >= trade.takeProfit
        : currentPrice <= trade.takeProfit;

      const isSL = trade.direction === 'buy'
        ? currentPrice <= trade.stopLoss
        : currentPrice >= trade.stopLoss;

      const holdingMinutes = Math.floor((candleTime.getTime() - trade.entryTime.getTime()) / 60000);
      const maxDurationExceeded = holdingMinutes >= trade.maxHoldMinutes;

      if (isTP) {
        this.closeTrade(trade, trade.takeProfit, new Date(), 'take_profit');
        continue;
      } else if (isSL) {
        this.closeTrade(trade, trade.stopLoss, new Date(), 'stop_loss');
        continue;
      } else if (maxDurationExceeded) {
        this.closeTrade(trade, currentPrice, new Date(), 'max_duration');
        continue;
      }

      // MID-TRADE MONITORING (if not hitting SL/TP)
      if (this.platformScore && candles.length >= 50) {
        try {
          const marketState = llmSnapshotBuilder.buildMarketState(candles);

          const fullMarketState: FullMarketState = {
            symbol: trade.symbol,
            price: currentPrice,
            ema20: marketState.ema20,
            ema50: marketState.ema50,
            ema200: marketState.ema200,
            rsi: marketState.rsi,
            stochRsi: marketState.stochRsi,
            atr: marketState.atr,
            vwap: marketState.vwap,
            trend: marketState.trend,
            volatility: marketState.volatility,
            momentum: marketState.momentum,
            support: [],
            resistance: [],
            swingHigh: marketState.swingHigh,
            swingLow: marketState.swingLow,
            recentCandles: candles.slice(-20),
            omegaSensors: marketState.omegaSensors
          };

          const midTradeDecision = await alphaOmegaOrchestrator.monitorOpenTrade(
            {
              direction: trade.direction,
              entryPrice: trade.entryPrice,
              stopLoss: trade.stopLoss,
              takeProfit: trade.takeProfit,
              entryTime: trade.entryTime,
              symbol: trade.symbol,
              positionSize: trade.positionSize,
              riskPct: 3
            },
            fullMarketState,
            NEUTRAL_TRADER_SCORE,
            currentPrice,
            currentTime
          );

          if (midTradeDecision) {
            this.applyMidTradeDecision(trade, midTradeDecision, currentPrice, currentTime);

            // If trade was closed, don't add to updatedTrades
            if (midTradeDecision.action === 'CLOSE') {
              continue;
            }
          }
        } catch (error) {
          console.warn('[MidTrade Monitor] Error monitoring trade:', error);
        }
      }

      // Trade still open - add to updated trades
      updatedTrades.push(trade);
    }

    return updatedTrades;
  }

  /**
   * Legacy method for compatibility (calls new method)
   */
  updateOpenTrades(openTrades: SimulatedTrade[], currentCandle: any): SimulatedTrade[] {
    const currentPrice = currentCandle.close;
    const candleTime = new Date(currentCandle.open_time);
    const updatedTrades: SimulatedTrade[] = [];

    for (const trade of openTrades) {
      const isTP = trade.direction === 'buy'
        ? currentPrice >= trade.takeProfit
        : currentPrice <= trade.takeProfit;

      const isSL = trade.direction === 'buy'
        ? currentPrice <= trade.stopLoss
        : currentPrice >= trade.stopLoss;

      const holdingMinutes = Math.floor((candleTime.getTime() - trade.entryTime.getTime()) / 60000);
      const maxDurationExceeded = holdingMinutes >= trade.maxHoldMinutes;

      if (isTP) {
        this.closeTrade(trade, trade.takeProfit, new Date(), 'take_profit');
      } else if (isSL) {
        this.closeTrade(trade, trade.stopLoss, new Date(), 'stop_loss');
      } else if (maxDurationExceeded) {
        this.closeTrade(trade, currentPrice, new Date(), 'max_duration');
      } else {
        updatedTrades.push(trade);
      }
    }

    return updatedTrades;
  }

  /**
   * Apply mid-trade decision (CLOSE, TRAIL_SL, REDUCE_RISK, HOLD)
   */
  private applyMidTradeDecision(
    trade: SimulatedTrade,
    decision: MidTradeDecision,
    currentPrice: number,
    currentTime: Date
  ): void {
    console.log(`[MidTrade] Applying decision: ${decision.action} (${decision.confidence}%)`);
    console.log(`[MidTrade] Reasoning: ${decision.reasoning}`);

    switch (decision.action) {
      case 'CLOSE':
        // Early exit before SL
        console.log(`[MidTrade] \u26a0\ufe0f Closing trade early @ ${currentPrice}`);
        this.closeTrade(trade, currentPrice, new Date(), 'midtrade_exit');
        break;

      case 'TRAIL_SL':
        if (decision.adjustedSL) {
          // Validate new SL is in favorable direction
          const isValidTrail = trade.direction === 'buy'
            ? decision.adjustedSL > trade.stopLoss
            : decision.adjustedSL < trade.stopLoss;

          if (isValidTrail) {
            console.log(`[MidTrade] \ud83d\udc49 Trailing SL: ${trade.stopLoss} \u2192 ${decision.adjustedSL}`);
            trade.stopLoss = decision.adjustedSL;
          } else {
            console.warn(`[MidTrade] \u26d4 Invalid trail direction - rejected`);
          }
        }
        break;

      case 'REDUCE_RISK':
        // Tighten SL toward breakeven
        const currentSLDistance = Math.abs(trade.entryPrice - trade.stopLoss);
        const newSL = trade.direction === 'buy'
          ? trade.entryPrice - (currentSLDistance * 0.5)
          : trade.entryPrice + (currentSLDistance * 0.5);

        console.log(`[MidTrade] \ud83d\udee1\ufe0f Reducing risk: SL ${trade.stopLoss} \u2192 ${newSL}`);
        trade.stopLoss = newSL;
        break;

      case 'HOLD':
      default:
        console.log(`[MidTrade] \ud83d\udc4d Holding trade - setup still valid`);
        break;
    }
  }

  /**
   * Close a trade and calculate PnL
   * Uses currency-specific pip values and dollar-per-pip calculations
   */
  private closeTrade(trade: SimulatedTrade, exitPrice: number, exitTime: Date, exitReason: string): void {
    trade.exitPrice = exitPrice;
    trade.exitTime = exitTime;
    trade.exitReason = exitReason;

    // Get currency-specific pip information
    const pipInfo = getCurrencyPipInfo(trade.symbol);
    const pipValue = pipInfo.pipValue;

    // Calculate pips gained/lost
    let pipsGained = 0;
    if (trade.direction === 'buy') {
      pipsGained = (exitPrice - trade.entryPrice) / pipValue;
    } else {
      pipsGained = (trade.entryPrice - exitPrice) / pipValue;
    }

    // Calculate dollar value per pip for this position size
    const dollarPerPip = calculateDollarPerPip(trade.symbol, trade.positionSize);

    // Calculate final PnL
    trade.pnl = pipsGained * dollarPerPip;

    if (trade.pnl > 0.5) {
      trade.outcome = 'win';
    } else if (trade.pnl < -0.5) {
      trade.outcome = 'loss';
    } else {
      trade.outcome = 'breakeven';
    }

    // Update strategy memory with trade outcome
    if (this.currentStrategyId && this.userId) {
      const holdingMinutes = Math.floor((exitTime.getTime() - trade.entryTime.getTime()) / 60000);

      strategyMemoryService.updateWithTradeOutcome(
        this.currentStrategyId,
        {
          pnl: trade.pnl,
          outcome: trade.outcome,
          holdTimeMinutes: holdingMinutes
        }
      ).catch(error => {
        console.warn('[Event Engine] Failed to update strategy memory:', error);
      });
    }

    trade.holdingMinutes = Math.floor((exitTime.getTime() - trade.entryTime.getTime()) / 60000);

    console.log(
      `[Event Engine] Trade closed: ${trade.outcome.toUpperCase()} - ${trade.direction.toUpperCase()} ${trade.symbol} @ ${trade.entryPrice} -> ${exitPrice}, ` +
      `${pipsGained.toFixed(1)} pips, $${dollarPerPip.toFixed(2)}/pip, PnL: $${trade.pnl.toFixed(2)}, held ${trade.holdingMinutes}min`
    );
  }

  /**
   * Calculate VWAP
   */
  private calculateVWAP(candles: any[]): number {
    let totalPV = 0;
    let totalVolume = 0;

    for (const candle of candles) {
      const typical = (candle.high + candle.low + candle.close) / 3;
      const volume = candle.volume || 1000;
      totalPV += typical * volume;
      totalVolume += volume;
    }

    return totalVolume > 0 ? totalPV / totalVolume : candles[candles.length - 1].close;
  }

  /**
   * Calculate EMA
   */
  private calculateEMA(prices: number[], period: number): number {
    if (prices.length < period) return prices[prices.length - 1] || 0;

    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((sum, p) => sum + p, 0) / period;

    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }

    return ema;
  }

  /**
   * Calculate ATR
   */
  private calculateATR(highs: number[], lows: number[], closes: number[]): number {
    if (highs.length < 2) return 0.001;

    const trs = [];
    for (let i = 1; i < highs.length; i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
      trs.push(tr);
    }

    return trs.reduce((sum, tr) => sum + tr, 0) / trs.length;
  }

  /**
   * Determine trend
   */
  private determineTrend(ema20: number, ema50: number, currentPrice: number): 'bullish' | 'bearish' | 'sideways' {
    if (ema20 > ema50 && currentPrice > ema20) return 'bullish';
    if (ema20 < ema50 && currentPrice < ema20) return 'bearish';
    return 'sideways';
  }

  /**
   * Calculate momentum
   */
  private calculateMomentum(closes: number[]): number {
    if (closes.length < 10) return 50;

    const change = ((closes[closes.length - 1] - closes[closes.length - 10]) / closes[closes.length - 10]) * 100;
    return Math.min(100, Math.max(0, 50 + (change * 10)));
  }

  /**
   * Get session token usage
   */
  getTokenUsage(): number {
    return this.sessionTokenUsage;
  }

  /**
   * Reset session token usage
   */
  resetTokenUsage(): void {
    this.sessionTokenUsage = 0;
  }

  /**
   * Send 5-layer pipeline results to AI conversation
   */
  private async sendPipelineResultsToConversation(
    snapshot: MarketSnapshot,
    trigger: TriggerEvent,
    regimeResult: any,
    qualityResult: any,
    mistakeResult: any,
    calibrationResult: any,
    executionResult: LLMTradeDecision,
    totalDuration: number
  ): Promise<void> {
    if (!this.userId || !this.sessionId) return;

    const isApproved = executionResult.action !== 'NO_TRADE';
    const emoji = isApproved ? '✅' : '🚫';

    const message = `🧠 5-Layer Analysis Complete (${totalDuration}ms)\\n` +
      `✓ Hard Gate: Pattern allowed\\n` +
      `✓ Layer 1: ${regimeResult.regime} / ${regimeResult.volatility} volatility\\n` +
      `✓ Layer 2: Quality ${qualityResult.quality_score}/100 - ${qualityResult.is_high_quality ? 'High quality' : 'Standard'}\\n` +
      `✓ Layer 3: ${mistakeResult.risk_level} risk - ${mistakeResult.mistakes_found === 0 ? 'No issues' : mistakeResult.mistakes_found + ' issues'}\\n` +
      `✓ Layer 4: Confidence ${trigger.confidence}% → ${calibrationResult.calibrated_confidence}% (${calibrationResult.confidence_delta >= 0 ? '+' : ''}${calibrationResult.confidence_delta}%)\\n` +
      `${emoji} Layer 5: ${executionResult.action}`;

    try {
      await SystemTableRPCWrapper.createGoalAIConversation(
        this.userId,
        this.sessionId,
        'ai',
        message,
        0,
        'gpt-4',
        {
          context: {
            pipeline_duration: totalDuration,
            trigger_type: trigger.type,
            final_decision: executionResult.action
          },
          sentiment: isApproved ? 'analytical' : 'cautionary',
          technical_data: {
            regime: regimeResult.regime,
            volatility: regimeResult.volatility,
            quality_score: qualityResult.quality_score,
            confidence_before: trigger.confidence,
            confidence_after: calibrationResult.calibrated_confidence
          },
          market_snapshot: {
            decision: executionResult.action,
            confidence: calibrationResult.calibrated_confidence,
            trend: regimeResult.regime
          }
        }
      );
    } catch (error) {
      console.error('[Pipeline] Error sending to conversation:', error);
    }
  }

  /**
   * Handle trade close and update trader score
   */
  async onTradeClose(trade: SimulatedTrade): Promise<void> {
    if (!this.userId) {
      return;
    }

    const outcome = trade.pnl > 0 ? 'win' : trade.pnl < 0 ? 'loss' : 'breakeven';

    const tradeContext = {
      symbol: trade.symbol,
      direction: trade.direction,
      entry_price: trade.entryPrice,
      exit_price: trade.exitPrice!,
      pnl: trade.pnl,
      risk_amount: 300,
      duration_minutes: trade.holdingMinutes || 0,
      max_drawdown: 0,
      atr: 0,
      outcome
    };

    try {
      const traderScore = await rewardEngine.loadTraderScore(this.userId);

      // Apply reward/penalty (updates platform score + per-user history)
      if (outcome === 'win') {
        const reward = await rewardEngine.applyWinReward(
          this.userId,
          tradeContext,
          traderScore
        );
        console.log(`[Autonomous] Score: ${reward.oldScore} -> ${reward.newScore}`);
      } else if (outcome === 'loss') {
        const penalty = await rewardEngine.applyLossPenalty(
          this.userId,
          tradeContext,
          traderScore
        );
        console.log(`[Autonomous] 📉 Score: ${penalty.oldScore} → ${penalty.newScore}`);
      }

      // Reload platform score after trade outcome
      this.platformScore = await rewardEngine.loadPlatformScore();

      // Analyze performance
      const scoreImpact = await rewardEngine.analyzeScoreImpact(this.userId, tradeContext);
      await performanceAnalyzer.analyzeTradePerformance(
        this.userId,
        tradeContext,
        scoreImpact,
        trade.id
      );

      // Trigger playbook evaluation (check if better variant should be promoted)
      if (trade.playbook_id && this.currentConfig?.symbol && this.currentConfig?.timeframe) {
        try {
          const { strategyPlaybookManager } = await import('./strategy-playbook-manager');
          const { getRegimeBucket } = await import('./regime-bucketing');

          // Get current regime bucket
          const regimeBucket = getRegimeBucket(this.lastRegime, this.lastAdversarial);

          const shouldEvaluate = this.strategyPlanCount > 0 && this.strategyPlanCount % 10 === 0;

          if (shouldEvaluate) {
            console.log(`[Playbook] 🔍 Evaluating playbook promotion for ${this.currentConfig.symbol}/${this.currentConfig.timeframe} in ${regimeBucket}`);
            await strategyPlaybookManager.evaluateAndPromotePlaybooks(
              this.userId,
              this.currentConfig.symbol,
              this.currentConfig.timeframe,
              this.currentStrategy?.mode || 'trend',
              regimeBucket
            );
          }
        } catch (error) {
          console.error('[Autonomous] Failed to evaluate playbooks:', error);
        }
      }
    } catch (error) {
      console.error('[Autonomous] Error updating trader score:', error);
    }
  }

  /**
   * Get detailed condition status with actual values
   */
  private getDetailedConditionStatus(
    conditionCheck: any,
    marketState: any
  ): string {
    const met = conditionCheck.conditionsMet || [];
    const failed = conditionCheck.conditionsFailed || [];
    const total = met.length + failed.length;

    if (total === 0) {
      return '⏳ No conditions to evaluate';
    }

    let status = `📊 Conditions: ${met.length}/${total} met`;

    if (met.length > 0) {
      status += `\n  ✅ ${met.join(', ')}`;
    }

    if (failed.length > 0 && failed.length <= 3) {
      status += `\n  ❌ Waiting: ${failed.join(', ')}`;
    }

    return status;
  }
}

export const eventBasedLLMEngine = new EventBasedLLMEngine();
