import { supabase } from '../lib/supabase';
import { Timeframe, CandleData } from './metaapi';
import { gapDetectionService } from './gap-detection';
import { dataValidator } from './data-validator';

export interface VerificationReport {
  symbol: string;
  timeframe: Timeframe;
  dateRange: {
    start: Date;
    end: Date;
  };
  checks: {
    sequenceIntegrity: CheckResult;
    priceValidation: CheckResult;
    gapDetection: CheckResult;
    duplicateCheck: CheckResult;
    timestampConsistency: CheckResult;
  };
  overall: 'pass' | 'warning' | 'fail';
  issues: string[];
  recommendations: string[];
}

export interface CheckResult {
  passed: boolean;
  score: number;
  message: string;
  details?: any;
}

export interface ComparisonReport {
  beforeBackfill: DataSnapshot;
  afterBackfill: DataSnapshot;
  improvement: {
    candlesAdded: number;
    gapsFixed: number;
    completenessImprovement: number;
  };
}

export interface DataSnapshot {
  timestamp: Date;
  totalCandles: number;
  gapCount: number;
  completeness: number;
  dateRange: {
    start: Date;
    end: Date;
  };
}

class DataVerificationService {
  async verifySymbolTimeframe(
    symbol: string,
    timeframe: Timeframe,
    startDate: Date,
    endDate: Date
  ): Promise<VerificationReport> {
    const candles = await this.fetchCandles(symbol, timeframe, startDate, endDate);

    const sequenceIntegrity = this.checkSequenceIntegrity(candles, timeframe);
    const priceValidation = this.checkPriceValidity(candles);
    const gapDetection = await this.checkForGaps(symbol, timeframe, startDate, endDate);
    const duplicateCheck = this.checkForDuplicates(candles);
    const timestampConsistency = this.checkTimestampConsistency(candles, timeframe);

    const allChecks = [
      sequenceIntegrity,
      priceValidation,
      gapDetection,
      duplicateCheck,
      timestampConsistency
    ];

    const failedChecks = allChecks.filter(c => !c.passed);
    const warningChecks = allChecks.filter(c => c.passed && c.score < 100);

    let overall: 'pass' | 'warning' | 'fail';
    if (failedChecks.length > 0) {
      overall = 'fail';
    } else if (warningChecks.length > 0) {
      overall = 'warning';
    } else {
      overall = 'pass';
    }

    const issues: string[] = [];
    const recommendations: string[] = [];

    if (!sequenceIntegrity.passed) {
      issues.push('Candle sequence has gaps or ordering issues');
      recommendations.push('Run backfill operation to fill gaps');
    }

    if (!priceValidation.passed) {
      issues.push('Some candles have invalid price data');
      recommendations.push('Review and repair invalid candles');
    }

    if (!gapDetection.passed) {
      issues.push(`${gapDetection.details?.gapCount || 0} gaps detected in trading hours`);
      recommendations.push('Use gap-specific backfill to fill detected gaps');
    }

    if (!duplicateCheck.passed) {
      issues.push('Duplicate candles detected');
      recommendations.push('Run deduplication process');
    }

    if (!timestampConsistency.passed) {
      issues.push('Timestamp normalization issues detected');
      recommendations.push('Verify timestamp alignment');
    }

    return {
      symbol,
      timeframe,
      dateRange: { start: startDate, end: endDate },
      checks: {
        sequenceIntegrity,
        priceValidation,
        gapDetection,
        duplicateCheck,
        timestampConsistency
      },
      overall,
      issues,
      recommendations
    };
  }

  async createDataSnapshot(
    symbol: string,
    timeframe: Timeframe,
    startDate: Date,
    endDate: Date
  ): Promise<DataSnapshot> {
    const analysis = await gapDetectionService.analyzeSymbolTimeframe(
      symbol,
      timeframe,
      startDate,
      endDate
    );

    return {
      timestamp: new Date(),
      totalCandles: analysis.totalCandles,
      gapCount: analysis.gaps.length,
      completeness: analysis.completenessPercentage,
      dateRange: {
        start: startDate,
        end: endDate
      }
    };
  }

