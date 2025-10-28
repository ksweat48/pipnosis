import { supabase } from '../lib/supabase';
import { Timeframe } from '../types/market-data';
import { marketHoursService } from './market-hours';

export interface GapAnalysisResult {
  symbol: string;
  timeframe: Timeframe;
  dateRange: {
    start: Date;
    end: Date;
  };
  totalCandles: number;
  expectedCandles: number;
  missingCandles: number;
  completenessPercentage: number;
  gaps: DateGap[];
  tradingDaysAnalysis: TradingDayAnalysis[];
}

export interface DateGap {
  startTime: Date;
  endTime: Date;
  durationHours: number;
  missingCandles: number;
  isTradingHours: boolean;
  severity: 'critical' | 'moderate' | 'minor';
}

export interface TradingDayAnalysis {
  date: string;
  expectedCandles: number;
  actualCandles: number;
  missingCandles: number;
  completeness: number;
  hasLargeGaps: boolean;
  gapCount: number;
}

export interface SymbolTimeframeHealth {
  symbol: string;
  timeframe: Timeframe;
  totalCandles: number;
  oldestCandle: Date | null;
  newestCandle: Date | null;
  avgCandlesPerDay: number;
  problemDates: string[];
  overallHealth: 'excellent' | 'good' | 'fair' | 'poor';
}

class GapDetectionService {
  async analyzeSymbolTimeframe(
    symbol: string,
    timeframe: Timeframe,
    startDate: Date,
    endDate: Date
  ): Promise<GapAnalysisResult> {
    const { data: candles, error } = await supabase
      .from('market_data')
      .select('timestamp, symbol, timeframe')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .gte('timestamp', startDate.toISOString())
      .lte('timestamp', endDate.toISOString())
      .order('timestamp', { ascending: true });

    if (error) {
      console.error('Error fetching candles for gap analysis:', error);
      throw error;
    }

    const candleTimes = (candles || []).map(c => new Date(c.timestamp));
    const gaps = this.detectGapsInSequence(candleTimes, timeframe);
    const tradingDaysAnalysis = await this.analyzeTradingDays(
      symbol,
      timeframe,
      startDate,
      endDate
    );

    const expectedCandles = this.calculateExpectedCandles(timeframe, startDate, endDate);
    const totalCandles = candleTimes.length;
    const missingCandles = expectedCandles - totalCandles;
    const completenessPercentage = expectedCandles > 0
      ? (totalCandles / expectedCandles) * 100
      : 0;

    return {
      symbol,
      timeframe,
      dateRange: { start: startDate, end: endDate },
      totalCandles,
      expectedCandles,
      missingCandles,
      completenessPercentage,
      gaps,
      tradingDaysAnalysis
    };
  }

  async scanAllSymbolsForGaps(
    startDate: Date,
    endDate: Date,
    symbols: string[] = ['EURUSD', 'GBPUSD', 'XAUUSD'],
    timeframes: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1']
  ): Promise<Map<string, GapAnalysisResult[]>> {
    const results = new Map<string, GapAnalysisResult[]>();

    for (const symbol of symbols) {
      const symbolResults: GapAnalysisResult[] = [];

      for (const timeframe of timeframes) {
        try {
          const analysis = await this.analyzeSymbolTimeframe(
            symbol,
            timeframe,
            startDate,
            endDate
          );
          symbolResults.push(analysis);

          console.log(
            `📊 ${symbol} ${timeframe}: ${analysis.totalCandles}/${analysis.expectedCandles} ` +
            `(${analysis.completenessPercentage.toFixed(1)}%) - ${analysis.gaps.length} gaps`
          );
        } catch (error) {
          console.error(`Failed to analyze ${symbol} ${timeframe}:`, error);
        }
      }

      results.set(symbol, symbolResults);
    }

    return results;
  }

