import { supabase } from '../lib/supabase';
import { multiSymbolScanner } from '../strategies/core/multiSymbolScanner';
import { strategyService } from '../strategies';
import { OpportunityRanking } from '../strategies/types';

export interface SearchSession {
  id: string;
  userId: string;
  userPrompt: string;
  searchIntent: 'find_trade' | 'analyze_market' | 'check_signal';
  bias: 'bullish' | 'bearish' | 'any';
  symbols: string[];
  riskTolerance: 'low' | 'medium' | 'high';
  accountBalance: number;
  status: 'active' | 'completed' | 'cancelled' | 'timeout';
  scanCount: number;
  opportunitiesFound: number;
  lastScanTime: Date | null;
  marketConditions: MarketConditionSummary;
  noTradeReasons: string[];
  bestOpportunityId: string | null;
  completionReason: string | null;
  startedAt: Date;
  completedAt: Date | null;
  expiresAt: Date;
}

export interface MarketConditionSummary {
  timestamp: Date;
  overallSentiment: 'bullish' | 'bearish' | 'neutral';
  volatilityLevel: 'low' | 'normal' | 'high';
  symbolConditions: SymbolCondition[];
  reasonsNoTrade: string[];
}

export interface SymbolCondition {
  symbol: string;
  available: boolean;
  reason: string;
  rsi?: number;
  trend?: string;
  volatility?: string;
}

export interface SearchProgress {
  sessionId: string;
  status: 'active' | 'completed' | 'cancelled' | 'timeout';
  scanCount: number;
  elapsedMinutes: number;
  remainingMinutes: number;
  currentConditions: MarketConditionSummary | null;
  bestOpportunity: OpportunityRanking | null;
}

export class ExtendedSearchService {
  private activeSearches: Map<string, NodeJS.Timeout> = new Map();
  private readonly SEARCH_DURATION_MS = 60 * 60 * 1000;
  private readonly SCAN_INTERVAL_MS = 2 * 60 * 1000;

  async startExtendedSearch(
    userId: string,
    prompt: string,
    accountBalance: number
  ): Promise<string> {
    const promptAnalysis = await multiSymbolScanner.analyzePrompt(prompt);

    const { data: session, error } = await supabase
      .from('extended_search_sessions')
      .insert({
        user_id: userId,
        user_prompt: prompt,
        search_intent: promptAnalysis.intent,
        bias: promptAnalysis.bias,
        symbols: promptAnalysis.symbols,
        risk_tolerance: promptAnalysis.riskTolerance,
        account_balance: accountBalance,
        status: 'active',
        scan_count: 0,
        opportunities_found: 0,
        market_conditions: {},
        no_trade_reasons: []
      })
      .select()
      .single();

    if (error || !session) {
      throw new Error('Failed to create search session');
    }

    this.schedulePeriodicScans(session.id, userId, prompt, promptAnalysis);

    return session.id;
  }

  private schedulePeriodicScans(
    sessionId: string,
    userId: string,
    prompt: string,
    promptAnalysis: any
  ): void {
    const scanInterval = setInterval(async () => {
      try {
        const shouldContinue = await this.performScan(sessionId, userId, prompt, promptAnalysis);

        if (!shouldContinue) {
          clearInterval(scanInterval);
          this.activeSearches.delete(sessionId);
        }
      } catch (error) {
        console.error('Scan error:', error);
      }
    }, this.SCAN_INTERVAL_MS);

    this.activeSearches.set(sessionId, scanInterval);

    setTimeout(() => {
      this.completeSearch(sessionId, 'timeout');
      clearInterval(scanInterval);
      this.activeSearches.delete(sessionId);
    }, this.SEARCH_DURATION_MS);
  }

  private async performScan(
    sessionId: string,
    userId: string,
    prompt: string,
    promptAnalysis: any
  ): Promise<boolean> {
    const { data: session } = await supabase
      .from('extended_search_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (!session || session.status !== 'active') {
      return false;
    }

    const opportunities = await multiSymbolScanner.scanAllSymbols(promptAnalysis);

    const marketConditions = await this.analyzeMarketConditions(
      promptAnalysis.symbols,
      opportunities
    );

    const scanCount = (session.scan_count || 0) + 1;

    if (opportunities.length > 0) {
      const bestOpportunity = opportunities[0];

      const signalId = await strategyService.saveSignal(
        userId,
        bestOpportunity.signal,
        'prompt'
      );

      await supabase
        .from('extended_search_sessions')
        .update({
          status: 'completed',
          scan_count: scanCount,
          opportunities_found: opportunities.length,
          last_scan_time: new Date().toISOString(),
          market_conditions: marketConditions,
          best_opportunity_id: signalId,
          completion_reason: `Trade opportunity found: ${bestOpportunity.signal.symbol} ${bestOpportunity.signal.direction} (Confidence: ${bestOpportunity.signal.confidence}%)`,
          completed_at: new Date().toISOString()
        })
        .eq('id', sessionId);

      return false;
    }

    const noTradeReasons = marketConditions.reasonsNoTrade;

    await supabase
      .from('extended_search_sessions')
      .update({
        scan_count: scanCount,
        last_scan_time: new Date().toISOString(),
        market_conditions: marketConditions,
        no_trade_reasons: noTradeReasons
      })
      .eq('id', sessionId);

    return true;
  }

