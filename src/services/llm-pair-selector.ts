import { supabase } from '../lib/supabase';
import { openAIClient } from './openai-client';
import { MarketDataService } from './market-data-service';

interface PairPerformanceData {
  symbol: string;
  winRate: number;
  avgEV: number;
  profitFactor: number;
  totalTrades: number;
  recentTrend: 'improving' | 'declining' | 'stable';
}

interface PairVolatility {
  symbol: string;
  atr: number;
  volatilityLevel: 'low' | 'moderate' | 'high' | 'extreme';
}

interface TrendRegime {
  symbol: string;
  regime: 'strong_uptrend' | 'weak_uptrend' | 'ranging' | 'weak_downtrend' | 'strong_downtrend';
  strength: number;
}

interface PatternInsight {
  symbol: string;
  winningPatterns: number;
  losingPatterns: number;
  avoidPatterns: number;
  patternQuality: number;
}

interface ConfidenceCalibration {
  symbol: string;
  calibrationAccuracy: number;
  overconfident: boolean;
  underconfident: boolean;
}

interface SelectedPairResult {
  symbol: string;
  confidence: number;
  reasoning: string;
  expectedEV: number;
  riskLevel: 'low' | 'medium' | 'high';
  metrics: {
    volatility: number;
    trendStrength: number;
    historicalPerformance: number;
    patternQuality: number;
    avoidConflicts: boolean;
    expectedEV: number;
    calibrationAccuracy: number;
  };
}

class LLMPairSelector {
  private enabled: boolean = true;

  constructor() {
    console.log('[LLM Pair Selector] Initialized with GPT-4o (using Netlify proxy)');
  }

  async selectPairForDay(userId: string): Promise<SelectedPairResult> {
    console.log('\n[LLM Pair Selector] 🎯 Analyzing pairs for daily session...');

    try {
      const availablePairs = ['EURUSD', 'XAUUSD', 'GBPUSD', 'USDJPY', 'US30'];

      const [
        pairPerformance,
        volatility,
        trendRegimes,
        patternInsights,
        calibration,
        yesterdayInsights
      ] = await Promise.all([
        this.getPairHistoricalPerformance(userId, availablePairs),
        this.calculatePairVolatility(availablePairs),
        this.detectTrendRegimes(availablePairs),
        this.getPatternInsightsPerPair(userId, availablePairs),
        this.getConfidenceCalibrationPerPair(userId, availablePairs),
        this.getYesterdayMetaAnalysis(userId)
      ]);

      const evScores = this.calculateExpectedEVPerPair(pairPerformance);

      console.log('[LLM Pair Selector] Performance Summary:');
      pairPerformance.forEach(p => {
        console.log(`  ${p.symbol}: ${p.winRate.toFixed(1)}% WR, EV ${p.avgEV.toFixed(2)}, ${p.totalTrades} trades`);
      });

      if (this.enabled) {
        const selectedPair = await this.selectPairWithGPT4o(
          pairPerformance,
          volatility,
          trendRegimes,
          patternInsights,
          calibration,
          evScores,
          yesterdayInsights
        );

        await this.storePairSelection(userId, selectedPair);
        return selectedPair;
      } else {
        const selectedPair = this.selectPairWithFallbackLogic(
          pairPerformance,
          volatility,
          trendRegimes,
          patternInsights,
          evScores
        );

        await this.storePairSelection(userId, selectedPair);
        return selectedPair;
      }
    } catch (error) {
      console.error('[LLM Pair Selector] Error selecting pair:', error);
      return this.getDefaultPair();
    }
  }

  private async getPairHistoricalPerformance(
    userId: string,
    pairs: string[]
  ): Promise<PairPerformanceData[]> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const results: PairPerformanceData[] = [];

