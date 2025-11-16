import { supabase } from '../lib/supabase';
import { enhancedMarketRegimeDetector } from './enhanced-market-regime-detector';
import { economicCalendarService } from './economic-calendar-service';
import { currencyCorrelationService } from './currency-correlation-service';

/**
 * Loss Forensics Engine
 *
 * Deep forensic analysis of every losing trade to:
 * - Categorize loss types (false breakout, premature entry, etc.)
 * - Identify pre-trade red flags that should have prevented the trade
 * - Extract actionable lessons
 * - Create anti-patterns to avoid
 * - Generate prevention rules
 *
 * Professional Insight: Elite traders learn more from losses than wins.
 * One avoided loss preserves capital for 3 winning trades.
 */

export interface LossForensics {
  tradeId: string;
  symbol: string;
  direction: 'buy' | 'sell';
  entryTime: Date;
  exitTime: Date;
  pnl: number;

  // Loss Classification
  lossType: 'false_breakout' | 'premature_entry' | 'late_entry' | 'stop_too_tight' |
            'ignored_divergence' | 'news_event' | 'poor_timing' | 'wrong_regime' |
            'overtrading' | 'revenge_trading' | 'fomo' | 'technical_failure';

  // Red Flags
  redFlags: string[];
  redFlagCount: number;
  shouldHaveSkipped: boolean;

  // Context at Entry
  marketRegimeAtEntry: string;
  volatilityAtEntry: string;
  sessionAtEntry: string;
  newsEventsNearby: string[];
  correlationRiskScore: number;

  // Technical Analysis
  stopLossQuality: 'too_tight' | 'appropriate' | 'too_wide';
  entryQualityScore: number;
  timeframeAlignment: boolean;
  indicatorDivergence: boolean;

  // Lessons
  primaryMistake: string;
  secondaryMistakes: string[];
  actionableLesson: string;
  antiPatternCreated: string;

  // Prevention
  preventionRule: string;
  automatedFilterSuggestion: string;
}

export interface AntiPattern {
  name: string;
  description: string;
  occurrences: number;
  avgLoss: number;
  preventionRule: string;
  affectedSymbols: string[];
}

class LossForensicsEngine {
  private readonly LOSS_TYPES = {
    false_breakout: 'Price broke through level then immediately reversed',
    premature_entry: 'Entered before proper confirmation',
    late_entry: 'Entered after the move was exhausted',
    stop_too_tight: 'Stop loss hit by normal volatility',
    ignored_divergence: 'Traded against divergence signal',
    news_event: 'Traded during or near high-impact news',
    poor_timing: 'Wrong time of day or session for this setup',
    wrong_regime: 'Setup requires different market regime',
    overtrading: 'Too many trades in short period',
    revenge_trading: 'Trade taken to recover previous loss',
    fomo: 'Fear of missing out - chased the move',
    technical_failure: 'Strategy execution failed technically'
  };