  async compareBeforeAfter(
    symbol: string,
    timeframe: Timeframe,
    startDate: Date,
    endDate: Date,
    beforeSnapshot: DataSnapshot
  ): Promise<ComparisonReport> {
    const afterSnapshot = await this.createDataSnapshot(
      symbol,
      timeframe,
      startDate,
      endDate
    );

    const candlesAdded = afterSnapshot.totalCandles - beforeSnapshot.totalCandles;
    const gapsFixed = beforeSnapshot.gapCount - afterSnapshot.gapCount;
    const completenessImprovement = afterSnapshot.completeness - beforeSnapshot.completeness;

    return {
      beforeBackfill: beforeSnapshot,
      afterBackfill: afterSnapshot,
      improvement: {
        candlesAdded,
        gapsFixed,
        completenessImprovement
      }
    };
  }

  async verifyOctoberEighth(
    symbols: string[] = ['EURUSD', 'GBPUSD', 'XAUUSD'],
    timeframes: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1']
  ): Promise<Map<string, VerificationReport[]>> {
    const oct8Start = new Date('2024-10-08T00:00:00Z');
    const oct8End = new Date('2024-10-08T23:59:59Z');

    const results = new Map<string, VerificationReport[]>();

    for (const symbol of symbols) {
      const symbolReports: VerificationReport[] = [];

      for (const timeframe of timeframes) {
        const report = await this.verifySymbolTimeframe(
          symbol,
          timeframe,
          oct8Start,
          oct8End
        );

        symbolReports.push(report);

        const statusEmoji = report.overall === 'pass' ? '✅' :
                           report.overall === 'warning' ? '⚠️' : '❌';

        console.log(
          `${statusEmoji} ${symbol} ${timeframe}: ${report.overall.toUpperCase()} - ` +
          `${report.issues.length} issues`
        );
      }

      results.set(symbol, symbolReports);
    }

    return results;
  }

  async generateVerificationReport(
    verificationResults: Map<string, VerificationReport[]>
  ): Promise<string> {
    let report = '# Data Verification Report\n\n';
    report += `**Generated:** ${new Date().toISOString()}\n\n`;
    report += '---\n\n';

    for (const [symbol, reports] of verificationResults.entries()) {
      report += `## ${symbol}\n\n`;

      const passCount = reports.filter(r => r.overall === 'pass').length;
      const warningCount = reports.filter(r => r.overall === 'warning').length;
      const failCount = reports.filter(r => r.overall === 'fail').length;

      report += `**Summary:** ${passCount} passed, ${warningCount} warnings, ${failCount} failed\n\n`;

      for (const result of reports) {
        const statusEmoji = result.overall === 'pass' ? '✅' :
                           result.overall === 'warning' ? '⚠️' : '❌';

        report += `### ${statusEmoji} ${result.timeframe}\n\n`;
        report += `**Status:** ${result.overall.toUpperCase()}\n\n`;

        if (result.issues.length > 0) {
          report += '**Issues:**\n';
          result.issues.forEach(issue => {
            report += `- ${issue}\n`;
          });
          report += '\n';
        }

        report += '**Check Results:**\n';
        report += `- Sequence Integrity: ${result.checks.sequenceIntegrity.score}% - ${result.checks.sequenceIntegrity.message}\n`;
        report += `- Price Validation: ${result.checks.priceValidation.score}% - ${result.checks.priceValidation.message}\n`;
        report += `- Gap Detection: ${result.checks.gapDetection.score}% - ${result.checks.gapDetection.message}\n`;
        report += `- Duplicate Check: ${result.checks.duplicateCheck.score}% - ${result.checks.duplicateCheck.message}\n`;
        report += `- Timestamp Consistency: ${result.checks.timestampConsistency.score}% - ${result.checks.timestampConsistency.message}\n`;
        report += '\n';

        if (result.recommendations.length > 0) {
          report += '**Recommendations:**\n';
          result.recommendations.forEach(rec => {
            report += `- ${rec}\n`;
          });
          report += '\n';
        }
      }

      report += '---\n\n';
    }

    return report;
  }

  private async fetchCandles(
    symbol: string,
    timeframe: Timeframe,
    startDate: Date,
    endDate: Date
  ): Promise<CandleData[]> {
    const { data, error } = await supabase
      .from('market_data')
      .select('*')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .gte('timestamp', startDate.toISOString())
      .lte('timestamp', endDate.toISOString())
      .order('timestamp', { ascending: true });

    if (error) {
      console.error('Error fetching candles for verification:', error);
      return [];
    }

    return (data || []).map(row => ({
      symbol: row.symbol,
      timeframe: row.timeframe,
      time: new Date(row.timestamp),
      brokerTime: row.broker_time || row.timestamp,
      open: parseFloat(row.open),
      high: parseFloat(row.high),
      low: parseFloat(row.low),
      close: parseFloat(row.close),
      tickVolume: row.tick_volume || 0,
      spread: row.spread || 0,
      volume: parseFloat(row.volume) || 0
    }));
  }

