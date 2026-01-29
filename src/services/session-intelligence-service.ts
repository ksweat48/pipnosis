/**
 * Session Intelligence Service
 *
 * Data access layer for the Deep Learning Intelligence Dashboard.
 * Provides structured access to session data, trade analysis, layer decisions,
 * and improvement tracking.
 *
 * This service does NOT compute - it FETCHES data that backends have computed.
 */

import { supabase } from '../lib/supabase';

export interface SessionSummary {
  id: string;
  sessionName: string;
  sessionDate: Date;
  dayNumber: number;
  monthNumber: number;
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  pnl: number;
  isProfitable: boolean;
  keyLearnings: string[];
  llmDeepAnalysis?: any;
  improvementsTested?: string[];
}

export interface SessionPair {
  symbol: string;
  confidence: number;
  tradeConfidence: number;
  reasoning: string;
  indicatorAlignment?: {
    vwap: boolean;
    ema20: boolean;
    ema50: boolean;
    rsi: boolean;
    volumePressure: boolean;
    candlePattern: boolean;
    structure: boolean;
    momentum: boolean;
  };
  lastCalculated?: string;
}

export interface TradeIntelligence {
  id: string;
  symbol: string;
  direction: 'buy' | 'sell';
  outcome: 'win' | 'loss' | 'breakeven';
  pnl: number;
  entryTime: Date;
  exitTime: Date;
  entryPrice: number;
  exitPrice?: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  adjustedConfidence?: number;

  // Layer Decisions
  layer1Decision?: any;
  layer2Decision?: any;
  layer3Decision?: any;
  layer4Decision?: any;
  layer5Decision?: any;

  // Adaptive Adjustments
  adjustedRiskPct?: number;
  adjustedSLDistance?: number;
  adjustedTPDistance?: number;
  improvementsApplied?: string[];

  // Forensics
  lossForensics?: any;
  winPattern?: any;

  // Original Analysis
  decisionReasoning: string;
  keyLearnings: string[];
  mistakesIdentified?: string[];
  whatWorked?: string[];
  whatFailed?: string[];
}

export interface ImprovementHypothesis {
  id: string;
  hypothesis: string;
  hypothesisType: string;
  status: 'proposed' | 'testing' | 'validated' | 'rejected' | 'paused';
  llmReasoning?: string;
  createdDate: Date;
  appliedDate?: Date;

  // Before/After Metrics
  beforeWinRate: number;
  afterWinRate: number;
  winRateDelta: number;
  beforeProfitFactor: number;
  afterProfitFactor: number;
  profitFactorDelta: number;
  beforePnl: number;
  afterPnl: number;
  pnlDelta: number;

  // Effectiveness
  effectivenessScore: number;
  sessionsTested: number;
  tradesAffected: number;
}

export interface LayerDecisionTrail {
  layer1: {
    decision: string;
    reasoning: string[];
    blocked: boolean;
    timestamp: string;
  };
  layer2: {
    decision: string;
    regimeConfidence: number;
    reasoning: string[];
    timestamp: string;
  };
  layer3: {
    decision: string;
    adjustments: any;
    graduation: string;
    reasoning: string[];
    similarPatternsCount: number;
    timestamp: string;
  };
  layer4: {
    decision: string;
    warnings: string[];
    reasoning: string[];
    timestamp: string;
  };
  layer5: {
    decision: string;
    finalConfidence: number;
    fullReasoning: string;
    contextUsed: any;
    timestamp: string;
  };
}