    for (const symbol of pairs) {
      const { data: trades } = await supabase
        .from('goal_session_trades')
        .select('profit_loss')
        .eq('symbol', symbol)
        .eq('status', 'closed')
        .gte('created_at', thirtyDaysAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(100);

      if (!trades || trades.length === 0) {
        results.push({
          symbol,
          winRate: 50,
          avgEV: 0,
          profitFactor: 1.0,
          totalTrades: 0,
          recentTrend: 'stable'
        });
        continue;
      }

      const wins = trades.filter(t => parseFloat(t.profit_loss) > 0);
      const losses = trades.filter(t => parseFloat(t.profit_loss) < 0);
      const winRate = (wins.length / trades.length) * 100;

      const totalWin = wins.reduce((sum, t) => sum + parseFloat(t.profit_loss), 0);
      const totalLoss = Math.abs(losses.reduce((sum, t) => sum + parseFloat(t.profit_loss), 0));
      const profitFactor = totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? 2.0 : 1.0;

      const avgEV = trades.reduce((sum, t) => sum + parseFloat(t.profit_loss), 0) / trades.length;

      const recentTrades = trades.slice(0, 10);
      const olderTrades = trades.slice(10, 20);
      const recentWR = recentTrades.length > 0 ? (recentTrades.filter(t => parseFloat(t.profit_loss) > 0).length / recentTrades.length) * 100 : 50;
      const olderWR = olderTrades.length > 0 ? (olderTrades.filter(t => parseFloat(t.profit_loss) > 0).length / olderTrades.length) * 100 : 50;

      let recentTrend: 'improving' | 'declining' | 'stable' = 'stable';
      if (recentWR > olderWR + 5) recentTrend = 'improving';
      else if (recentWR < olderWR - 5) recentTrend = 'declining';

      results.push({
        symbol,
        winRate,
        avgEV,
        profitFactor,
        totalTrades: trades.length,
        recentTrend
      });
    }

    return results;
  }

  private async calculatePairVolatility(pairs: string[]): Promise<PairVolatility[]> {
    const results: PairVolatility[] = [];
    // ✅ PHASE 2: Use MarketDataService as SSOT
    const marketDataService = MarketDataService.getInstance();

    for (const symbol of pairs) {
      const candles = await marketDataService.getCandles(symbol, 'H1', 24);

      if (!candles || candles.length < 14) {
        results.push({
          symbol,
          atr: 0.001,
          volatilityLevel: 'moderate'
        });
        continue;
      }

      const trueRanges = candles.map(c => c.high - c.low);
      const atr = trueRanges.reduce((sum, tr) => sum + tr, 0) / trueRanges.length;

      let volatilityLevel: 'low' | 'moderate' | 'high' | 'extreme' = 'moderate';
      if (atr < 0.0005) volatilityLevel = 'low';
      else if (atr > 0.002) volatilityLevel = 'extreme';
      else if (atr > 0.0012) volatilityLevel = 'high';

      results.push({ symbol, atr, volatilityLevel });
    }

    return results;
  }

  private async detectTrendRegimes(pairs: string[]): Promise<TrendRegime[]> {
    const results: TrendRegime[] = [];
    // ✅ PHASE 2: Use MarketDataService as SSOT
    const marketDataService = MarketDataService.getInstance();

    for (const symbol of pairs) {
      const candlesRaw = await marketDataService.getCandles(symbol, 'H1', 168);
      const candles = candlesRaw ? [...candlesRaw].reverse() : null; // Convert to ascending order

      if (!candles || candles.length < 50) {
        results.push({
          symbol,
          regime: 'ranging',
          strength: 0
        });
        continue;
      }

      const prices = candles.map(c => c.close);
      const firstPrice = prices[0];
      const lastPrice = prices[prices.length - 1];
      const priceChange = ((lastPrice - firstPrice) / firstPrice) * 100;

      const highs = prices.map((_, i) => Math.max(...prices.slice(Math.max(0, i - 10), i + 1)));
      const lows = prices.map((_, i) => Math.min(...prices.slice(Math.max(0, i - 10), i + 1)));
      const higherHighs = highs.filter((h, i) => i > 0 && h > highs[i - 1]).length;
      const lowerLows = lows.filter((l, i) => i > 0 && l < lows[i - 1]).length;

      let regime: TrendRegime['regime'];
      let strength = Math.abs(priceChange);

      if (priceChange > 2 && higherHighs > prices.length * 0.4) {
        regime = 'strong_uptrend';
      } else if (priceChange > 0.5 && higherHighs > prices.length * 0.3) {
        regime = 'weak_uptrend';
      } else if (priceChange < -2 && lowerLows > prices.length * 0.4) {
        regime = 'strong_downtrend';
      } else if (priceChange < -0.5 && lowerLows > prices.length * 0.3) {
        regime = 'weak_downtrend';
      } else {
        regime = 'ranging';
        strength = 0;
      }

      results.push({ symbol, regime, strength });
    }

    return results;
  }

