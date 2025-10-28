import { aiTradingEngine, AIAnalysisRequest, AIAnalysisResult, TradeOption } from './ai-trading-engine';
import { simulatedTradingService } from './simulated-trading';
import { promptValidationService, PromptValidationResult } from './prompt-validation';
import { extendedSearchService } from './extended-search';
import { supabase } from '@/lib/supabase';

export interface ManualTradeRequest {
  userId: string;
  prompt: string;
  accountBalance: number;
}

export interface ManualTradeResponse {
  success: boolean;
  decision: any;
  options: TradeOption[];
  marketSummary: any;
  message: string;
  validationError?: {
    message: string;
    details?: string[];
    suggestion?: string;
  };
  extendedSearchSessionId?: string;
  requiresExtendedSearch?: boolean;
}

export interface TradeExecutionRequest {
  userId: string;
  optionId: string;
  decisionId: string;
}

export interface TradeExecutionResponse {
  success: boolean;
  trade?: any;
  message: string;
}

class ManualTradingService {
  async requestTradeAnalysis(request: ManualTradeRequest): Promise<ManualTradeResponse> {
    try {
      const validation = await promptValidationService.validatePrompt(
        request.prompt,
        request.accountBalance
      );

      if (!validation.isValid || !validation.isFeasible) {
        return {
          success: false,
          decision: null,
          options: [],
          marketSummary: null,
          message: validation.errorMessage || 'Request cannot be fulfilled',
          validationError: {
            message: validation.errorMessage || 'This request cannot be fulfilled',
            details: validation.validationDetails?.reasons,
            suggestion: validation.suggestedAlternative
          }
        };
      }

      const userPreferences = await this.getUserTradingPreferences(request.userId);
      const symbols = userPreferences?.preferred_pairs || ['EURUSD', 'XAUUSD', 'GBPUSD', 'US30'];

      const analysisRequest: AIAnalysisRequest = {
        userId: request.userId,
        prompt: request.prompt,
        accountBalance: request.accountBalance,
        decisionType: 'manual',
        symbols,
        timeframe: 'M15'
      };

      const analysisResult = await aiTradingEngine.analyzeTradeRequest(analysisRequest);

      if (analysisResult.options.length === 0) {
        const sessionId = await extendedSearchService.startExtendedSearch(
          request.userId,
          request.prompt,
          request.accountBalance
        );

        return {
          success: true,
          decision: null,
          options: [],
          marketSummary: analysisResult.marketSummary,
          message: 'No immediate trade opportunities found. Extended search initiated (up to 1 hour).',
          requiresExtendedSearch: true,
          extendedSearchSessionId: sessionId
        };
      }

      return {
        success: true,
        decision: analysisResult.decision,
        options: analysisResult.options,
        marketSummary: analysisResult.marketSummary,
        message: `Found ${analysisResult.options.length} trade options for ${analysisResult.decision.symbol}. Select your preferred risk level.`
      };
    } catch (error) {
      console.error('Manual trade analysis failed:', error);

      return {
        success: false,
        decision: null,
        options: [],
        marketSummary: null,
        message: error instanceof Error ? error.message : 'Failed to analyze trade request. Please try again.'
      };
    }
  }