class SessionIntelligenceService {
  /**
   * Fetch all sessions for a user (complete history)
   */
  async fetchAllSessions(userId: string, limit: number = 50): Promise<SessionSummary[]> {
    const { data, error } = await supabase
      .from('daily_session_results')
      .select('*')
      .eq('user_id', userId)
      .order('session_date', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[Session Intelligence] Error fetching sessions:', error);
      return [];
    }

    return (data || []).map(session => ({
      id: session.id,
      sessionName: session.session_name,
      sessionDate: new Date(session.session_date),
      dayNumber: session.day_number,
      monthNumber: session.month_number,
      winRate: session.win_rate || 0,
      profitFactor: session.profit_factor || 0,
      totalTrades: session.total_trades || 0,
      winningTrades: session.winning_trades || 0,
      losingTrades: session.losing_trades || 0,
      pnl: session.pnl || 0,
      isProfitable: session.is_profitable || false,
      keyLearnings: session.key_learnings || [],
      llmDeepAnalysis: session.llm_deep_analysis,
      improvementsTested: session.improvements_tested || [],
    }));
  }

  /**
   * Fetch detailed session data (for deep dive)
   */
  async fetchSessionDetail(userId: string, sessionId: string): Promise<SessionSummary | null> {
    const { data, error} = await supabase
      .from('daily_session_results')
      .select('*')
      .eq('user_id', userId)
      .eq('id', sessionId)
      .maybeSingle();

    if (error || !data) {
      console.error('[Session Intelligence] Error fetching session detail:', error);
      return null;
    }

    return {
      id: data.id,
      sessionName: data.session_name,
      sessionDate: new Date(data.session_date),
      dayNumber: data.day_number,
      monthNumber: data.month_number,
      winRate: data.win_rate || 0,
      profitFactor: data.profit_factor || 0,
      totalTrades: data.total_trades || 0,
      winningTrades: data.winning_trades || 0,
      losingTrades: data.losing_trades || 0,
      pnl: data.pnl || 0,
      isProfitable: data.is_profitable || false,
      keyLearnings: data.key_learnings || [],
      llmDeepAnalysis: data.llm_deep_analysis,
      improvementsTested: data.improvements_tested || [],
    };
  }

