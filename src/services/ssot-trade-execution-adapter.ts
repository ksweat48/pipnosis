import { supabase } from '@/lib/supabase';
import { AlphaTradeExecutor } from './alpha-trade-executor';
import { goalAwareLotSizingCoordinator } from './goal-aware-lot-sizing-coordinator';
import { logger } from '@/lib/logger';
import type { AlphaDecision } from '@/types/alpha-decision-contract';
import type { Database } from '@/types/supabase';

type EntryIntent = Database['public']['Tables']['entry_intents']['Row'];

interface ExecutionContext {
  userId: string;
  sessionId: string;
  entryIntent: EntryIntent;
  currentPrice: number;
  marketContext?: {
    volatility?: number;
    atr?: number;
    trend?: string;
  };
}

interface ExecutionResult {
  success: boolean;
  tradeId?: string;
  error?: string;
  reason?: string;
}

export class SSOTTradeExecutionAdapter {
  private executor: AlphaTradeExecutor;

  constructor() {
    this.executor = new AlphaTradeExecutor();
  }

  async executeFromEntryIntent(context: ExecutionContext): Promise<ExecutionResult> {
    const { userId, sessionId, entryIntent, currentPrice, marketContext } = context;

    try {
      logger.info('[SSOTTradeExecutionAdapter] Starting execution', {
        userId,
        sessionId,
        intentId: entryIntent.id,
        symbol: entryIntent.symbol,
      });

      const session = await this.fetchGoalSession(sessionId);
      if (!session) {
        return {
          success: false,
          error: 'Goal session not found',
        };
      }

      const alphaDecision = await this.transformIntentToAlphaDecision(
        entryIntent,
        session,
        currentPrice,
        marketContext
      );

      const lotSize = await this.calculateGoalAwareLotSize(
        userId,
        sessionId,
        entryIntent,
        session,
        alphaDecision
      );

      if (!lotSize || lotSize <= 0) {
        return {
          success: false,
          error: 'Invalid lot size calculated',
        };
      }

      alphaDecision.lot_size = lotSize;

      const result = await this.executor.executeDecision(alphaDecision, userId);

      if (result.success && result.tradeId) {
        await this.createExecutionAudit(userId, sessionId, entryIntent.id, result.tradeId, lotSize);
      }

      return result;
    } catch (error) {
      logger.error('[SSOTTradeExecutionAdapter] Execution failed', { error, userId, sessionId });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown execution error',
      };
    }
  }

  private async fetchGoalSession(sessionId: string) {
    const { data: session, error } = await supabase
      .from('goal_sessions')
      .select('*')
      .eq('id', sessionId)
      .maybeSingle();

    if (error) {
      logger.error('[SSOTTradeExecutionAdapter] Failed to fetch session', { error, sessionId });
      return null;
    }

    return session;
  }

  private async transformIntentToAlphaDecision(
    intent: EntryIntent,
    session: any,
    currentPrice: number,
    marketContext?: ExecutionContext['marketContext']
  ): Promise<AlphaDecision> {
    const thesis = intent.thesis || {
      reasoning: 'Server-side autonomous execution',
      confidence: intent.alpha_confidence || 0.75,
      key_levels: [],
    };

    const direction = intent.direction === 'buy' ? 'long' : 'short';

    const decision: AlphaDecision = {
      user_id: session.user_id,
      session_id: session.id,
      symbol: intent.symbol,
      direction,
      action: 'enter',
      confidence: intent.alpha_confidence || 0.75,
      entry_price: intent.entry_price,
      stop_loss: intent.stop_loss,
      take_profit_1: intent.take_profit_1,
      take_profit_2: intent.take_profit_2 || null,
      lot_size: 0.01,
      reasoning: thesis.reasoning || 'Autonomous entry monitoring execution',
      risk_reward_ratio: this.calculateRiskReward(
        intent.entry_price,
        intent.stop_loss,
        intent.take_profit_1,
        direction
      ),
      thesis_hash: intent.thesis_hash || this.generateThesisHash(intent),
      created_at: new Date().toISOString(),
      omega_votes: null,
      execution_style: intent.trade_style || 'scalp',
    };

    return decision;
  }

  private calculateRiskReward(
    entry: number,
    stopLoss: number,
    takeProfit: number,
    direction: 'long' | 'short'
  ): number {
    if (direction === 'long') {
      const risk = entry - stopLoss;
      const reward = takeProfit - entry;
      return reward / risk;
    } else {
      const risk = stopLoss - entry;
      const reward = entry - takeProfit;
      return reward / risk;
    }
  }

  private generateThesisHash(intent: EntryIntent): string {
    const thesisData = {
      symbol: intent.symbol,
      direction: intent.direction,
      entry: intent.entry_price,
      sl: intent.stop_loss,
      tp1: intent.take_profit_1,
      tp2: intent.take_profit_2,
      reasoning: intent.thesis?.reasoning || 'autonomous',
    };
    return Buffer.from(JSON.stringify(thesisData)).toString('base64').slice(0, 32);
  }

  private async calculateGoalAwareLotSize(
    userId: string,
    sessionId: string,
    intent: EntryIntent,
    session: any,
    decision: AlphaDecision
  ): Promise<number> {
    try {
      const { data: balance } = await supabase
        .from('user_token_balance')
        .select('balance')
        .eq('user_id', userId)
        .maybeSingle();

      if (!balance || !balance.balance) {
        logger.warn('[SSOTTradeExecutionAdapter] No balance found, using minimum lot size', {
          userId,
        });
        return 0.01;
      }

      const risk = Math.abs(decision.entry_price - decision.stop_loss);
      const riskPercentage = session.risk_mode === 'conservative' ? 0.01 : 0.02;
      const riskAmount = balance.balance * riskPercentage;

      const pipValue = this.getPipValue(intent.symbol);
      const lotSize = riskAmount / (risk * pipValue * 100000);

      const finalLotSize = Math.max(0.01, Math.min(lotSize, 1.0));

      await this.logLotSizingDecision(userId, sessionId, decision, finalLotSize, balance.balance);

      return parseFloat(finalLotSize.toFixed(2));
    } catch (error) {
      logger.error('[SSOTTradeExecutionAdapter] Lot sizing calculation failed', {
        error,
        userId,
        sessionId,
      });
      return 0.01;
    }
  }

  private getPipValue(symbol: string): number {
    const pipValues: Record<string, number> = {
      EURUSD: 10,
      GBPUSD: 10,
      USDJPY: 10,
      AUDUSD: 10,
      USDCAD: 10,
      XAUUSD: 1,
      BTCUSD: 10,
      ETHUSD: 10,
    };
    return pipValues[symbol] || 10;
  }

  private async logLotSizingDecision(
    userId: string,
    sessionId: string,
    decision: AlphaDecision,
    lotSize: number,
    balance: number
  ): Promise<void> {
    try {
      const { error } = await supabase.from('goal_aware_lot_sizing_audit').insert({
        user_id: userId,
        session_id: sessionId,
        symbol: decision.symbol,
        direction: decision.direction,
        calculated_lot_size: lotSize,
        balance_at_calculation: balance,
        risk_percentage: decision.confidence * 0.02,
        decision_id: null,
        reasoning: 'Server-side autonomous execution via SSOT adapter',
        metadata: {
          entry_price: decision.entry_price,
          stop_loss: decision.stop_loss,
          take_profit: decision.take_profit_1,
          execution_style: decision.execution_style,
        },
      });

      if (error) {
        logger.warn('[SSOTTradeExecutionAdapter] Failed to log lot sizing audit', { error });
      }
    } catch (error) {
      logger.warn('[SSOTTradeExecutionAdapter] Lot sizing audit exception', { error });
    }
  }

  private async createExecutionAudit(
    userId: string,
    sessionId: string,
    intentId: string,
    tradeId: string,
    lotSize: number
  ): Promise<void> {
    try {
      const { error } = await supabase.from('entry_execution_audit').insert({
        user_id: userId,
        session_id: sessionId,
        entry_intent_id: intentId,
        trade_id: tradeId,
        execution_method: 'server_autonomous',
        lot_size_used: lotSize,
        execution_latency_ms: 0,
        validator_results: {
          ssot_adapter: true,
          alpha_executor: true,
          lot_sizing: true,
        },
        executed_at: new Date().toISOString(),
      });

      if (error) {
        logger.warn('[SSOTTradeExecutionAdapter] Failed to create execution audit', { error });
      }
    } catch (error) {
      logger.warn('[SSOTTradeExecutionAdapter] Execution audit exception', { error });
    }
  }
}

export const ssotTradeExecutionAdapter = new SSOTTradeExecutionAdapter();
