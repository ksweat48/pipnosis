import { supabase } from '../lib/supabase';

export interface BacktestDiagnostics {
  dataAvailability: {
    symbols: {
      [symbol: string]: {
        [timeframe: string]: {
          count: number;
          earliest: string | null;
          latest: string | null;
          hasGaps: boolean;
        };
      };
    };
  };
  dateValidation: {
    startDateInPast: boolean;
    endDateInPast: boolean;
    rangeDays: number;
    isReasonableRange: boolean;
  };
  systemHealth: {
    databaseConnected: boolean;
    tablesExist: boolean;
    flowV2Ready: boolean;
    aiReasoningConfigured: boolean;
  };
  recommendations: string[];
  criticalIssues: string[];
  warnings: string[];
}

export class BacktestDiagnosticsService {
  async runFullDiagnostics(
    symbols: string[],
    startDate: Date,
    endDate: Date
  ): Promise<BacktestDiagnostics> {
    console.log('[Diagnostics] Running full backtest diagnostics...');

    const diagnostics: BacktestDiagnostics = {
      dataAvailability: { symbols: {} },
      dateValidation: {
        startDateInPast: false,
        endDateInPast: false,
        rangeDays: 0,
        isReasonableRange: false
      },
      systemHealth: {
        databaseConnected: false,
        tablesExist: false,
        flowV2Ready: false,
        aiReasoningConfigured: false
      },
      recommendations: [],
      criticalIssues: [],
      warnings: []
    };

    // Check date validation
    await this.validateDates(diagnostics, startDate, endDate);

    // Check data availability
    await this.checkDataAvailability(diagnostics, symbols, startDate, endDate);

    // Check system health
    await this.checkSystemHealth(diagnostics);

    // Generate recommendations
    this.generateRecommendations(diagnostics);

    // Print summary
    this.printDiagnosticsSummary(diagnostics);

    return diagnostics;
  }