  async getSymbolTimeframeHealth(
    symbol: string,
    timeframe: Timeframe
  ): Promise<SymbolTimeframeHealth> {
    const { data, error } = await supabase
      .from('market_data')
      .select('timestamp')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .order('timestamp', { ascending: true });

    if (error || !data || data.length === 0) {
      return {
        symbol,
        timeframe,
        totalCandles: 0,
        oldestCandle: null,
        newestCandle: null,
        avgCandlesPerDay: 0,
        problemDates: [],
        overallHealth: 'poor'
      };
    }

    const oldestCandle = new Date(data[0].timestamp);
    const newestCandle = new Date(data[data.length - 1].timestamp);
    const totalCandles = data.length;

    const daySpan = (newestCandle.getTime() - oldestCandle.getTime()) / (1000 * 60 * 60 * 24);
    const avgCandlesPerDay = daySpan > 0 ? totalCandles / daySpan : 0;

    const last30Days = new Date();
    last30Days.setDate(last30Days.getDate() - 30);

    const problemDates = await this.findProblemDates(symbol, timeframe, last30Days, new Date());

    let overallHealth: 'excellent' | 'good' | 'fair' | 'poor';
    if (problemDates.length === 0 && avgCandlesPerDay > this.getExpectedDailyCandles(timeframe) * 0.95) {
      overallHealth = 'excellent';
    } else if (problemDates.length <= 3 && avgCandlesPerDay > this.getExpectedDailyCandles(timeframe) * 0.85) {
      overallHealth = 'good';
    } else if (problemDates.length <= 7 && avgCandlesPerDay > this.getExpectedDailyCandles(timeframe) * 0.70) {
      overallHealth = 'fair';
    } else {
      overallHealth = 'poor';
    }

    return {
      symbol,
      timeframe,
      totalCandles,
      oldestCandle,
      newestCandle,
      avgCandlesPerDay,
      problemDates,
      overallHealth
    };
  }

  async findSpecificDateGaps(
    symbol: string,
    timeframe: Timeframe,
    targetDate: Date
  ): Promise<TradingDayAnalysis | null> {
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const { data, error } = await supabase
      .from('market_data')
      .select('timestamp')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .gte('timestamp', startOfDay.toISOString())
      .lte('timestamp', endOfDay.toISOString())
      .order('timestamp', { ascending: true });

    if (error) {
      console.error('Error fetching date-specific data:', error);
      return null;
    }

    const actualCandles = data?.length || 0;
    const expectedCandles = this.getExpectedDailyCandles(timeframe);
    const missingCandles = Math.max(0, expectedCandles - actualCandles);
    const completeness = expectedCandles > 0 ? (actualCandles / expectedCandles) * 100 : 0;

    const candleTimes = (data || []).map(c => new Date(c.timestamp));
    const gaps = this.detectGapsInSequence(candleTimes, timeframe);
    const hasLargeGaps = gaps.some(g => g.severity === 'critical');

    return {
      date: targetDate.toISOString().split('T')[0],
      expectedCandles,
      actualCandles,
      missingCandles,
      completeness,
      hasLargeGaps,
      gapCount: gaps.length
    };
  }

  private detectGapsInSequence(
    candleTimes: Date[],
    timeframe: Timeframe
  ): DateGap[] {
    if (candleTimes.length < 2) return [];

    const gaps: DateGap[] = [];
    const expectedIntervalMs = this.getTimeframeMinutes(timeframe) * 60 * 1000;

    for (let i = 1; i < candleTimes.length; i++) {
      const prevTime = candleTimes[i - 1];
      const currTime = candleTimes[i];
      const actualInterval = currTime.getTime() - prevTime.getTime();

      if (actualInterval > expectedIntervalMs * 1.5) {
        const durationHours = actualInterval / (1000 * 60 * 60);
        const isTradingHours = this.isInTradingHours(prevTime, currTime);

        const gapStart = new Date(prevTime.getTime() + expectedIntervalMs);
        const gapEnd = currTime;

        const tradingDaysInGap = marketHoursService.getTradingDaysBetween(gapStart, gapEnd);
        const expectedTradingHours = tradingDaysInGap.length * 24;
        const expectedTradingMinutes = expectedTradingHours * 60;
        const expectedCandlesInGap = Math.floor(expectedTradingMinutes / this.getTimeframeMinutes(timeframe));

        const missingCandles = Math.max(1, expectedCandlesInGap);

        let severity: 'critical' | 'moderate' | 'minor';
        if (missingCandles > 20 && isTradingHours) {
          severity = 'critical';
        } else if (missingCandles > 5 && isTradingHours) {
          severity = 'moderate';
        } else {
          severity = 'minor';
        }

        gaps.push({
          startTime: gapStart,
          endTime: gapEnd,
          durationHours,
          missingCandles,
          isTradingHours,
          severity
        });
      }
    }

    return gaps;
  }

