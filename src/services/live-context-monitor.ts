import { enhancedMarketRegimeDetector } from './enhanced-market-regime-detector';
import { economicCalendarService } from './economic-calendar-service';
import { currencyCorrelationService } from './currency-correlation-service';

/**
 * Live Context Monitor
 *
 * Real-time tracking of market context for trading decisions:
 * - Market regime updates every 5 minutes
 * - Economic event countdown
 * - Correlation matrix refresh
 * - Session transitions
 */

export interface LiveContext {
  symbol: string;
  timestamp: Date;

  // Market State
  regime: string;
  volatility: string;
  session: string;
  trendStrength: number;

  // Event Awareness
  nextEventMinutes: number;
  nextEventName?: string;
  inDangerZone: boolean;

  // Correlation
  correlatedPairs: Array<{ pair: string; correlation: number }>;
  portfolioRisk: number;

  // Recommendations
  tradingAllowed: boolean;
  recommendation: string;
}

class LiveContextMonitor {
  private updateInterval: NodeJS.Timeout | null = null;
  private currentContext: Map<string, LiveContext> = new Map();

  /**
   * Start monitoring a symbol
   */
  async startMonitoring(
    userId: string,
    symbol: string,
    updateIntervalMs: number = 300000 // 5 minutes
  ): Promise<void> {
    console.log(`[Live Context] Starting monitoring for ${symbol}...`);

    // Initial update
    await this.updateContext(userId, symbol);

    // Set up periodic updates
    this.updateInterval = setInterval(async () => {
      await this.updateContext(userId, symbol);
    }, updateIntervalMs);
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * Get current context
   */
  getCurrentContext(symbol: string): LiveContext | null {
    return this.currentContext.get(symbol) || null;
  }

  /**
   * Update context for a symbol
   */
  private async updateContext(userId: string, symbol: string): Promise<void> {
    try {
      // Detect regime
      const regime = await enhancedMarketRegimeDetector.detectRegime(userId, symbol, 'H1');

      // Check economic events
      const eventAnalysis = await economicCalendarService.analyzeEventImpact(symbol, 60);

      // Get correlation data
      const correlationMatrix = await this.getRelevantCorrelations(symbol);

      // Build context
      const context: LiveContext = {
        symbol,
        timestamp: new Date(),
        regime: regime?.regimeType || 'unknown',
        volatility: regime?.volatilityLevel || 'medium',
        session: regime?.sessionType || 'london',
        trendStrength: regime?.trendStrength || 0,
        nextEventMinutes: eventAnalysis.minutesUntilNextEvent,
        nextEventName: eventAnalysis.upcomingEvents[0]?.eventName,
        inDangerZone: eventAnalysis.inDangerZone,
        correlatedPairs: correlationMatrix,
        portfolioRisk: 1.0,
        tradingAllowed: eventAnalysis.safeToProceed,
        recommendation: this.generateRecommendation(regime, eventAnalysis)
      };

      this.currentContext.set(symbol, context);

      console.log(`[Live Context] ${symbol}: ${context.regime} | ${context.session} | Safe: ${context.tradingAllowed}`);

    } catch (error) {
      console.error(`[Live Context] Error updating context for ${symbol}:`, error);
    }
  }

  /**
   * Get relevant correlations for a symbol
   */
  private async getRelevantCorrelations(symbol: string): Promise<Array<{ pair: string; correlation: number }>> {
    const majorPairs = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF'];
    const correlations: Array<{ pair: string; correlation: number }> = [];

    for (const pair of majorPairs) {
      if (pair === symbol) continue;

      const correlation = await currencyCorrelationService.getCorrelation(symbol, pair);
      if (correlation) {
        correlations.push({
          pair,
          correlation: correlation.correlationCoefficient
        });
      }
    }

    return correlations.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation)).slice(0, 3);
  }

  /**
   * Generate recommendation
   */
  private generateRecommendation(regime: any, eventAnalysis: any): string {
    if (eventAnalysis.inDangerZone) {
      return `⚠️ Event danger zone - avoid trading`;
    }

    if (regime?.regimeType === 'ranging' && regime?.volatilityLevel === 'low') {
      return `⚡ Low volatility range - use mean reversion strategies`;
    }

    if (regime?.regimeType.includes('trending') && regime?.sessionType === 'overlap') {
      return `🚀 Excellent trending conditions during ${regime.sessionType} session`;
    }

    return `✅ Normal trading conditions`;
  }
}

export const liveContextMonitor = new LiveContextMonitor();