  /**
   * Perform forensic analysis on a losing trade
   */
  async analyzeLoss(
    userId: string,
    tradeId: string
  ): Promise<LossForensics | null> {
    console.log(`[Loss Forensics] Analyzing trade ${tradeId}...`);

    // Fetch trade data
    const { data: trade, error } = await supabase
      .from('ai_trade_analysis')
      .select('*')
      .eq('id', tradeId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !trade || trade.outcome !== 'loss') {
      console.log('[Loss Forensics] Trade not found or not a loss');
      return null;
    }

    // Gather context
    const entryTime = new Date(trade.entry_time);
    const exitTime = new Date(trade.exit_time);

    // Get market context at entry
    const marketContext = await this.getMarketContextAtEntry(
      userId,
      trade.symbol,
      entryTime
    );

    // Check for news events
    const newsEvents = await this.checkNewsEventsNearby(trade.symbol, entryTime);

    // Calculate correlation risk
    const correlationRisk = await this.calculateCorrelationRiskAtEntry(
      userId,
      trade.symbol,
      entryTime
    );

    // Detect red flags
    const redFlags = this.detectRedFlags(trade, marketContext, newsEvents, correlationRisk);

    // Classify loss type
    const lossType = this.classifyLossType(trade, redFlags, marketContext);

    // Analyze stop loss quality
    const stopLossQuality = this.analyzeStopLoss(trade);

    // Calculate entry quality
    const entryQualityScore = this.calculateEntryQuality(trade, marketContext, redFlags);

    // Extract lessons
    const { primaryMistake, secondaryMistakes, actionableLesson, preventionRule } =
      this.extractLessons(lossType, redFlags, trade, marketContext);

    // Create anti-pattern
    const antiPatternCreated = this.createAntiPattern(lossType, trade, marketContext);

    // Generate automated filter suggestion
    const automatedFilterSuggestion = this.suggestAutomatedFilter(redFlags, marketContext);

    const forensics: LossForensics = {
      tradeId: trade.id,
      symbol: trade.symbol,
      direction: trade.direction,
      entryTime,
      exitTime,
      pnl: parseFloat(trade.pnl.toString()),
      lossType,
      redFlags,
      redFlagCount: redFlags.length,
      shouldHaveSkipped: redFlags.length >= 2,
      marketRegimeAtEntry: marketContext.regime || 'unknown',
      volatilityAtEntry: marketContext.volatility || 'unknown',
      sessionAtEntry: marketContext.session || 'unknown',
      newsEventsNearby: newsEvents,
      correlationRiskScore: correlationRisk,
      stopLossQuality,
      entryQualityScore,
      timeframeAlignment: trade.timeframe_alignment || false,
      indicatorDivergence: false, // Would need indicator data
      primaryMistake,
      secondaryMistakes,
      actionableLesson,
      antiPatternCreated,
      preventionRule,
      automatedFilterSuggestion
    };

    // Save to database
    await this.saveForensics(userId, forensics);

    console.log(`[Loss Forensics] Analysis complete: ${lossType} | ${redFlags.length} red flags`);

    return forensics;
  }

  /**
   * Get all anti-patterns for a user
   */
  async getAntiPatterns(userId: string): Promise<AntiPattern[]> {
    const { data, error } = await supabase
      .from('loss_forensics')
      .select('*')
      .eq('user_id', userId);

    if (error || !data) {
      return [];
    }

    // Group by anti-pattern
    const patternGroups: Record<string, any[]> = {};

    data.forEach(forensic => {
      const pattern = forensic.anti_pattern_created;
      if (pattern && pattern !== 'None') {
        if (!patternGroups[pattern]) {
          patternGroups[pattern] = [];
        }
        patternGroups[pattern].push(forensic);
      }
    });

    // Create anti-pattern summaries
    const antiPatterns: AntiPattern[] = [];

    for (const [name, forensics] of Object.entries(patternGroups)) {
      const occurrences = forensics.length;
      const avgLoss = forensics.reduce((sum, f) => sum + Math.abs(parseFloat(f.pnl.toString())), 0) / occurrences;
      const affectedSymbols = [...new Set(forensics.map(f => f.symbol))];
      const preventionRule = forensics[0].prevention_rule;

      antiPatterns.push({
        name,
        description: this.getAntiPatternDescription(name),
        occurrences,
        avgLoss,
        preventionRule,
        affectedSymbols
      });
    }

    return antiPatterns.sort((a, b) => b.occurrences - a.occurrences);
  }

  /**
   * Check if trade should be avoided based on anti-patterns
   */
  async checkAgainstAntiPatterns(
    userId: string,
    symbol: string,
    direction: 'buy' | 'sell',
    currentContext: any
  ): Promise<{ shouldAvoid: boolean; matchedAntiPatterns: string[]; warnings: string[] }> {
    const antiPatterns = await this.getAntiPatterns(userId);
    const matchedAntiPatterns: string[] = [];
    const warnings: string[] = [];

    for (const pattern of antiPatterns) {
      if (this.doesTradeMatchAntiPattern(pattern, symbol, direction, currentContext)) {
        matchedAntiPatterns.push(pattern.name);
        warnings.push(`⚠️ ${pattern.name}: ${pattern.description} (Occurred ${pattern.occurrences} times, avg loss: $${pattern.avgLoss.toFixed(2)})`);
      }
    }

    const shouldAvoid = matchedAntiPatterns.length >= 2 ||
                        (matchedAntiPatterns.length === 1 && antiPatterns.find(p => p.name === matchedAntiPatterns[0])!.occurrences >= 5);

    return {
      shouldAvoid,
      matchedAntiPatterns,
      warnings
    };
  }