  private async getPatternInsightsPerPair(
    userId: string,
    pairs: string[]
  ): Promise<PatternInsight[]> {
    const results: PatternInsight[] = [];

    for (const symbol of pairs) {
      const { data: patterns } = await supabase
        .from('ai_pattern_ev_tracking')
        .select('pattern_name, current_ev, occurrences')
        .eq('user_id', userId)
        .eq('symbol', symbol);

      if (!patterns || patterns.length === 0) {
        results.push({
          symbol,
          winningPatterns: 0,
          losingPatterns: 0,
          avoidPatterns: 0,
          patternQuality: 50
        });
        continue;
      }

      const winningPatterns = patterns.filter(p => p.current_ev > 0.5).length;
      const losingPatterns = patterns.filter(p => p.current_ev < -0.3).length;
      const avoidPatterns = patterns.filter(p => p.current_ev < -0.5).length;

      const avgEV = patterns.reduce((sum, p) => sum + p.current_ev, 0) / patterns.length;
      const patternQuality = Math.max(0, Math.min(100, 50 + avgEV * 20));

      results.push({
        symbol,
        winningPatterns,
        losingPatterns,
        avoidPatterns,
        patternQuality
      });
    }

    return results;
  }

  private async getConfidenceCalibrationPerPair(
    userId: string,
    pairs: string[]
  ): Promise<ConfidenceCalibration[]> {
    const results: ConfidenceCalibration[] = [];

    for (const symbol of pairs) {
      const { data: calibration } = await supabase
        .from('ai_confidence_calibration')
        .select('calibration_accuracy, confidence_bias')
        .eq('user_id', userId)
        .eq('symbol', symbol)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!calibration) {
        results.push({
          symbol,
          calibrationAccuracy: 50,
          overconfident: false,
          underconfident: false
        });
        continue;
      }

      const accuracy = calibration.calibration_accuracy || 50;
      const bias = calibration.confidence_bias || 0;

      results.push({
        symbol,
        calibrationAccuracy: accuracy,
        overconfident: bias > 10,
        underconfident: bias < -10
      });
    }