  /**
   * Fetch all trades for a session
   */
  async fetchSessionTrades(userId: string, sessionDate: Date): Promise<TradeIntelligence[]> {
    const startOfDay = new Date(sessionDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(sessionDate);
    endOfDay.setHours(23, 59, 59, 999);

    const { data, error } = await supabase
      .from('ai_trade_analysis')
      .select('*')
      .eq('user_id', userId)
      .gte('entry_time', startOfDay.toISOString())
      .lte('entry_time', endOfDay.toISOString())
      .order('entry_time', { ascending: true });

    if (error) {
      console.error('[Session Intelligence] Error fetching trades:', error);
      return [];
    }

    return (data || []).map(trade => ({
      id: trade.id,
      symbol: trade.symbol,
      direction: trade.direction,
      outcome: trade.outcome,
      pnl: trade.pnl || 0,
      entryTime: new Date(trade.entry_time),
      exitTime: new Date(trade.exit_time),
      entryPrice: trade.entry_market_conditions?.price || 0,
      exitPrice: trade.exit_market_conditions?.price,
      stopLoss: trade.entry_market_conditions?.stopLoss || 0,
      takeProfit: trade.entry_market_conditions?.takeProfit || 0,
      confidence: trade.entry_confidence || 0,
      adjustedConfidence: trade.adjusted_confidence,
      layer1Decision: trade.layer_1_decision,
      layer2Decision: trade.layer_2_decision,
      layer3Decision: trade.layer_3_decision,
      layer4Decision: trade.layer_4_decision,
      layer5Decision: trade.layer_5_decision,
      adjustedRiskPct: trade.adjusted_risk_pct,
      adjustedSLDistance: trade.adjusted_sl_distance,
      adjustedTPDistance: trade.adjusted_tp_distance,
      improvementsApplied: trade.improvements_applied || [],
      lossForensics: trade.loss_forensics,
      winPattern: trade.win_pattern,
      decisionReasoning: trade.decision_reasoning || '',
      keyLearnings: trade.key_learnings || [],
      mistakesIdentified: trade.mistakes_identified || [],
      whatWorked: trade.what_worked || [],
      whatFailed: trade.what_failed || [],
    }));
  }

  /**
   * Fetch layer decision trail for a specific trade
   */
  extractLayerDecisionTrail(trade: TradeIntelligence): LayerDecisionTrail {
    return {
      layer1: {
        decision: trade.layer1Decision?.decision || 'passed',
        reasoning: trade.layer1Decision?.reasoning || ['No hard gate blocks detected'],
        blocked: trade.layer1Decision?.blocked || false,
        timestamp: trade.layer1Decision?.timestamp || trade.entryTime.toISOString(),
      },
      layer2: {
        decision: trade.layer2Decision?.decision || 'validated',
        regimeConfidence: trade.layer2Decision?.regimeConfidence || 0,
        reasoning: trade.layer2Decision?.reasoning || ['Regime validated'],
        timestamp: trade.layer2Decision?.timestamp || trade.entryTime.toISOString(),
      },
      layer3: {
        decision: trade.layer3Decision?.decision || 'neutral',
        adjustments: trade.layer3Decision?.adjustments || {},
        graduation: trade.layer3Decision?.graduation || 'neutral',
        reasoning: trade.layer3Decision?.reasoning || ['No adjustments needed'],
        similarPatternsCount: trade.layer3Decision?.similarPatterns || 0,
        timestamp: trade.layer3Decision?.timestamp || trade.entryTime.toISOString(),
      },
      layer4: {
        decision: trade.layer4Decision?.decision || 'proceed',
        warnings: trade.layer4Decision?.warnings || [],
        reasoning: trade.layer4Decision?.reasoning || ['No mistakes detected'],
        timestamp: trade.layer4Decision?.timestamp || trade.entryTime.toISOString(),
      },
      layer5: {
        decision: trade.layer5Decision?.decision || 'trade',
        finalConfidence: trade.layer5Decision?.finalConfidence || trade.confidence,
        fullReasoning: trade.layer5Decision?.reasoning || trade.decisionReasoning,
        contextUsed: trade.layer5Decision?.context || {},
        timestamp: trade.layer5Decision?.timestamp || trade.entryTime.toISOString(),
      },
    };
  }

  /**
   * Fetch all improvements for tracking dashboard
   */
  async fetchImprovements(userId: string, status?: string): Promise<ImprovementHypothesis[]> {
    let query = supabase
      .from('improvement_tracking')
      .select('*')
      .eq('user_id', userId)
      .order('created_date', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[Session Intelligence] Error fetching improvements:', error);
      return [];
    }

    return (data || []).map(imp => ({
      id: imp.id,
      hypothesis: imp.hypothesis,
      hypothesisType: imp.hypothesis_type,
      status: imp.status,
      llmReasoning: imp.llm_reasoning,
      createdDate: new Date(imp.created_date),
      appliedDate: imp.applied_date ? new Date(imp.applied_date) : undefined,
      beforeWinRate: imp.before_win_rate || 0,
      afterWinRate: imp.after_win_rate || 0,
      winRateDelta: imp.win_rate_delta || 0,
      beforeProfitFactor: imp.before_profit_factor || 0,
      afterProfitFactor: imp.after_profit_factor || 0,
      profitFactorDelta: imp.profit_factor_delta || 0,
      beforePnl: imp.before_pnl || 0,
      afterPnl: imp.after_pnl || 0,
      pnlDelta: imp.pnl_delta || 0,
      effectivenessScore: imp.effectiveness_score || 0,
      sessionsTested: imp.sessions_tested || 0,
      tradesAffected: imp.trades_affected || 0,
    }));
  }

  /**
   * Fetch active (testing/validated) improvements
   */
  async fetchActiveImprovements(userId: string): Promise<ImprovementHypothesis[]> {
    const { data, error } = await supabase
      .from('improvement_tracking')
      .select('*')
      .eq('user_id', userId)
      .in('status', ['testing', 'validated'])
      .order('applied_date', { ascending: false });

    if (error) {
      console.error('[Session Intelligence] Error fetching active improvements:', error);
      return [];
    }

    return (data || []).map(imp => ({
      id: imp.id,
      hypothesis: imp.hypothesis,
      hypothesisType: imp.hypothesis_type,
      status: imp.status,
      llmReasoning: imp.llm_reasoning,
      createdDate: new Date(imp.created_date),
      appliedDate: imp.applied_date ? new Date(imp.applied_date) : undefined,
      beforeWinRate: imp.before_win_rate || 0,
      afterWinRate: imp.after_win_rate || 0,
      winRateDelta: imp.win_rate_delta || 0,
      beforeProfitFactor: imp.before_profit_factor || 0,
      afterProfitFactor: imp.after_profit_factor || 0,
      profitFactorDelta: imp.profit_factor_delta || 0,
      beforePnl: imp.before_pnl || 0,
      afterPnl: imp.after_pnl || 0,
      pnlDelta: imp.pnl_delta || 0,
      effectivenessScore: imp.effectiveness_score || 0,
      sessionsTested: imp.sessions_tested || 0,
      tradesAffected: imp.trades_affected || 0,
    }));
  }

  /**
   * Get winning trades analysis
   */
  getWinningTrades(trades: TradeIntelligence[]): TradeIntelligence[] {
    return trades.filter(t => t.outcome === 'win');
  }

  /**
   * Get losing trades analysis
   */
  getLosingTrades(trades: TradeIntelligence[]): TradeIntelligence[] {
    return trades.filter(t => t.outcome === 'loss');
  }

  /**
   * Get trades with forensics (losers with analysis)
   */
  getTradesWithForensics(trades: TradeIntelligence[]): TradeIntelligence[] {
    return trades.filter(t => t.lossForensics !== null && t.lossForensics !== undefined);
  }

  /**
   * Get trades with win patterns (winners with analysis)
   */
  getTradesWithWinPatterns(trades: TradeIntelligence[]): TradeIntelligence[] {
    return trades.filter(t => t.winPattern !== null && t.winPattern !== undefined);
  }

  /**
   * Fetch current session intelligence data with trade probability scores
   * SSOT: All session probability data comes through here
   */
  async fetchCurrentSessionIntelligence(sessionName: string): Promise<{ pairs: SessionPair[]; marketCondition: string; istradable: boolean }> {
    try {
      const { data, error } = await supabase
        .from('session_intelligence_data')
        .select('best_pairs, market_condition, is_tradable')
        .eq('session_name', sessionName)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('[Session Intelligence] Error fetching session data:', error);
        return { pairs: [], marketCondition: 'unknown', istradable: false };
      }

      if (!data) {
        return { pairs: [], marketCondition: 'unknown', istradable: false };
      }

      const pairs: SessionPair[] = (data.best_pairs || []).map((pair: any) => ({
        symbol: pair.symbol || '',
        confidence: pair.confidence || 0,
        tradeConfidence: pair.tradeConfidence || pair.confidence || 0,
        reasoning: pair.reasoning || '',
        indicatorAlignment: pair.indicatorAlignment,
        lastCalculated: pair.lastCalculated
      }));

      return {
        pairs,
        marketCondition: data.market_condition || 'unknown',
        istradable: data.is_tradable || false
      };
    } catch (error) {
      console.error('[Session Intelligence] Error fetching session intelligence:', error);
      return { pairs: [], marketCondition: 'unknown', istradable: false };
    }
  }

  /**
   * Get color code for trade confidence percentage
   * Green: 80-100%, Yellow: 70-79%, Orange: 60-69%, Gray: <60%
   */
  getConfidenceColorCode(confidence: number): 'green' | 'yellow' | 'orange' | 'gray' {
    if (confidence >= 80) return 'green';
    if (confidence >= 70) return 'yellow';
    if (confidence >= 60) return 'orange';
    return 'gray';
  }
}

export const sessionIntelligenceService = new SessionIntelligenceService();