  /**
   * Get market context at trade entry
   */
  private async getMarketContextAtEntry(
    userId: string,
    symbol: string,
    entryTime: Date
  ): Promise<{ regime?: string; volatility?: string; session?: string }> {
    // Try to get regime from history
    const { data, error } = await supabase
      .from('market_regime_history')
      .select('*')
      .eq('user_id', userId)
      .eq('symbol', symbol)
      .lte('detected_at', entryTime.toISOString())
      .order('detected_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return {
        session: this.detectSession(entryTime)
      };
    }

    return {
      regime: data.regime_type,
      volatility: data.volatility_level,
      session: data.session_type
    };
  }

  /**
   * Check for news events nearby
   */
  private async checkNewsEventsNearby(symbol: string, entryTime: Date): Promise<string[]> {
    const analysis = await economicCalendarService.analyzeEventImpact(symbol, 60);

    return analysis.upcomingEvents.map(event =>
      `${event.eventName} (${event.impactLevel}) at ${event.eventTime.toISOString()}`
    );
  }

  /**
   * Calculate correlation risk at entry
   */
  private async calculateCorrelationRiskAtEntry(
    userId: string,
    symbol: string,
    entryTime: Date
  ): Promise<number> {
    // Check if user had other open positions at entry time
    const { data: openTrades, error } = await supabase
      .from('ai_trade_analysis')
      .select('symbol, direction')
      .eq('user_id', userId)
      .lte('entry_time', entryTime.toISOString())
      .gte('exit_time', entryTime.toISOString());

    if (error || !openTrades || openTrades.length === 0) {
      return 0;
    }

    // Calculate correlation risk
    const positions = openTrades.map(t => ({
      symbol: t.symbol,
      direction: t.direction,
      size: 1
    }));

    const riskMultiplier = await currencyCorrelationService.calculatePortfolioRisk(positions);

    // Convert to 0-100 score
    return Math.min(100, (riskMultiplier - 1) * 100);
  }

  /**
   * Detect red flags
   */
  private detectRedFlags(
    trade: any,
    marketContext: any,
    newsEvents: string[],
    correlationRisk: number
  ): string[] {
    const flags: string[] = [];

    // News event nearby
    if (newsEvents.length > 0) {
      flags.push('High-impact news event within 60 minutes');
    }

    // Wrong session
    if (marketContext.session === 'asian' && trade.setup_type?.includes('breakout')) {
      flags.push('Breakout strategy during low-volatility Asian session');
    }

    // Wrong volatility
    if (marketContext.volatility === 'low' && trade.setup_type?.includes('momentum')) {
      flags.push('Momentum strategy during low volatility');
    }

    // High correlation risk
    if (correlationRisk > 70) {
      flags.push(`High correlation risk (${correlationRisk.toFixed(0)}%) - too many correlated positions`);
    }

    // Low confidence
    if (trade.confidence && trade.confidence < 60) {
      flags.push(`Low setup confidence (${trade.confidence}%)`);
    }

    // Poor risk-reward
    if (trade.risk_reward && trade.risk_reward < 1.5) {
      flags.push(`Poor risk-reward ratio (${trade.risk_reward.toFixed(2)}:1)`);
    }

    // No timeframe alignment
    if (!trade.timeframe_alignment) {
      flags.push('Timeframes not aligned');
    }

    return flags;
  }

  /**
   * Classify loss type
   */
  private classifyLossType(
    trade: any,
    redFlags: string[],
    marketContext: any
  ): LossForensics['lossType'] {
    // Check for specific patterns
    if (redFlags.some(f => f.includes('news event'))) {
      return 'news_event';
    }

    if (redFlags.some(f => f.includes('Asian session'))) {
      return 'wrong_regime';
    }

    if (redFlags.some(f => f.includes('Low setup confidence'))) {
      return 'premature_entry';
    }

    if (redFlags.some(f => f.includes('correlation risk'))) {
      return 'overtrading';
    }

    // Default based on exit reason
    const exitReason = trade.exit_reason?.toLowerCase() || '';

    if (exitReason.includes('stop')) {
      return 'stop_too_tight';
    }

    if (exitReason.includes('reversal')) {
      return 'false_breakout';
    }

    return 'technical_failure';
  }

  /**
   * Analyze stop loss quality
   */
  private analyzeStopLoss(trade: any): 'too_tight' | 'appropriate' | 'too_wide' {
    if (!trade.stop_loss || !trade.entry_price) {
      return 'appropriate';
    }

    const stopDistance = Math.abs(trade.entry_price - trade.stop_loss);
    const pricePercent = (stopDistance / trade.entry_price) * 100;

    if (pricePercent < 0.3) return 'too_tight';
    if (pricePercent > 2.0) return 'too_wide';
    return 'appropriate';
  }

  /**
   * Calculate entry quality score
   */
  private calculateEntryQuality(
    trade: any,
    marketContext: any,
    redFlags: string[]
  ): number {
    let score = 100;

    // Deduct points for red flags
    score -= redFlags.length * 15;

    // Deduct for wrong regime
    if (marketContext.regime === 'ranging' && trade.setup_type?.includes('breakout')) {
      score -= 20;
    }

    // Deduct for poor timing
    if (marketContext.session === 'asian') {
      score -= 10;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Extract lessons from loss
   */
  private extractLessons(
    lossType: string,
    redFlags: string[],
    trade: any,
    marketContext: any
  ): {
    primaryMistake: string;
    secondaryMistakes: string[];
    actionableLesson: string;
    preventionRule: string;
  } {
    const lessons = {
      false_breakout: {
        primary: 'Entered breakout without proper confirmation',
        actionable: 'Wait for 2-3 candle confirmation after breakout before entry',
        prevention: 'No breakout trades without 3-candle confirmation'
      },
      news_event: {
        primary: 'Traded during high-impact news event',
        actionable: 'Check economic calendar before every trade. Avoid 30min before and 15min after high-impact news',
        prevention: 'Auto-block trades 30 minutes before medium/high impact news'
      },
      wrong_regime: {
        primary: `Strategy (${trade.setup_type}) mismatched with market regime (${marketContext.regime})`,
        actionable: 'Only trade breakouts during trending markets. Only trade ranges during ranging markets',
        prevention: 'Require regime confirmation before trade execution'
      },
      overtrading: {
        primary: 'Too many correlated positions or trades in short period',
        actionable: 'Limit to 3 trades per session. Check correlation before opening new position',
        prevention: 'Max 3 trades per 4 hours. Max correlation exposure 150%'
      },
      premature_entry: {
        primary: 'Entered before setup was complete',
        actionable: 'Wait for all conditions to be met. Checklist: trend aligned, multiple timeframes confirm, indicator confluence',
        prevention: 'Require minimum 70% confidence score before entry'
      }
    };

    const lesson = lessons[lossType as keyof typeof lessons] || {
      primary: 'Technical execution failure',
      actionable: 'Review trade execution checklist',
      prevention: 'Follow systematic entry rules'
    };

    return {
      primaryMistake: lesson.primary,
      secondaryMistakes: redFlags,
      actionableLesson: lesson.actionable,
      preventionRule: lesson.prevention
    };
  }

  /**
   * Create anti-pattern
   */
  private createAntiPattern(lossType: string, trade: any, marketContext: any): string {
    const patterns: Record<string, string> = {
      news_event: `Trading ${trade.symbol} within 30min of news`,
      wrong_regime: `${trade.setup_type} during ${marketContext.regime} market`,
      overtrading: `More than 3 trades in 4 hours`,
      premature_entry: `${trade.symbol} ${trade.direction} with confidence < 70%`
    };

    return patterns[lossType] || 'Generic technical failure';
  }

  /**
   * Suggest automated filter
   */
  private suggestAutomatedFilter(redFlags: string[], marketContext: any): string {
    if (redFlags.some(f => f.includes('news event'))) {
      return 'Add economic calendar check to pre-trade validation';
    }

    if (redFlags.some(f => f.includes('correlation'))) {
      return 'Add correlation risk calculator to position sizing';
    }

    if (redFlags.some(f => f.includes('confidence'))) {
      return 'Increase minimum confidence threshold to 70%';
    }

    return 'Add comprehensive pre-trade checklist validation';
  }

  /**
   * Save forensics to database
   */
  private async saveForensics(userId: string, forensics: LossForensics): Promise<void> {
    const { error } = await supabase
      .from('loss_forensics')
      .insert({
        user_id: userId,
        trade_id: forensics.tradeId,
        symbol: forensics.symbol,
        direction: forensics.direction,
        entry_time: forensics.entryTime.toISOString(),
        exit_time: forensics.exitTime.toISOString(),
        pnl: forensics.pnl,
        loss_type: forensics.lossType,
        red_flags: forensics.redFlags,
        red_flag_count: forensics.redFlagCount,
        should_have_skipped: forensics.shouldHaveSkipped,
        market_regime_at_entry: forensics.marketRegimeAtEntry,
        volatility_at_entry: forensics.volatilityAtEntry,
        session_at_entry: forensics.sessionAtEntry,
        news_events_nearby: forensics.newsEventsNearby,
        correlation_risk_score: forensics.correlationRiskScore,
        stop_loss_quality: forensics.stopLossQuality,
        entry_quality_score: forensics.entryQualityScore,
        timeframe_alignment: forensics.timeframeAlignment,
        indicator_divergence: forensics.indicatorDivergence,
        primary_mistake: forensics.primaryMistake,
        secondary_mistakes: forensics.secondaryMistakes,
        actionable_lesson: forensics.actionableLesson,
        anti_pattern_created: forensics.antiPatternCreated,
        prevention_rule: forensics.preventionRule,
        automated_filter_suggestion: forensics.automatedFilterSuggestion
      });

    if (error) {
      console.error('[Loss Forensics] Error saving forensics:', error);
    }
  }

  /**
   * Get anti-pattern description
   */
  private getAntiPatternDescription(name: string): string {
    const descriptions: Record<string, string> = {
      'Trading EURUSD within 30min of news': 'Volatility spikes during news make stops unreliable',
      'breakout during ranging market': 'False breakouts dominate ranging markets',
      'More than 3 trades in 4 hours': 'Overtrading leads to poor decision quality'
    };

    return descriptions[name] || 'Avoid this pattern based on historical losses';
  }

  /**
   * Check if trade matches anti-pattern
   */
  private doesTradeMatchAntiPattern(
    pattern: AntiPattern,
    symbol: string,
    direction: string,
    context: any
  ): boolean {
    const patternLower = pattern.name.toLowerCase();

    if (patternLower.includes(symbol.toLowerCase())) {
      return true;
    }

    if (patternLower.includes('news') && context.newsEventsNearby?.length > 0) {
      return true;
    }

    if (patternLower.includes('ranging') && context.regime === 'ranging') {
      return true;
    }

    return false;
  }

  /**
   * Detect session from time
   */
  private detectSession(date: Date): string {
    const hour = date.getUTCHours();
    if (hour >= 0 && hour < 7) return 'asian';
    if (hour >= 13 && hour < 16) return 'overlap';
    if (hour >= 7 && hour < 16) return 'london';
    if (hour >= 13 && hour < 22) return 'newyork';
    return 'asian';
  }
}

export const lossForensicsEngine = new LossForensicsEngine();
