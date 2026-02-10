import { supabase } from '@/lib/supabase';
import { logger, LogCategory } from '@/lib/logger';
import { TIME_CONSTANTS, TIME_MS } from '@/config/time-constants';
import { notificationCoordinator } from './coordinators/notification-coordinator';

const CAT = LogCategory.SLTP_DIAGNOSTICS;

const MIN_UPDATE_FREQUENCY = 3;

interface PriceHealthStatus {
  symbol: string;
  latestPriceAge: number;
  priceUpdateFrequency: number;
  isHealthy: boolean;
  issues: string[];
}

interface MonitoringHealth {
  pollingMonitorActive: boolean;
  realtimeMonitorActive: boolean;
  totalOpenPositions: number;
  positionsAtRisk: number;
  priceHealth: PriceHealthStatus[];
  overallStatus: 'healthy' | 'degraded' | 'critical';
  recommendations: string[];
  issues: string[];
}

class SLTPDiagnosticService {
  private diagnosticInterval: NodeJS.Timeout | null = null;
  private lastAlertTime: Map<string, number> = new Map();
  private alertThrottleMs = TIME_MS.TIMEOUTS.EXTENDED;

  async startDiagnostics(): Promise<void> {
    logger.info(CAT, 'Starting health monitoring');

    this.diagnosticInterval = setInterval(() => {
      this.runDiagnosticCheck();
    }, TIME_MS.TIMEOUTS.STANDARD);

    await this.runDiagnosticCheck();
  }

  stopDiagnostics(): void {
    if (this.diagnosticInterval) {
      clearInterval(this.diagnosticInterval);
      this.diagnosticInterval = null;
    }
    logger.info(CAT, 'Stopped health monitoring');
  }

  private isTabHidden(): boolean {
    return typeof document !== 'undefined' && document.hidden === true;
  }

  private async runDiagnosticCheck(): Promise<void> {
    if (this.isTabHidden()) {
      return;
    }

    try {
      const health = await this.checkMonitoringHealth();

      if (health.overallStatus === 'healthy') {
        logger.debug(CAT, `Status: HEALTHY | Positions: ${health.totalOpenPositions}`);
        return;
      }

      if (health.overallStatus === 'degraded') {
        logger.info(CAT, `Status: DEGRADED | Positions: ${health.totalOpenPositions}, At risk: ${health.positionsAtRisk}`);
        if (health.issues.length > 0) {
          logger.info(CAT, 'Issues:', health.issues);
        }
        return;
      }

      logger.warn(CAT, `Status: CRITICAL | Positions: ${health.totalOpenPositions}, At risk: ${health.positionsAtRisk}`);
      if (health.issues.length > 0) {
        logger.warn(CAT, 'Issues:', health.issues);
      }
      if (health.recommendations.length > 0) {
        logger.warn(CAT, 'Recommendations:', health.recommendations);
      }

      if (health.positionsAtRisk > 0) {
        await this.sendCriticalAlert(health);
      }
    } catch (error) {
      logger.error(CAT, 'Diagnostic check failed:', error);
    }
  }

  private async checkMonitoringHealth(): Promise<MonitoringHealth> {
    const health: MonitoringHealth = {
      pollingMonitorActive: false,
      realtimeMonitorActive: false,
      totalOpenPositions: 0,
      positionsAtRisk: 0,
      priceHealth: [],
      overallStatus: 'healthy',
      issues: [],
      recommendations: [],
    };

    const { data: positions, error: posError } = await supabase
      .from('goal_session_trades')
      .select('id, symbol, user_id, goal_session_id')
      .eq('status', 'open');

    if (posError || !positions) {
      health.issues.push('Failed to fetch open positions');
      health.overallStatus = 'degraded';
      return health;
    }

    health.totalOpenPositions = positions.length;

    if (positions.length === 0) {
      return health;
    }

    const symbols = [...new Set(positions.map(p => p.symbol))];

    for (const symbol of symbols) {
      const priceHealth = await this.checkPriceHealth(symbol);
      health.priceHealth.push(priceHealth);

      if (!priceHealth.isHealthy) {
        const positionsForSymbol = positions.filter(p => p.symbol === symbol);
        health.positionsAtRisk += positionsForSymbol.length;

        for (const pos of positionsForSymbol) {
          await this.sendStaleDataAlert(pos.user_id, pos.symbol, priceHealth, pos.id, pos.goal_session_id);
        }
      }
    }

    if (health.positionsAtRisk > 0) {
      const riskRatio = health.positionsAtRisk / health.totalOpenPositions;
      if (riskRatio > 0.5) {
        health.overallStatus = 'critical';
      } else {
        health.overallStatus = 'degraded';
      }
      health.issues.push(`${health.positionsAtRisk} position(s) have stale/missing price data`);
      health.recommendations.push('Check WebSocket connections and server-side price polling');
    }

    return health;
  }