  private async analyzeTradingDays(
    symbol: string,
    timeframe: Timeframe,
    startDate: Date,
    endDate: Date
  ): Promise<TradingDayAnalysis[]> {
    const tradingDays = marketHoursService.getTradingDaysBetween(startDate, endDate);
    const analyses: TradingDayAnalysis[] = [];

    for (const day of tradingDays) {
      const analysis = await this.findSpecificDateGaps(symbol, timeframe, day);
      if (analysis) {
        analyses.push(analysis);
      }
    }

    return analyses;
  }

  private async findProblemDates(
    symbol: string,
    timeframe: Timeframe,
    startDate: Date,
    endDate: Date
  ): Promise<string[]> {
    const tradingDaysAnalysis = await this.analyzeTradingDays(
      symbol,
      timeframe,
      startDate,
      endDate
    );

    return tradingDaysAnalysis
      .filter(day => day.completeness < 80 || day.hasLargeGaps)
      .map(day => day.date);
  }

  private calculateExpectedCandles(
    timeframe: Timeframe,
    startDate: Date,
    endDate: Date
  ): number {
    const tradingDays = marketHoursService.getTradingDaysBetween(startDate, endDate);
    const candlesPerDay = this.getExpectedDailyCandles(timeframe);
    return tradingDays.length * candlesPerDay;
  }

  private getExpectedDailyCandles(timeframe: Timeframe): number {
    const tradingHoursPerDay = 24;
    const minutesPerDay = tradingHoursPerDay * 60;
    const timeframeMinutes = this.getTimeframeMinutes(timeframe);
    return Math.floor(minutesPerDay / timeframeMinutes);
  }

  private getTimeframeMinutes(timeframe: Timeframe): number {
    const map: Record<Timeframe, number> = {
      M1: 1,
      M5: 5,
      M15: 15,
      M30: 30,
      H1: 60,
      H4: 240,
      D1: 1440,
      W1: 10080,
      MN1: 43200
    };
    return map[timeframe] || 15;
  }

  private isInTradingHours(startTime: Date, endTime: Date): boolean {
    const midpoint = new Date((startTime.getTime() + endTime.getTime()) / 2);
    return marketHoursService.isTradingDay(midpoint);
  }

  async generateGapReport(
    startDate: Date,
    endDate: Date,
    symbols: string[] = ['EURUSD', 'GBPUSD', 'XAUUSD']
  ): Promise<string> {
    const allResults = await this.scanAllSymbolsForGaps(startDate, endDate, symbols);

    let report = '# Market Data Gap Analysis Report\n\n';
    report += `**Date Range:** ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}\n\n`;
    report += `**Generated:** ${new Date().toISOString()}\n\n`;
    report += '---\n\n';

    for (const [symbol, results] of allResults.entries()) {
      report += `## ${symbol}\n\n`;

      for (const result of results) {
        const statusEmoji = result.completenessPercentage >= 95 ? '✅' :
                           result.completenessPercentage >= 80 ? '⚠️' : '❌';

        report += `### ${statusEmoji} ${result.timeframe}\n\n`;
        report += `- **Completeness:** ${result.completenessPercentage.toFixed(2)}%\n`;
        report += `- **Candles:** ${result.totalCandles} / ${result.expectedCandles} (missing: ${result.missingCandles})\n`;
        report += `- **Gaps Detected:** ${result.gaps.length}\n`;

        if (result.gaps.length > 0) {
          const criticalGaps = result.gaps.filter(g => g.severity === 'critical');
          if (criticalGaps.length > 0) {
            report += `- **Critical Gaps:** ${criticalGaps.length}\n`;
          }
        }

        const problemDays = result.tradingDaysAnalysis.filter(d => d.completeness < 80);
        if (problemDays.length > 0) {
          report += `- **Problem Days:** ${problemDays.map(d => d.date).join(', ')}\n`;
        }

        report += '\n';
      }

      report += '---\n\n';
    }

    return report;
  }
}

export const gapDetectionService = new GapDetectionService();
