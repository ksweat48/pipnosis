/**
 * Entry Intent Monitor Mode
 *
 * Implements the ENTRY_MONITOR_ACTIVE state with ZERO LLM calls.
 *
 * Key Responsibilities:
 * 1. Run 2-5 second price check loop
 * 2. Calculate deterministic Entry Quality Score (EQS)
 * 3. Detect abandon zone breaches (runaway detection)
 * 4. Execute when conditions are met
 * 5. Abandon and trigger rescan when appropriate
 *
 * State Machine Transitions:
 * - ENTRY_MONITOR_ACTIVE -> EXECUTE_PENDING (when EQS threshold met + price in zone)
 * - ENTRY_MONITOR_ACTIVE -> ABANDONED_RESCAN_REQUESTED (abandon conditions triggered)
 * - EXECUTE_PENDING -> TRADE_ACTIVE (successful order)
 * - EXECUTE_PENDING -> ABANDONED_RESCAN_REQUESTED (order rejected after retries)
 *
 * This service NEVER calls OpenAI. All decisions are deterministic.
 */

import { supabase } from '../lib/supabase';
import { productionLogger } from '../lib/production-logger';
import {
  EntryMonitorQualityScorer,
  createEntryMonitorScorer,
  TradeStyle,
  TradeDirection,
  MarketContext,
  EntryQualityResult,
  CandleData
} from './entry-monitor-quality-scorer';

export type EntryMonitorState =
  | 'DISCOVERY_SCANNING'
  | 'ENTRY_INTENT_CREATED'
  | 'ENTRY_MONITOR_ACTIVE'
  | 'EXECUTE_PENDING'
  | 'TRADE_ACTIVE'
  | 'ABANDONED_RESCAN_REQUESTED';

export type MonitorDecision =
  | 'EXECUTE_NOW'
  | 'CONTINUE_WAITING'
  | 'ABANDON_INTENT_AND_RESCAN';

export type AbandonReason =
  | 'TIMEOUT_EXCEEDED'
  | 'HARD_INVALIDATION_CROSSED'
  | 'RUNAWAY_DETECTED'
  | 'OPPOSITE_DIRECTION_ACCEPTANCE'
  | 'MANUAL_CANCEL'
  | 'ORDER_REJECTED';

export interface EntryIntentData {
  id: string;
  session_id: string;
  user_id: string;
  symbol: string;
  direction: 'long' | 'short';
  entry_zone_min: number;
  entry_zone_max: number;
  abandon_zone_low: number;
  abandon_zone_high: number;
  invalidation_price?: number;
  timeout_at: string;
  max_wait_seconds: number;
  style: TradeStyle;
  atr_at_creation: number;
  consecutive_checks_outside_zone: number;
  market_context?: Record<string, any>;
  alpha_reasoning?: string;
}

export interface MonitorCheckResult {
  timestamp: Date;
  currentPrice: number;
  inEntryZone: boolean;
  inAbandonZone: boolean;
  distanceToZonePips: number;
  eqs: EntryQualityResult | null;
  decision: MonitorDecision;
  abandonReason?: AbandonReason;
  consecutiveOutsideCount: number;
  llmCalled: boolean;
}

interface MonitorCallbacks {
  onExecute: (intentId: string, price: number, eqs: number) => Promise<void>;
  onAbandon: (intentId: string, reason: AbandonReason) => Promise<void>;
  onLog: (intentId: string, log: MonitorCheckResult) => void;
}

const POLL_INTERVAL_MS = 3000;
const CONSECUTIVE_OUTSIDE_THRESHOLD = 3;
const MAX_EXECUTION_RETRIES = 3;

export class EntryIntentMonitorMode {
  private intent: EntryIntentData;
  private scorer: EntryMonitorQualityScorer;
  private callbacks: MonitorCallbacks;
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private consecutiveOutsideCount = 0;
  private lastCheckTime: Date | null = null;