  private async validateDates(
    diagnostics: BacktestDiagnostics,
    startDate: Date,
    endDate: Date
  ): Promise<void> {
    const now = new Date();

    diagnostics.dateValidation.startDateInPast = startDate < now;
    diagnostics.dateValidation.endDateInPast = endDate < now;
    diagnostics.dateValidation.rangeDays = Math.floor(
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    diagnostics.dateValidation.isReasonableRange =
      diagnostics.dateValidation.rangeDays >= 1 &&
      diagnostics.dateValidation.rangeDays <= 365;

    if (!diagnostics.dateValidation.startDateInPast) {
      diagnostics.criticalIssues.push(
        `Start date (${startDate.toISOString()}) is in the future! Historical data doesn't exist yet.`
      );
    }

    if (!diagnostics.dateValidation.endDateInPast) {
      diagnostics.criticalIssues.push(
        `End date (${endDate.toISOString()}) is in the future! Historical data doesn't exist yet.`
      );
    }

    if (diagnostics.dateValidation.rangeDays < 1) {
      diagnostics.warnings.push(
        `Date range is very short (${diagnostics.dateValidation.rangeDays} days). Consider at least 7 days.`
      );
    }

    if (diagnostics.dateValidation.rangeDays > 90) {
      diagnostics.warnings.push(
        `Date range is very long (${diagnostics.dateValidation.rangeDays} days). This may take significant time.`
      );
    }
  }

  private async checkDataAvailability(
    diagnostics: BacktestDiagnostics,
    symbols: string[],
    startDate: Date,
    endDate: Date
  ): Promise<void> {
    const timeframes = ['1h', '5m', '1m'];
    const minRequired = { '1h': 50, '5m': 100, '1m': 100 };

    for (const symbol of symbols) {
      diagnostics.dataAvailability.symbols[symbol] = {};

      for (const timeframe of timeframes) {
        try {
          const { data, error } = await supabase
            .from('forex_candles')
            .select('open_time')
            .eq('symbol', symbol)
            .eq('timeframe', timeframe)
            .gte('open_time', startDate.toISOString())
            .lte('open_time', endDate.toISOString())
            .order('open_time', { ascending: true });

          if (error) {
            diagnostics.criticalIssues.push(
              `Database error checking ${symbol} ${timeframe}: ${error.message}`
            );
            continue;
          }

          const count = data?.length || 0;
          const earliest = data && data.length > 0 ? data[0].open_time : null;
          const latest = data && data.length > 0 ? data[data.length - 1].open_time : null;

          diagnostics.dataAvailability.symbols[symbol][timeframe] = {
            count,
            earliest,
            latest,
            hasGaps: false // TODO: Implement gap detection
          };

          if (count === 0) {
            diagnostics.criticalIssues.push(
              `No ${timeframe} candles found for ${symbol} in date range ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`
            );
          } else if (count < minRequired[timeframe as keyof typeof minRequired]) {
            diagnostics.warnings.push(
              `Only ${count} ${timeframe} candles for ${symbol} (Flow V2 needs ${minRequired[timeframe as keyof typeof minRequired]}+). Signals may not generate.`
            );
          }

        } catch (error) {
          diagnostics.criticalIssues.push(
            `Error checking data for ${symbol} ${timeframe}: ${error}`
          );
        }
      }
    }
  }

  private async checkSystemHealth(
    diagnostics: BacktestDiagnostics
  ): Promise<void> {
    // Check database connection
    try {
      const { error } = await supabase.from('forex_candles').select('id').limit(1);
      diagnostics.systemHealth.databaseConnected = !error;
      diagnostics.systemHealth.tablesExist = !error;

      if (error) {
        diagnostics.criticalIssues.push(`Database connection error: ${error.message}`);
      }
    } catch (error) {
      diagnostics.criticalIssues.push(`Cannot connect to database: ${error}`);
    }

    // Check if backtest tables exist
    try {
      const { error: sessionError } = await supabase
        .from('backtest_sessions')
        .select('id')
        .limit(1);

      const { error: tradesError } = await supabase
        .from('backtest_trades')
        .select('id')
        .limit(1);

      if (sessionError || tradesError) {
        diagnostics.warnings.push('Backtest tables may not be properly configured');
      }
    } catch (error) {
      diagnostics.warnings.push('Could not verify backtest tables');
    }

    // Flow V2 is code-based, always ready if system is running
    diagnostics.systemHealth.flowV2Ready = true;

    // Check AI reasoning (OpenAI API key)
    const hasOpenAIKey = !!(
      (typeof import.meta !== 'undefined' && import.meta.env?.VITE_OPENAI_API_KEY) ||
      (typeof process !== 'undefined' && process.env?.VITE_OPENAI_API_KEY)
    );

    diagnostics.systemHealth.aiReasoningConfigured = hasOpenAIKey;

    if (!hasOpenAIKey) {
      diagnostics.warnings.push(
        'OpenAI API key not configured. AI reasoning will use fallback logic.'
      );
    }
  }

  private generateRecommendations(diagnostics: BacktestDiagnostics): void {
    // If no critical issues, provide optimization suggestions
    if (diagnostics.criticalIssues.length === 0) {
      diagnostics.recommendations.push('System appears healthy. Ready to run backtest.');

      if (!diagnostics.systemHealth.aiReasoningConfigured) {
        diagnostics.recommendations.push(
          'Enable GPT-4 reasoning by adding VITE_OPENAI_API_KEY to environment for enhanced decision-making.'
        );
      }

      if (diagnostics.dateValidation.rangeDays < 7) {
        diagnostics.recommendations.push(
          'Consider using at least 7 days of data for more statistically significant results.'
        );
      }
    } else {
      diagnostics.recommendations.push(
        'Fix critical issues before running backtest. Check console for detailed error messages.'
      );
    }

    // Data-specific recommendations
    for (const [symbol, timeframes] of Object.entries(diagnostics.dataAvailability.symbols)) {
      const hasAllData = Object.values(timeframes).every(tf => tf.count > 0);

      if (!hasAllData) {
        diagnostics.recommendations.push(
          `Load historical data for ${symbol} using the data management tools or backfill scripts.`
        );
      }
    }
  }

  private printDiagnosticsSummary(diagnostics: BacktestDiagnostics): void {
    console.log('\n' + '='.repeat(60));
    console.log('BACKTEST DIAGNOSTICS SUMMARY');
    console.log('='.repeat(60));

    // Critical Issues
    if (diagnostics.criticalIssues.length > 0) {
      console.log('\n🛑 CRITICAL ISSUES:');
      diagnostics.criticalIssues.forEach(issue => console.log(`  ❌ ${issue}`));
    }

    // Warnings
    if (diagnostics.warnings.length > 0) {
      console.log('\n⚠️  WARNINGS:');
      diagnostics.warnings.forEach(warning => console.log(`  ⚠️  ${warning}`));
    }

    // System Health
    console.log('\n🏥 SYSTEM HEALTH:');
    console.log(`  Database: ${diagnostics.systemHealth.databaseConnected ? '✅' : '❌'}`);
    console.log(`  Tables: ${diagnostics.systemHealth.tablesExist ? '✅' : '❌'}`);
    console.log(`  Flow V2: ${diagnostics.systemHealth.flowV2Ready ? '✅' : '❌'}`);
    console.log(`  AI Reasoning: ${diagnostics.systemHealth.aiReasoningConfigured ? '✅' : '⚠️  (fallback mode)'}`);

    // Data Availability
    console.log('\n📊 DATA AVAILABILITY:');
    for (const [symbol, timeframes] of Object.entries(diagnostics.dataAvailability.symbols)) {
      console.log(`  ${symbol}:`);
      for (const [tf, data] of Object.entries(timeframes)) {
        const status = data.count > 0 ? '✅' : '❌';
        console.log(`    ${tf}: ${status} ${data.count} candles (${data.earliest || 'N/A'} to ${data.latest || 'N/A'})`);
      }
    }

    // Recommendations
    if (diagnostics.recommendations.length > 0) {
      console.log('\n💡 RECOMMENDATIONS:');
      diagnostics.recommendations.forEach(rec => console.log(`  • ${rec}`));
    }

    console.log('\n' + '='.repeat(60));
    console.log(`Status: ${diagnostics.criticalIssues.length === 0 ? '✅ READY' : '❌ NOT READY'}`);
    console.log('='.repeat(60) + '\n');
  }

  async quickDataCheck(symbol: string, timeframe: string): Promise<{
    hasData: boolean;
    count: number;
    dateRange: { start: string | null; end: string | null };
  }> {
    const { data } = await supabase
      .from('forex_candles')
      .select('open_time')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .order('open_time', { ascending: true });

    const count = data?.length || 0;

    return {
      hasData: count > 0,
      count,
      dateRange: {
        start: data && data.length > 0 ? data[0].open_time : null,
        end: data && data.length > 0 ? data[data.length - 1].open_time : null
      }
    };
  }
}

export const backtestDiagnostics = new BacktestDiagnosticsService();
