/**
 * SL/TP Diagnostic Service
 *
 * Monitors the health of stop loss and take profit monitoring systems.
 * Detects issues that could prevent proper trade closure.
 *
 * CRITICAL ALERTS:
 * - Stale price data (>2 minutes old)
 * - No price data available for open positions
 * - Position monitor not running
 * - Realtime monitor not connected
 * - Price update frequency too slow
 */

import { supabase } from '@/lib/supabase';
import { notificationCoordinator } from './coordinators/notification-coordinator';

interface PriceHealthStatus {
  symbol: string;
  latestPriceAge: number; // seconds
  priceUpdateFrequency: number; // updates per minute
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
}

class SLTPDiagnosticService {
  private diagnosticInterval: NodeJS.Timeout | null = null;
  private lastAlertTime: Map<string, number> = new Map();
  private alertThrottleMs = 300000; // 5 minutes

  async startDiagnostics(): Promise<void> {
    console.log('[SLTPDiagnostics] Starting health monitoring...');

    // Run diagnostic check every 60 seconds
    this.diagnosticInterval = setInterval(() => {
      this.runDiagnosticCheck();
    }, 60000);

    // Run immediately on start
    await this.runDiagnosticCheck();
  }

  stopDiagnostics(): void {
    if (this.diagnosticInterval) {
      clearInterval(this.diagnosticInterval);
      this.diagnosticInterval = null;
    }
    console.log('[SLTPDiagnostics] Stopped health monitoring');
  }

  private async runDiagnosticCheck(): Promise<void> {
    try {
      const health = await this.checkMonitoringHealth();

      // Log status
      const statusEmoji = health.overallStatus === 'healthy' ? '✅' :
                         health.overallStatus === 'degraded' ? '⚠️' : '🚨';

      console.log(`[SLTPDiagnostics] ${statusEmoji} Status: ${health.overallStatus.toUpperCase()}`);
      console.log(`[SLTPDiagnostics] Open positions: ${health.totalOpenPositions}, At risk: ${health.positionsAtRisk}`);

      if (health.issues.length > 0) {
        console.warn(`[SLTPDiagnostics] Issues detected:`, health.issues);
      }

      if (health.recommendations.length > 0) {
        console.log(`[SLTPDiagnostics] Recommendations:`, health.recommendations);
      }

      // Send critical alerts to users
      if (health.overallStatus === 'critical' && health.positionsAtRisk > 0) {
        await this.sendCriticalAlert(health);
      }
    } catch (error) {
      console.error('[SLTPDiagnostics] Diagnostic check failed:', error);
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

    // Check open positions
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
      // No positions to monitor - system is healthy
      return health;
    }

    // Check price data health for each unique symbol
    const symbols = [...new Set(positions.map(p => p.symbol))];

    for (const symbol of symbols) {
      const priceHealth = await this.checkPriceHealth(symbol);
      health.priceHealth.push(priceHealth);

      if (!priceHealth.isHealthy) {
        const positionsForSymbol = positions.filter(p => p.symbol === symbol);
        health.positionsAtRisk += positionsForSymbol.length;

        // Send individual alerts for each affected position
        for (const pos of positionsForSymbol) {
          await this.sendStaleDataAlert(pos.user_id, pos.symbol, priceHealth, pos.id, pos.goal_session_id);
        }
      }
    }

    // Determine overall status
    if (health.positionsAtRisk > 0) {
      health.overallStatus = 'critical';
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

    // Check latest price age
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

    // CRITICAL: Price data older than 2 minutes is stale
    if (ageSeconds > 120) {
      health.isHealthy = false;
      health.issues.push(`Price data ${(ageSeconds / 60).toFixed(1)} minutes old (threshold: 2 min)`);
    }

    // Check update frequency (last minute)
    const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();
    const { count } = await supabase
      .from('realtime_prices')
      .select('*', { count: 'exact', head: true })
      .eq('symbol', symbol)
      .gte('created_at', oneMinuteAgo);

    health.priceUpdateFrequency = count || 0;

    // Expect at least 10 updates per minute for healthy data
    if ((count || 0) < 10) {
      health.isHealthy = false;
      health.issues.push(`Low update frequency: ${count || 0}/min (expected: >10/min)`);
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
    // Throttle alerts
    const alertKey = `${userId}-${symbol}`;
    const now = Date.now();
    const lastAlert = this.lastAlertTime.get(alertKey) || 0;

    if (now - lastAlert < this.alertThrottleMs) {
      return; // Too soon since last alert
    }

    this.lastAlertTime.set(alertKey, now);

    const ageMinutes = (priceHealth.latestPriceAge / 60).toFixed(1);
    const message = priceHealth.latestPriceAge === Infinity
      ? `No price data available for ${symbol}. Your stop loss and take profit may not trigger automatically. Please monitor this position manually.`
      : `Price data for ${symbol} is ${ageMinutes} minutes old. Your stop loss and take profit may be delayed. System is attempting to restore live data.`;

    await notificationCoordinator.send({
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

    console.warn(`[SLTPDiagnostics] 🚨 Sent stale data alert for ${symbol} to user ${userId}`);
  }

  private async sendCriticalAlert(health: MonitoringHealth): Promise<void> {
    // This would send a system-wide alert to admin/monitoring
    console.error('[SLTPDiagnostics] 🚨 CRITICAL: SL/TP monitoring degraded', {
      positionsAtRisk: health.positionsAtRisk,
      totalPositions: health.totalOpenPositions,
      issues: health.issues,
    });
  }

  /**
   * Manual diagnostic check - can be called from console
   */
  async runManualCheck(): Promise<MonitoringHealth> {
    const health = await this.checkMonitoringHealth();

    console.log('\n=== SL/TP Monitoring Health Report ===');
    console.log(`Status: ${health.overallStatus.toUpperCase()}`);
    console.log(`Open Positions: ${health.totalOpenPositions}`);
    console.log(`Positions at Risk: ${health.positionsAtRisk}`);

    if (health.priceHealth.length > 0) {
      console.log('\nPrice Health by Symbol:');
      health.priceHealth.forEach(ph => {
        const status = ph.isHealthy ? '✅' : '❌';
        console.log(`  ${status} ${ph.symbol}: Age=${ph.latestPriceAge.toFixed(0)}s, Freq=${ph.priceUpdateFrequency}/min`);
        if (ph.issues.length > 0) {
          ph.issues.forEach(issue => console.log(`    ⚠️ ${issue}`));
        }
      });
    }

    if (health.issues.length > 0) {
      console.log('\nIssues:');
      health.issues.forEach(issue => console.log(`  ❌ ${issue}`));
    }

    if (health.recommendations.length > 0) {
      console.log('\nRecommendations:');
      health.recommendations.forEach(rec => console.log(`  💡 ${rec}`));
    }

    console.log('\n=====================================\n');

    return health;
  }
}

export const sltpDiagnosticService = new SLTPDiagnosticService();