  private checkSequenceIntegrity(candles: CandleData[], timeframe: Timeframe): CheckResult {
    if (candles.length === 0) {
      return {
        passed: false,
        score: 0,
        message: 'No candles found'
      };
    }

    const validationResult = dataValidator.validateCandleSequence(candles, timeframe);

    if (validationResult.isValid) {
      return {
        passed: true,
        score: 100,
        message: 'Candle sequence is valid'
      };
    }

    const errorRate = (validationResult.errors.length / candles.length) * 100;
    const score = Math.max(0, 100 - errorRate * 2);

    return {
      passed: score >= 95,
      score: Math.round(score),
      message: `${validationResult.errors.length} sequence errors detected`,
      details: validationResult.errors.slice(0, 5)
    };
  }

  private checkPriceValidity(candles: CandleData[]): CheckResult {
    let invalidCount = 0;

    for (const candle of candles) {
      if (
        candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || candle.close <= 0 ||
        candle.high < candle.low ||
        candle.high < candle.open || candle.high < candle.close ||
        candle.low > candle.open || candle.low > candle.close
      ) {
        invalidCount++;
      }
    }

    const invalidRate = candles.length > 0 ? (invalidCount / candles.length) * 100 : 0;
    const score = Math.max(0, 100 - invalidRate * 10);

    return {
      passed: invalidCount === 0,
      score: Math.round(score),
      message: invalidCount === 0
        ? 'All candles have valid prices'
        : `${invalidCount} candles with invalid prices`,
      details: { invalidCount }
    };
  }

  private async checkForGaps(
    symbol: string,
    timeframe: Timeframe,
    startDate: Date,
    endDate: Date
  ): Promise<CheckResult> {
    const analysis = await gapDetectionService.analyzeSymbolTimeframe(
      symbol,
      timeframe,
      startDate,
      endDate
    );

    const criticalGaps = analysis.gaps.filter(g => g.severity === 'critical' && g.isTradingHours);
    const score = Math.round(analysis.completenessPercentage);

    return {
      passed: criticalGaps.length === 0 && score >= 95,
      score,
      message: criticalGaps.length === 0
        ? `No critical gaps (${analysis.gaps.length} minor gaps)`
        : `${criticalGaps.length} critical gaps detected`,
      details: {
        gapCount: analysis.gaps.length,
        criticalGaps: criticalGaps.length,
        completeness: analysis.completenessPercentage
      }
    };
  }

  private checkForDuplicates(candles: CandleData[]): CheckResult {
    const timestamps = candles.map(c => c.time.getTime());
    const uniqueTimestamps = new Set(timestamps);
    const duplicateCount = timestamps.length - uniqueTimestamps.size;

    const duplicateRate = candles.length > 0 ? (duplicateCount / candles.length) * 100 : 0;
    const score = Math.max(0, 100 - duplicateRate * 5);

    return {
      passed: duplicateCount === 0,
      score: Math.round(score),
      message: duplicateCount === 0
        ? 'No duplicate timestamps'
        : `${duplicateCount} duplicate timestamps detected`,
      details: { duplicateCount }
    };
  }

  private checkTimestampConsistency(candles: CandleData[], timeframe: Timeframe): CheckResult {
    if (candles.length === 0) {
      return {
        passed: true,
        score: 100,
        message: 'No candles to check'
      };
    }

    const timeframeMinutes = this.getTimeframeMinutes(timeframe);
    const expectedIntervalMs = timeframeMinutes * 60 * 1000;

    let inconsistentCount = 0;

    for (const candle of candles) {
      const timestamp = candle.time.getTime();
      const normalizedTimestamp = Math.floor(timestamp / expectedIntervalMs) * expectedIntervalMs;

      if (timestamp !== normalizedTimestamp) {
        inconsistentCount++;
      }
    }

    const inconsistentRate = (inconsistentCount / candles.length) * 100;
    const score = Math.max(0, 100 - inconsistentRate * 5);

    return {
      passed: inconsistentCount === 0,
      score: Math.round(score),
      message: inconsistentCount === 0
        ? 'All timestamps properly aligned'
        : `${inconsistentCount} timestamps not aligned to timeframe`,
      details: { inconsistentCount }
    };
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
}

export const dataVerificationService = new DataVerificationService();