    return results;
  }

  private calculateExpectedEVPerPair(performance: PairPerformanceData[]): Record<string, number> {
    const evScores: Record<string, number> = {};

    performance.forEach(p => {
      let ev = p.avgEV;

      if (p.recentTrend === 'improving') ev *= 1.2;
      else if (p.recentTrend === 'declining') ev *= 0.8;

      evScores[p.symbol] = ev;
    });

    return evScores;
  }

  private async getYesterdayMetaAnalysis(userId: string): Promise<any | null> {
    try {
      const { progressiveDailyLearning } = await import('./progressive-daily-learning');
      const yesterdayAnalysis = await progressiveDailyLearning.getYesterdayMetaAnalysis(userId);

      if (yesterdayAnalysis) {
        console.log('[LLM Pair Selector] 📅 Yesterday\'s insights loaded:');
        console.log(`  Performance Trend: ${yesterdayAnalysis.performanceTrend}`);
        console.log(`  Win Rate Delta: ${yesterdayAnalysis.winRateDelta?.toFixed(1) || 'N/A'}%`);
        console.log(`  Recommended Pairs: ${yesterdayAnalysis.recommendedPairs?.length || 0}`);
      }

      return yesterdayAnalysis;
    } catch (error) {
      console.warn('[LLM Pair Selector] Could not load yesterday\'s insights:', error);
      return null;
    }
  }

  private async selectPairWithGPT4o(
    performance: PairPerformanceData[],
    volatility: PairVolatility[],
    trends: TrendRegime[],
    patterns: PatternInsight[],
    calibration: ConfidenceCalibration[],
    evScores: Record<string, number>,
    yesterdayInsights: any | null
  ): Promise<SelectedPairResult> {
    console.log('[LLM Pair Selector] Calling GPT-4o for pair selection...');

    const performanceText = performance.map(p =>
      `- ${p.symbol}: Win Rate ${p.winRate.toFixed(1)}%, Avg EV ${p.avgEV.toFixed(2)}, PF ${p.profitFactor.toFixed(2)}, ${p.totalTrades} trades, Trend: ${p.recentTrend}`
    ).join('\n');

    const volatilityText = volatility.map(v =>
      `- ${v.symbol}: ${v.volatilityLevel} volatility (ATR: ${v.atr.toFixed(5)})`
    ).join('\n');

    const trendText = trends.map(t =>
      `- ${t.symbol}: ${t.regime} (strength: ${t.strength.toFixed(1)}%)`
    ).join('\n');

    const patternText = patterns.map(p =>
      `- ${p.symbol}: ${p.winningPatterns} winning patterns, ${p.avoidPatterns} avoid patterns, Quality: ${p.patternQuality.toFixed(1)}%`
    ).join('\n');

    const calibrationText = calibration.map(c =>
      `- ${c.symbol}: ${c.calibrationAccuracy.toFixed(1)}% accurate${c.overconfident ? ' (overconfident)' : c.underconfident ? ' (underconfident)' : ''}`
    ).join('\n');

    let yesterdayInsightsText = '';
    if (yesterdayInsights) {
      yesterdayInsightsText = `

YESTERDAY'S STRATEGIC INSIGHTS:
- Performance Trend: ${yesterdayInsights.performanceTrend} (Win Rate Delta: ${yesterdayInsights.winRateDelta?.toFixed(1) || 'N/A'}%)
- Yesterday Win Rate: ${yesterdayInsights.todayWinRate?.toFixed(1)}%

Strategic Recommendations from Yesterday:
${yesterdayInsights.strategicRecommendations?.map((r: string) => `- ${r}`).join('\n') || 'None'}

Patterns to Emphasize:
${yesterdayInsights.patternsToEmphasize?.map((p: string) => `- ${p}`).join('\n') || 'None'}

Patterns to AVOID:
${yesterdayInsights.patternsToAvoid?.map((p: string) => `- ${p}`).join('\n') || 'None'}

Recommended Pairs from Yesterday:
${yesterdayInsights.recommendedPairs?.map((p: any) => `- ${p.symbol} (Confidence: ${p.confidence}): ${p.reasoning}`).join('\n') || 'None'}

Pairs to Avoid:
${yesterdayInsights.pairsToAvoid?.join(', ') || 'None'}

Confidence Calibration Advice:
${yesterdayInsights.confidenceCalibration?.adjustmentReasoning || 'No adjustments'}
Recommended Threshold: ${yesterdayInsights.confidenceCalibration?.recommendedThreshold || 75}%

Key Discoveries:
${yesterdayInsights.keyDiscoveries?.map((d: string) => `- ${d}`).join('\n') || 'None'}

Improvement Focus Areas:
${yesterdayInsights.improvementFocus?.map((f: string) => `- ${f}`).join('\n') || 'None'}`;
    }

    const prompt = `You are Pipnosis AI, an expert forex trading system. Analyze the following data and select ONE currency pair to trade today.

Available Pairs: EURUSD, XAUUSD, GBPUSD, USDJPY, US30

Performance Data (Last 30 Days):
${performanceText}

Volatility Analysis:
${volatilityText}

Trend Regimes:
${trendText}

Pattern Insights:
${patternText}

Confidence Calibration:
${calibrationText}

Expected EV Scores:
${Object.entries(evScores).map(([symbol, ev]) => `- ${symbol}: ${ev.toFixed(2)}`).join('\n')}${yesterdayInsightsText}

Select the SINGLE BEST pair for today's trading session. Consider:
1. High win rate and positive EV
2. Strong trend or high volatility for opportunities
3. Winning patterns available
4. Good confidence calibration
5. Recent improving performance
6. YESTERDAY'S STRATEGIC INSIGHTS - Apply yesterday's recommendations and avoid yesterday's problem patterns
7. If yesterday showed declining performance, consider switching pairs or adjusting approach
8. If yesterday recommended specific pairs, prioritize those if performance supports it

Return ONLY valid JSON in this exact format:
{
  "symbol": "GBPUSD",
  "confidence": 85,
  "reasoning": "Strong uptrend with high win rate and 3 winning patterns",
  "expectedEV": 1.2,
  "riskLevel": "medium"
}`;

    try {
      const response = await openAIClient.chat(
        [{ role: 'user', content: prompt }],
        { temperature: 0.3, max_tokens: 300 }
      );

      const responseText = response.choices[0]?.message?.content || '';
      const parsed = this.parsePairSelectionResponse(responseText, performance, volatility, trends, patterns, calibration);
      console.log(`[LLM Pair Selector] ✅ Selected: ${parsed.symbol} (${parsed.confidence}% confidence)`);
      console.log(`[LLM Pair Selector] Reasoning: ${parsed.reasoning}`);

      return parsed;
    } catch (error) {
      console.error('[LLM Pair Selector] GPT-4o call failed, using fallback:', error);
      return this.selectPairWithFallbackLogic(performance, volatility, trends, patterns, evScores);
    }
  }

  private parsePairSelectionResponse(
    response: string,
    performance: PairPerformanceData[],
    volatility: PairVolatility[],
    trends: TrendRegime[],
    patterns: PatternInsight[],
    calibration: ConfidenceCalibration[]
  ): SelectedPairResult {
    try {
      // DEFENSIVE: Ensure response is a string
      if (typeof response !== 'string') {
        console.error('[LLM Pair Selector] Response is not a string:', typeof response);
        throw new Error('Invalid response type');
      }

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');

      const parsed = JSON.parse(jsonMatch[0]);

      const symbol = parsed.symbol || 'EURUSD';
      const perf = performance.find(p => p.symbol === symbol);
      const vol = volatility.find(v => v.symbol === symbol);
      const trend = trends.find(t => t.symbol === symbol);
      const pattern = patterns.find(p => p.symbol === symbol);
      const calib = calibration.find(c => c.symbol === symbol);

      return {
        symbol,
        confidence: parsed.confidence || 70,
        reasoning: parsed.reasoning || 'LLM selected based on overall analysis',
        expectedEV: parsed.expectedEV || perf?.avgEV || 0,
        riskLevel: parsed.riskLevel || 'medium',
        metrics: {
          volatility: vol?.atr || 0.001,
          trendStrength: trend?.strength || 0,
          historicalPerformance: perf?.winRate || 50,
          patternQuality: pattern?.patternQuality || 50,
          avoidConflicts: (pattern?.avoidPatterns || 0) === 0,
          expectedEV: perf?.avgEV || 0,
          calibrationAccuracy: calib?.calibrationAccuracy || 50
        }
      };
    } catch (error) {
      console.error('[LLM Pair Selector] Error parsing response:', error);
      throw error;
    }
  }

  private selectPairWithFallbackLogic(
    performance: PairPerformanceData[],
    volatility: PairVolatility[],
    trends: TrendRegime[],
    patterns: PatternInsight[],
    evScores: Record<string, number>
  ): SelectedPairResult {
    console.log('[LLM Pair Selector] Using fallback selection logic...');

    const scored = performance.map(perf => {
      const vol = volatility.find(v => v.symbol === perf.symbol);
      const trend = trends.find(t => t.symbol === perf.symbol);
      const pattern = patterns.find(p => p.symbol === perf.symbol);

      let score = 0;

      score += perf.winRate * 0.3;
      score += (perf.avgEV + 1) * 20;
      score += perf.profitFactor * 10;

      if (perf.recentTrend === 'improving') score += 15;
      if (perf.recentTrend === 'declining') score -= 15;

      if (trend?.regime === 'strong_uptrend' || trend?.regime === 'strong_downtrend') score += 20;

      score += (pattern?.winningPatterns || 0) * 5;
      score -= (pattern?.avoidPatterns || 0) * 10;

      if (vol?.volatilityLevel === 'moderate' || vol?.volatilityLevel === 'high') score += 10;
      if (vol?.volatilityLevel === 'extreme') score -= 5;

      return {
        symbol: perf.symbol,
        score,
        perf,
        vol,
        trend,
        pattern
      };
    });

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];

    // Calculate meaningful confidence based on actual pair quality
    const confidence = this.calculatePairSelectionConfidence(best);
    const reasoning = `Fallback: ${best.perf.winRate.toFixed(1)}% WR, ${best.perf.recentTrend} trend, ${best.pattern?.winningPatterns || 0} patterns`;

    console.log(`[LLM Pair Selector] ✅ Selected: ${best.symbol} (${confidence.toFixed(0)}% confidence)`);
    console.log(`[LLM Pair Selector] Reasoning: ${reasoning}`);

    return {
      symbol: best.symbol,
      confidence,
      reasoning,
      expectedEV: best.perf.avgEV,
      riskLevel: best.vol?.volatilityLevel === 'extreme' ? 'high' : best.vol?.volatilityLevel === 'low' ? 'low' : 'medium',
      metrics: {
        volatility: best.vol?.atr || 0.001,
        trendStrength: best.trend?.strength || 0,
        historicalPerformance: best.perf.winRate,
        patternQuality: best.pattern?.patternQuality || 50,
        avoidConflicts: (best.pattern?.avoidPatterns || 0) === 0,
        expectedEV: best.perf.avgEV,
        calibrationAccuracy: 50
      }
    };
  }

  /**
   * Calculate meaningful confidence based on actual pair quality
   * Returns 30-95% confidence based on multiple quality factors
   */
  private calculatePairSelectionConfidence(best: any): number {
    let confidence = 50; // Start at neutral

    // Factor 1: Win Rate Quality (±20 points)
    // 55%+ WR = excellent, 45-55% = acceptable, <45% = concerning
    const wr = best.perf.winRate;
    if (wr >= 60) confidence += 20;
    else if (wr >= 55) confidence += 15;
    else if (wr >= 52) confidence += 10;
    else if (wr >= 50) confidence += 5;
    else if (wr >= 48) confidence += 0;
    else if (wr >= 45) confidence -= 5;
    else confidence -= 10;

    // Factor 2: Profit Factor Quality (±15 points)
    // PF > 1.5 = excellent, 1.2-1.5 = good, 1.0-1.2 = acceptable, <1.0 = losing
    const pf = best.perf.profitFactor;
    if (pf >= 1.8) confidence += 15;
    else if (pf >= 1.5) confidence += 12;
    else if (pf >= 1.3) confidence += 8;
    else if (pf >= 1.2) confidence += 5;
    else if (pf >= 1.0) confidence += 0;
    else if (pf >= 0.9) confidence -= 8;
    else confidence -= 15;

    // Factor 3: Recent Trend (±10 points)
    if (best.perf.recentTrend === 'improving') confidence += 10;
    else if (best.perf.recentTrend === 'declining') confidence -= 10;

    // Factor 4: Pattern Quality (±10 points)
    const winningPatterns = best.pattern?.winningPatterns || 0;
    const avoidPatterns = best.pattern?.avoidPatterns || 0;
    if (winningPatterns >= 5 && avoidPatterns === 0) confidence += 10;
    else if (winningPatterns >= 3 && avoidPatterns === 0) confidence += 5;
    else if (avoidPatterns >= 3) confidence -= 10;
    else if (avoidPatterns >= 1) confidence -= 5;

    // Factor 5: Trend Regime Strength (±10 points)
    if (best.trend?.regime === 'strong_uptrend' || best.trend?.regime === 'strong_downtrend') {
      confidence += 10;
    } else if (best.trend?.regime === 'sideways' || best.trend?.regime === 'choppy') {
      confidence -= 5;
    }

    // Factor 6: Trade Volume (data quality indicator) (±5 points)
    const totalTrades = best.perf.totalTrades;
    if (totalTrades >= 50) confidence += 5;
    else if (totalTrades >= 30) confidence += 3;
    else if (totalTrades >= 20) confidence += 0;
    else if (totalTrades >= 10) confidence -= 3;
    else confidence -= 8; // Very low data = low confidence

    // Factor 7: Expected EV (±10 points)
    const ev = best.perf.avgEV;
    if (ev >= 2.0) confidence += 10;
    else if (ev >= 1.0) confidence += 7;
    else if (ev >= 0.5) confidence += 4;
    else if (ev >= 0) confidence += 0;
    else if (ev >= -0.5) confidence -= 5;
    else confidence -= 10;

    // Factor 8: Volatility Suitability (±5 points)
    const volLevel = best.vol?.volatilityLevel;
    if (volLevel === 'moderate') confidence += 5;
    else if (volLevel === 'high') confidence += 3;
    else if (volLevel === 'extreme') confidence -= 8;
    else if (volLevel === 'low') confidence -= 3;

    // Clamp confidence to reasonable range: 30% (terrible) to 95% (excellent)
    confidence = Math.max(30, Math.min(95, confidence));

    console.log(`[Confidence Calc] Components:`);
    console.log(`  Base: 50%`);
    console.log(`  WR ${wr.toFixed(1)}%: ${wr >= 55 ? '+' : ''}${(wr >= 55 ? 15 : wr >= 50 ? 5 : -5)}`);
    console.log(`  PF ${pf.toFixed(2)}: ${pf >= 1.3 ? '+' : ''}${(pf >= 1.5 ? 12 : pf >= 1.2 ? 5 : -8)}`);
    console.log(`  Trend: ${best.perf.recentTrend}`);
    console.log(`  Total: ${confidence.toFixed(0)}%`);

    return confidence;
  }

  private getDefaultPair(): SelectedPairResult {
    console.log('[LLM Pair Selector] Using default pair: EURUSD');
    return {
      symbol: 'EURUSD',
      confidence: 50,
      reasoning: 'Default pair selected due to analysis error',
      expectedEV: 0,
      riskLevel: 'medium',
      metrics: {
        volatility: 0.001,
        trendStrength: 0,
        historicalPerformance: 50,
        patternQuality: 50,
        avoidConflicts: true,
        expectedEV: 0,
        calibrationAccuracy: 50
      }
    };
  }

  private async storePairSelection(userId: string, selection: SelectedPairResult): Promise<void> {
    try {
      await supabase
        .from('pair_selection_history')
        .insert({
          user_id: userId,
          symbol: selection.symbol,
          expected_confidence: selection.confidence,
          reasoning: selection.reasoning,
          metrics: selection.metrics,
          session_date: new Date().toISOString()
        });

      console.log('[LLM Pair Selector] ✅ Pair selection stored in database');
    } catch (error) {
      console.error('[LLM Pair Selector] Error storing pair selection:', error);
    }
  }
}

export const llmPairSelector = new LLMPairSelector();