  private async checkPriceHealth(symbol: string): Promise<PriceHealthStatus> {
    const health: PriceHealthStatus = {
      symbol,
      latestPriceAge: Infinity,
      priceUpdateFrequency: 0,
      isHealthy: true,
      issues: [],
    };

    const { data: latestPrice, error } = await supabase
      .from('realtime_prices')
      .select('created_at')
      .eq('symbol', symbol)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !latestPrice) {
      health.isHealthy = false;
      health.issues.push('No price data available');
      health.latestPriceAge = Infinity;
      return health;
    }

    const ageSeconds = (Date.now() - new Date(latestPrice.created_at).getTime()) / 1000;
    health.latestPriceAge = ageSeconds;

    if (ageSeconds > TIME_CONSTANTS.SECONDS.PRICE_STALENESS_BLOCK_TRADING) {
      health.isHealthy = false;
      health.issues.push(`Price data ${(ageSeconds / 60).toFixed(1)} minutes old (threshold: ${TIME_CONSTANTS.SECONDS.PRICE_STALENESS_BLOCK_TRADING}s)`);
    }

    const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();
    const { count } = await supabase
      .from('realtime_prices')
      .select('*', { count: 'exact', head: true })
      .eq('symbol', symbol)
      .gte('created_at', oneMinuteAgo);

    health.priceUpdateFrequency = count || 0;

    if ((count || 0) < MIN_UPDATE_FREQUENCY) {
      health.isHealthy = false;
      health.issues.push(`Low update frequency: ${count || 0}/min (expected: >${MIN_UPDATE_FREQUENCY}/min)`);
    }

    return health;
  }

  private async sendStaleDataAlert(
    userId: string,
    symbol: string,
    priceHealth: PriceHealthStatus,
    tradeId: string,
    sessionId: string
  ): Promise<void> {
    const alertKey = `${userId}-${symbol}`;
    const now = Date.now();
    const lastAlert = this.lastAlertTime.get(alertKey) || 0;

    if (now - lastAlert < this.alertThrottleMs) {
      return;
    }

    this.lastAlertTime.set(alertKey, now);

    const ageMinutes = (priceHealth.latestPriceAge / 60).toFixed(1);
    const message = priceHealth.latestPriceAge === Infinity
      ? `No price data available for ${symbol}. Your stop loss and take profit may not trigger automatically. Please monitor this position manually.`
      : `Price data for ${symbol} is ${ageMinutes} minutes old. Your stop loss and take profit may be delayed. System is attempting to restore live data.`;

    await notificationCoordinator.sendSystemNotification({
      userId,
      type: 'system_alert',
      title: 'Position Monitoring Alert',
      message,
      tradeId,
      sessionId,
      priority: 'critical',
      metadata: {
        symbol,
        priceAge: priceHealth.latestPriceAge,
        updateFrequency: priceHealth.priceUpdateFrequency,
        issues: priceHealth.issues,
      },
    });

    logger.warn(CAT, `Sent stale data alert for ${symbol} to user ${userId}`);
  }

  private async sendCriticalAlert(health: MonitoringHealth): Promise<void> {
    logger.error(CAT, 'SL/TP monitoring degraded', {
      positionsAtRisk: health.positionsAtRisk,
      totalPositions: health.totalOpenPositions,
      issues: health.issues,
    });
  }

  async runManualCheck(): Promise<MonitoringHealth> {
    const health = await this.checkMonitoringHealth();

    console.log('\n=== SL/TP Monitoring Health Report ===');
    console.log(`Status: ${health.overallStatus.toUpperCase()}`);
    console.log(`Open Positions: ${health.totalOpenPositions}`);
    console.log(`Positions at Risk: ${health.positionsAtRisk}`);

    if (health.priceHealth.length > 0) {
      console.log('\nPrice Health by Symbol:');
      health.priceHealth.forEach(ph => {
        const status = ph.isHealthy ? 'OK' : 'ISSUE';
        console.log(`  [${status}] ${ph.symbol}: Age=${ph.latestPriceAge.toFixed(0)}s, Freq=${ph.priceUpdateFrequency}/min`);
        if (ph.issues.length > 0) {
          ph.issues.forEach(issue => console.log(`    - ${issue}`));
        }
      });
    }

    if (health.issues.length > 0) {
      console.log('\nIssues:');
      health.issues.forEach(issue => console.log(`  - ${issue}`));
    }

    if (health.recommendations.length > 0) {
      console.log('\nRecommendations:');
      health.recommendations.forEach(rec => console.log(`  - ${rec}`));
    }

    console.log('\n=====================================\n');

    return health;
  }
}

export const sltpDiagnosticService = new SLTPDiagnosticService();