  async executeSelectedTrade(request: TradeExecutionRequest): Promise<TradeExecutionResponse> {
    try {
      const { data: option, error: optionError } = await supabase
        .from('trade_options')
        .select('*')
        .eq('id', request.optionId)
        .eq('user_id', request.userId)
        .single();

      if (optionError || !option) {
        throw new Error('Trade option not found');
      }

      await aiTradingEngine.approveTradeOption(request.optionId, request.userId);

      const tradeResult = await simulatedTradingService.executeTrade(
        {
          symbol: option.symbol,
          action: option.direction.toLowerCase() as 'buy' | 'sell',
          lotSize: option.lot_size,
          entry: option.entry_price,
          stopLoss: option.stop_loss,
          takeProfit: option.take_profit,
          strategy: {
            type: 'ai_manual',
            optionType: option.option_type,
            confidence: option.confidence
          }
        },
        request.userId
      );

      if (!tradeResult.success) {
        throw new Error(tradeResult.message);
      }

      await supabase
        .from('ai_trade_decisions')
        .update({
          executed: true,
          executed_at: new Date().toISOString(),
          trade_id: tradeResult.trade?.id
        })
        .eq('id', request.decisionId)
        .eq('user_id', request.userId);

      await this.recordAILearningMetrics(
        request.userId,
        request.decisionId,
        tradeResult.trade?.id || null,
        option
      );

      return {
        success: true,
        trade: tradeResult.trade,
        message: `Trade executed: ${option.direction} ${option.symbol} ${option.lot_size} lots at ${option.entry_price}`
      };
    } catch (error) {
      console.error('Trade execution failed:', error);

      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to execute trade'
      };
    }
  }

  async getUserTradingPreferences(userId: string) {
    try {
      const { data, error } = await supabase
        .from('user_trading_preferences')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        console.error('Error fetching user preferences:', error);
        return null;
      }

      if (!data) {
        const { data: newPrefs, error: createError } = await supabase
          .from('user_trading_preferences')
          .insert({
            user_id: userId,
            risk_tolerance: 'medium',
            preferred_pairs: ['EURUSD', 'XAUUSD', 'GBPUSD', 'US30'],
            max_position_size: 1.0,
            default_risk_per_trade: 2.0,
            auto_trading_enabled: false,
            min_confidence_threshold: 75,
            allow_ai_override: true,
            allow_hybrid_strategy: true
          })
          .select()
          .single();

        if (createError) {
          console.error('Error creating user preferences:', createError);
          return null;
        }

        return newPrefs;
      }

      return data;
    } catch (error) {
      console.error('Error in getUserTradingPreferences:', error);
      return null;
    }
  }

  async updateUserTradingPreferences(userId: string, preferences: any) {
    try {
      const { error } = await supabase
        .from('user_trading_preferences')
        .upsert({
          user_id: userId,
          ...preferences,
          updated_at: new Date().toISOString()
        });

      if (error) throw error;

      return { success: true };
    } catch (error) {
      console.error('Error updating user preferences:', error);
      return { success: false };
    }
  }

  private async recordAILearningMetrics(
    userId: string,
    decisionId: string,
    tradeId: string | null,
    option: any
  ) {
    try {
      const { data: decision } = await supabase
        .from('ai_trade_decisions')
        .select('*')
        .eq('id', decisionId)
        .single();

      if (!decision) return;

      await supabase
        .from('ai_learning_metrics')
        .insert({
          user_id: userId,
          trade_id: tradeId,
          decision_id: decisionId,
          strategy_used: decision.strategy_used,
          predicted_confidence: option.confidence,
          actual_outcome: 'pending',
          predicted_pnl: option.estimated_profit,
          market_conditions: decision.market_context,
          indicators_used: {
            rsi: decision.market_context?.marketSummary?.rsi,
            vwap: decision.market_context?.marketSummary?.vwap,
            sentiment: decision.market_context?.marketSummary?.sentiment
          }
        });
    } catch (error) {
      console.error('Error recording AI learning metrics:', error);
    }
  }

  async getRecentDecisions(userId: string, limit: number = 10) {
    try {
      const { data, error } = await supabase
        .from('ai_trade_decisions')
        .select('*, trade_options(*)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return data;
    } catch (error) {
      console.error('Error fetching recent decisions:', error);
      return [];
    }
  }

  async cancelPendingDecision(decisionId: string, userId: string) {
    try {
      await supabase
        .from('trade_options')
        .delete()
        .eq('decision_id', decisionId)
        .eq('user_id', userId);

      await supabase
        .from('ai_trade_decisions')
        .delete()
        .eq('id', decisionId)
        .eq('user_id', userId);

      return { success: true };
    } catch (error) {
      console.error('Error canceling decision:', error);
      return { success: false };
    }
  }
}

export const manualTradingService = new ManualTradingService();