  constructor(intent: EntryIntentData, callbacks: MonitorCallbacks) {
    this.intent = intent;
    this.callbacks = callbacks;

    const direction: TradeDirection = intent.direction === 'long' ? 'BUY' : 'SELL';
    this.scorer = createEntryMonitorScorer(
      intent.style || 'MICRO_INTRADAY',
      direction,
      intent.entry_zone_min,
      intent.entry_zone_max
    );

    this.consecutiveOutsideCount = intent.consecutive_checks_outside_zone || 0;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      productionLogger.warn('[ENTRY_MONITOR] Already running for intent', { intentId: this.intent.id });
      return;
    }

    productionLogger.info('[ENTRY_MONITOR] Starting monitor', {
      intentId: this.intent.id,
      symbol: this.intent.symbol,
      direction: this.intent.direction,
      entryZone: [this.intent.entry_zone_min, this.intent.entry_zone_max],
      abandonZone: [this.intent.abandon_zone_low, this.intent.abandon_zone_high]
    });

    this.isRunning = true;

    await this.updateSessionState('ENTRY_MONITOR_ACTIVE');

    await this.runCheck();

    this.intervalId = setInterval(async () => {
      if (this.isRunning) {
        await this.runCheck();
      }
    }, POLL_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    productionLogger.info('[ENTRY_MONITOR] Stopping monitor', { intentId: this.intent.id });
    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async runCheck(): Promise<void> {
    try {
      const result = await this.performCheck();
      this.callbacks.onLog(this.intent.id, result);

      await this.persistCheckResult(result);

      switch (result.decision) {
        case 'EXECUTE_NOW':
          await this.handleExecute(result);
          break;
        case 'ABANDON_INTENT_AND_RESCAN':
          await this.handleAbandon(result.abandonReason!);
          break;
        case 'CONTINUE_WAITING':
        default:
          break;
      }
    } catch (error) {
      productionLogger.error('[ENTRY_MONITOR] Check failed', {
        intentId: this.intent.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async performCheck(): Promise<MonitorCheckResult> {
    this.lastCheckTime = new Date();

    const currentPrice = await this.fetchCurrentPrice();
    const candles = await this.fetchRecentCandles();
    const marketContext = this.buildMarketContext(currentPrice, candles);

    const inEntryZone = this.isPriceInEntryZone(currentPrice);
    const inAbandonZone = this.isPriceInAbandonZone(currentPrice);
    const distanceToZonePips = this.calculateDistanceToZone(currentPrice);

    if (this.isTimeoutExceeded()) {
      return this.createResult(currentPrice, inEntryZone, inAbandonZone, distanceToZonePips, null, 'ABANDON_INTENT_AND_RESCAN', 'TIMEOUT_EXCEEDED');
    }

    if (this.isHardInvalidationCrossed(currentPrice)) {
      return this.createResult(currentPrice, inEntryZone, inAbandonZone, distanceToZonePips, null, 'ABANDON_INTENT_AND_RESCAN', 'HARD_INVALIDATION_CROSSED');
    }

    const runawayResult = this.checkRunaway(currentPrice, inEntryZone);
    if (runawayResult.isRunaway) {
      return this.createResult(currentPrice, inEntryZone, inAbandonZone, distanceToZonePips, null, 'ABANDON_INTENT_AND_RESCAN', 'RUNAWAY_DETECTED');
    }

    if (this.detectOppositeDirectionAcceptance(candles)) {
      return this.createResult(currentPrice, inEntryZone, inAbandonZone, distanceToZonePips, null, 'ABANDON_INTENT_AND_RESCAN', 'OPPOSITE_DIRECTION_ACCEPTANCE');
    }

    let eqs: EntryQualityResult | null = null;
    let decision: MonitorDecision = 'CONTINUE_WAITING';

    if (inEntryZone || distanceToZonePips < 5) {
      eqs = this.scorer.calculate(marketContext);

      if (eqs.executionReady) {
        decision = 'EXECUTE_NOW';
      }
    }

    return this.createResult(currentPrice, inEntryZone, inAbandonZone, distanceToZonePips, eqs, decision);
  }

  private createResult(
    currentPrice: number,
    inEntryZone: boolean,
    inAbandonZone: boolean,
    distanceToZonePips: number,
    eqs: EntryQualityResult | null,
    decision: MonitorDecision,
    abandonReason?: AbandonReason
  ): MonitorCheckResult {
    return {
      timestamp: new Date(),
      currentPrice,
      inEntryZone,
      inAbandonZone,
      distanceToZonePips,
      eqs,
      decision,
      abandonReason,
      consecutiveOutsideCount: this.consecutiveOutsideCount,
      llmCalled: false
    };
  }

  private isPriceInEntryZone(price: number): boolean {
    return price >= this.intent.entry_zone_min && price <= this.intent.entry_zone_max;
  }

  private isPriceInAbandonZone(price: number): boolean {
    const direction = this.intent.direction;

    if (direction === 'long') {
      return price > this.intent.abandon_zone_high;
    } else {
      return price < this.intent.abandon_zone_low;
    }
  }

  private calculateDistanceToZone(price: number): number {
    const pipMultiplier = this.getPipMultiplier();

    if (price < this.intent.entry_zone_min) {
      return (this.intent.entry_zone_min - price) * pipMultiplier;
    } else if (price > this.intent.entry_zone_max) {
      return (price - this.intent.entry_zone_max) * pipMultiplier;
    }

    return 0;
  }

  private getPipMultiplier(): number {
    const symbol = this.intent.symbol.toUpperCase();
    if (symbol.includes('JPY')) return 100;
    if (symbol.includes('XAU')) return 10;
    if (symbol.includes('BTC') || symbol.includes('ETH')) return 1;
    return 10000;
  }

  private isTimeoutExceeded(): boolean {
    const timeoutAt = new Date(this.intent.timeout_at);
    return new Date() > timeoutAt;
  }

  private isHardInvalidationCrossed(price: number): boolean {
    if (!this.intent.invalidation_price) return false;

    const direction = this.intent.direction;
    if (direction === 'long') {
      return price < this.intent.invalidation_price;
    } else {
      return price > this.intent.invalidation_price;
    }
  }

  private checkRunaway(price: number, inEntryZone: boolean): { isRunaway: boolean } {
    const inAbandonZone = this.isPriceInAbandonZone(price);

    if (inEntryZone) {
      this.consecutiveOutsideCount = 0;
      return { isRunaway: false };
    }

    if (inAbandonZone) {
      this.consecutiveOutsideCount++;

      if (this.consecutiveOutsideCount >= CONSECUTIVE_OUTSIDE_THRESHOLD) {
        productionLogger.warn('[ENTRY_MONITOR] Runaway detected', {
          intentId: this.intent.id,
          price,
          consecutiveChecks: this.consecutiveOutsideCount,
          abandonZone: this.intent.direction === 'long'
            ? `> ${this.intent.abandon_zone_high}`
            : `< ${this.intent.abandon_zone_low}`
        });
        return { isRunaway: true };
      }
    } else {
      this.consecutiveOutsideCount = Math.max(0, this.consecutiveOutsideCount - 1);
    }

    return { isRunaway: false };
  }

  private detectOppositeDirectionAcceptance(candles: CandleData[]): boolean {
    if (candles.length < 3) return false;

    const recent = candles.slice(-3);
    const direction = this.intent.direction;

    let oppositeCloses = 0;
    let totalBodyDominance = 0;
    let rangeExpansion = false;

    for (const candle of recent) {
      const isBullish = candle.close > candle.open;
      const isOpposite = (direction === 'long' && !isBullish) || (direction === 'short' && isBullish);

      if (isOpposite) {
        oppositeCloses++;
        const range = candle.high - candle.low;
        const body = Math.abs(candle.close - candle.open);
        totalBodyDominance += range > 0 ? body / range : 0;
      }
    }

    if (recent.length >= 2) {
      const prevRange = recent[0].high - recent[0].low;
      const lastRange = recent[recent.length - 1].high - recent[recent.length - 1].low;
      rangeExpansion = lastRange > prevRange * 1.5;
    }

    const avgBodyDominance = oppositeCloses > 0 ? totalBodyDominance / oppositeCloses : 0;

    return oppositeCloses >= 2 && avgBodyDominance > 0.6 && rangeExpansion;
  }

  private async fetchCurrentPrice(): Promise<number> {
    const { data, error } = await supabase
      .from('realtime_prices')
      .select('bid, ask')
      .eq('symbol', this.intent.symbol)
      .maybeSingle();

    if (error || !data) {
      productionLogger.warn('[ENTRY_MONITOR] Failed to fetch price, using fallback', {
        symbol: this.intent.symbol,
        error: error?.message
      });
      return this.intent.market_context?.currentPrice || this.intent.entry_zone_min;
    }

    return (data.bid + data.ask) / 2;
  }

  private async fetchRecentCandles(): Promise<CandleData[]> {
    const { data, error } = await supabase
      .from('candle_cache')
      .select('open, high, low, close, volume, time')
      .eq('symbol', this.intent.symbol)
      .eq('timeframe', 'M5')
      .order('time', { ascending: false })
      .limit(10);

    if (error || !data || data.length === 0) {
      return [];
    }

    return data.reverse().map(c => ({
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: Number(c.volume || 0),
      time: c.time
    }));
  }

  private buildMarketContext(currentPrice: number, candles: CandleData[]): MarketContext {
    const stored = this.intent.market_context || {};

    return {
      currentPrice,
      vwap: stored.vwap,
      ema20: stored.ema20,
      ema50: stored.ema50,
      ema200: stored.ema200,
      atr: this.intent.atr_at_creation || stored.atr || 0.001,
      recentCandles: candles,
      m15SupportResistance: stored.m15_levels
    };
  }

  private async handleExecute(result: MonitorCheckResult): Promise<void> {
    productionLogger.info('[ENTRY_MONITOR] Executing trade', {
      intentId: this.intent.id,
      symbol: this.intent.symbol,
      price: result.currentPrice,
      eqs: result.eqs?.score
    });

    await this.updateSessionState('EXECUTE_PENDING');
    await this.stop();
    await this.callbacks.onExecute(this.intent.id, result.currentPrice, result.eqs?.score || 0);
  }

  private async handleAbandon(reason: AbandonReason): Promise<void> {
    productionLogger.info('[ENTRY_MONITOR] Abandoning intent', {
      intentId: this.intent.id,
      symbol: this.intent.symbol,
      reason
    });

    await this.updateSessionState('ABANDONED_RESCAN_REQUESTED');
    await this.stop();
    await this.callbacks.onAbandon(this.intent.id, reason);
  }

  private async persistCheckResult(result: MonitorCheckResult): Promise<void> {
    try {
      await supabase
        .from('entry_monitor_logs')
        .insert({
          intent_id: this.intent.id,
          session_id: this.intent.session_id,
          user_id: this.intent.user_id,
          current_price: result.currentPrice,
          in_entry_zone: result.inEntryZone,
          distance_to_zone_pips: result.distanceToZonePips,
          in_abandon_zone: result.inAbandonZone,
          abandon_zone_check_result: result.abandonReason || null,
          entry_quality_score: result.eqs?.score || null,
          eqs_breakdown: result.eqs?.breakdown || null,
          consecutive_outside_count: result.consecutiveOutsideCount,
          decision: result.decision,
          decision_reason: result.abandonReason || result.eqs?.reasoning || null,
          llm_called: false
        });

      await supabase
        .from('entry_intents')
        .update({
          consecutive_checks_outside_zone: result.consecutiveOutsideCount,
          last_price_check_at: new Date().toISOString(),
          entry_quality_score: result.eqs?.score || null,
          eqs_breakdown: result.eqs?.breakdown || null
        })
        .eq('id', this.intent.id);
    } catch (error) {
      productionLogger.error('[ENTRY_MONITOR] Failed to persist check result', {
        intentId: this.intent.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async updateSessionState(state: EntryMonitorState): Promise<void> {
    try {
      const { error } = await supabase.rpc('transition_entry_monitor_state', {
        p_session_id: this.intent.session_id,
        p_new_state: state,
        p_locked_symbol: this.intent.symbol,
        p_locked_direction: this.intent.direction === 'long' ? 'BUY' : 'SELL'
      });

      if (error) {
        productionLogger.error('[ENTRY_MONITOR] Failed to update session state', {
          sessionId: this.intent.session_id,
          newState: state,
          error: error.message
        });
      }
    } catch (error) {
      productionLogger.error('[ENTRY_MONITOR] State transition failed', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

export function calculateAbandonZone(
  entryZoneMin: number,
  entryZoneMax: number,
  atr: number
): { abandonZoneLow: number; abandonZoneHigh: number } {
  const entryZoneWidth = entryZoneMax - entryZoneMin;
  const buffer = Math.max(atr * 0.3, entryZoneWidth * 0.5);

  return {
    abandonZoneLow: entryZoneMin - buffer,
    abandonZoneHigh: entryZoneMax + buffer
  };
}

export async function createEntryIntentWithMonitoring(
  sessionId: string,
  userId: string,
  symbol: string,
  direction: 'long' | 'short',
  entryZoneMin: number,
  entryZoneMax: number,
  stopLoss: number,
  takeProfit: number,
  atr: number,
  style: TradeStyle,
  maxWaitSeconds: number,
  alphaReasoning: string,
  marketContext: Record<string, any>
): Promise<EntryIntentData | null> {
  const { abandonZoneLow, abandonZoneHigh } = calculateAbandonZone(entryZoneMin, entryZoneMax, atr);

  const timeoutAt = new Date(Date.now() + maxWaitSeconds * 1000).toISOString();

  const { data, error } = await supabase
    .from('entry_intents')
    .insert({
      session_id: sessionId,
      user_id: userId,
      symbol,
      direction,
      entry_zone_min: entryZoneMin,
      entry_zone_max: entryZoneMax,
      abandon_zone_low: abandonZoneLow,
      abandon_zone_high: abandonZoneHigh,
      invalidation_price: stopLoss,
      timeout_at: timeoutAt,
      max_wait_seconds: maxWaitSeconds,
      style,
      atr_at_creation: atr,
      consecutive_checks_outside_zone: 0,
      status: 'monitoring',
      alpha_reasoning: alphaReasoning,
      market_context: {
        ...marketContext,
        stopLoss,
        takeProfit
      }
    })
    .select()
    .single();

  if (error || !data) {
    productionLogger.error('[ENTRY_MONITOR] Failed to create entry intent', {
      sessionId,
      symbol,
      error: error?.message
    });
    return null;
  }

  productionLogger.info('[ENTRY_MONITOR] Entry intent created', {
    intentId: data.id,
    symbol,
    direction,
    entryZone: [entryZoneMin, entryZoneMax],
    abandonZone: [abandonZoneLow, abandonZoneHigh],
    timeoutAt
  });

  return data as EntryIntentData;
}

export async function getActiveEntryIntent(sessionId: string): Promise<EntryIntentData | null> {
  const { data, error } = await supabase
    .from('entry_intents')
    .select('*')
    .eq('session_id', sessionId)
    .eq('status', 'monitoring')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as EntryIntentData;
}

export async function cancelEntryIntent(intentId: string, reason: string): Promise<void> {
  await supabase
    .from('entry_intents')
    .update({
      status: 'canceled',
      canceled_at: new Date().toISOString(),
      canceled_reason: reason
    })
    .eq('id', intentId);
}

export async function markIntentExecuted(intentId: string, actualPrice: number): Promise<void> {
  await supabase
    .from('entry_intents')
    .update({
      status: 'executed',
      executed_at: new Date().toISOString(),
      actual_entry_price: actualPrice
    })
    .eq('id', intentId);
}