  private async analyzeMarketConditions(
    symbols: string[],
    opportunities: OpportunityRanking[]
  ): Promise<MarketConditionSummary> {
    const symbolConditions: SymbolCondition[] = [];
    const reasonsNoTrade: string[] = [];

    for (const symbol of symbols.slice(0, 5)) {
      const hasOpportunity = opportunities.some(opp => opp.symbol === symbol);

      if (!hasOpportunity) {
        symbolConditions.push({
          symbol,
          available: false,
          reason: 'No valid setup detected'
        });
      } else {
        symbolConditions.push({
          symbol,
          available: true,
          reason: 'Valid opportunity found'
        });
      }
    }

    if (opportunities.length === 0) {
      reasonsNoTrade.push('No symbols passing all three phase validations');
      reasonsNoTrade.push('Market conditions not favorable for high-probability setups');

      if (symbolConditions.every(sc => !sc.available)) {
        reasonsNoTrade.push('All monitored pairs showing weak or conflicting signals');
      }
    }

    const overallSentiment: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    const volatilityLevel: 'low' | 'normal' | 'high' = 'normal';

    return {
      timestamp: new Date(),
      overallSentiment,
      volatilityLevel,
      symbolConditions,
      reasonsNoTrade
    };
  }

  async cancelSearch(sessionId: string): Promise<void> {
    const interval = this.activeSearches.get(sessionId);
    if (interval) {
      clearInterval(interval);
      this.activeSearches.delete(sessionId);
    }

    await supabase
      .from('extended_search_sessions')
      .update({
        status: 'cancelled',
        completion_reason: 'User cancelled search',
        completed_at: new Date().toISOString()
      })
      .eq('id', sessionId)
      .eq('status', 'active');
  }

  async completeSearch(sessionId: string, reason: 'timeout' | 'found' | 'cancelled'): Promise<void> {
    const completionMessages = {
      timeout: 'Search timeout: No valid trades found within 1 hour. Market conditions did not produce high-probability setups matching your criteria.',
      found: 'Trade opportunity found and saved',
      cancelled: 'Search cancelled by user'
    };

    await supabase
      .from('extended_search_sessions')
      .update({
        status: reason === 'found' ? 'completed' : reason,
        completion_reason: completionMessages[reason],
        completed_at: new Date().toISOString()
      })
      .eq('id', sessionId)
      .eq('status', 'active');
  }

  async getSearchProgress(sessionId: string): Promise<SearchProgress | null> {
    const { data: session, error } = await supabase
      .from('extended_search_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (error || !session) {
      return null;
    }

    const startedAt = new Date(session.started_at);
    const now = new Date();
    const elapsedMs = now.getTime() - startedAt.getTime();
    const elapsedMinutes = Math.floor(elapsedMs / (60 * 1000));
    const remainingMinutes = Math.max(0, 60 - elapsedMinutes);

    let bestOpportunity: OpportunityRanking | null = null;
    if (session.best_opportunity_id) {
      const { data: signal } = await supabase
        .from('strategy_signals')
        .select('*')
        .eq('id', session.best_opportunity_id)
        .single();

      if (signal) {
        bestOpportunity = {
          symbol: signal.symbol,
          signal: signal,
          score: signal.confidence,
          reasons: signal.reasoning,
          rank: 1
        } as OpportunityRanking;
      }
    }

    return {
      sessionId: session.id,
      status: session.status,
      scanCount: session.scan_count || 0,
      elapsedMinutes,
      remainingMinutes,
      currentConditions: session.market_conditions as MarketConditionSummary,
      bestOpportunity
    };
  }

  async getActiveSearch(userId: string): Promise<SearchSession | null> {
    const { data: session, error } = await supabase
      .from('extended_search_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !session) {
      return null;
    }

    return {
      id: session.id,
      userId: session.user_id,
      userPrompt: session.user_prompt,
      searchIntent: session.search_intent,
      bias: session.bias,
      symbols: session.symbols,
      riskTolerance: session.risk_tolerance,
      accountBalance: session.account_balance,
      status: session.status,
      scanCount: session.scan_count || 0,
      opportunitiesFound: session.opportunities_found || 0,
      lastScanTime: session.last_scan_time ? new Date(session.last_scan_time) : null,
      marketConditions: session.market_conditions as MarketConditionSummary,
      noTradeReasons: session.no_trade_reasons || [],
      bestOpportunityId: session.best_opportunity_id,
      completionReason: session.completion_reason,
      startedAt: new Date(session.started_at),
      completedAt: session.completed_at ? new Date(session.completed_at) : null,
      expiresAt: new Date(session.expires_at)
    };
  }

  async cleanupExpiredSessions(): Promise<void> {
    const { error } = await supabase.rpc('cleanup_expired_search_sessions');

    if (error) {
      console.error('Failed to cleanup expired sessions:', error);
    }
  }
}

export const extendedSearchService = new ExtendedSearchService();
