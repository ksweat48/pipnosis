/**
 * Governance Alert Service
 *
 * Automated alerting for SSOT violations and compliance issues.
 *
 * Features:
 * - Configurable thresholds and channels
 * - Rate limiting to prevent alert fatigue
 * - Multi-channel delivery (push, in-app, email)
 * - Severity classification
 * - Integration with existing push notification system
 *
 * Part of Phase 3.3: Governance Monitoring Alerts
 */

import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

export type AlertSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface AlertThresholds {
  critical_compliance_score: number;
  high_violations_per_hour: number;
  component_health_critical: number;
  component_health_high: number;
  violation_spike_threshold: number;
}

export interface AlertChannelConfig {
  push_enabled: boolean;
  in_app_enabled: boolean;
  email_enabled: boolean;
  push_severity: AlertSeverity[];
  in_app_severity: AlertSeverity[];
}

export interface AlertRateLimits {
  same_violation_cooldown_minutes: number;
  max_alerts_per_hour: number;
  aggregation_window_minutes: number;
}

export interface AlertConfig {
  thresholds: AlertThresholds;
  channels: AlertChannelConfig;
  rate_limits: AlertRateLimits;
}

export interface GovernanceAlert {
  alert_type: string;
  alert_key?: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  metadata?: Record<string, any>;
  violation_id?: string;
  component_name?: string;
  action_url?: string;
}

export interface SSOTViolationSummary {
  violation_type: string;
  component_name: string;
  severity: 'error' | 'warning' | 'info';
  count_1h: number;
  count_24h: number;
  last_occurrence: string;
}

class GovernanceAlertService {
  private config: AlertConfig | null = null;
  private configLoadedAt: number = 0;
  private readonly CONFIG_CACHE_TTL = 60000; // 1 minute

  /**
   * Get alert configuration from database (cached)
   */
  async getConfig(): Promise<AlertConfig> {
    // Return cached config if fresh
    if (this.config && Date.now() - this.configLoadedAt < this.CONFIG_CACHE_TTL) {
      return this.config;
    }

    try {
      const { data, error } = await supabase
        .from('governance_alert_config')
        .select('config_key, config_value');

      if (error) throw error;

      if (!data || data.length === 0) {
        // Return default config
        return this.getDefaultConfig();
      }

      const configMap = new Map(data.map(row => [row.config_key, row.config_value]));

      this.config = {
        thresholds: configMap.get('thresholds') || this.getDefaultConfig().thresholds,
        channels: configMap.get('channels') || this.getDefaultConfig().channels,
        rate_limits: configMap.get('rate_limits') || this.getDefaultConfig().rate_limits
      };

      this.configLoadedAt = Date.now();
      return this.config;
    } catch (error) {
      logger.error('Failed to load alert config, using defaults:', error);
      return this.getDefaultConfig();
    }
  }

  /**
   * Get default configuration
   */
  private getDefaultConfig(): AlertConfig {
    return {
      thresholds: {
        critical_compliance_score: 50,
        high_violations_per_hour: 10,
        component_health_critical: 50,
        component_health_high: 70,
        violation_spike_threshold: 10
      },
      channels: {
        push_enabled: true,
        in_app_enabled: true,
        email_enabled: false,
        push_severity: ['CRITICAL', 'HIGH'],
        in_app_severity: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
      },
      rate_limits: {
        same_violation_cooldown_minutes: 30,
        max_alerts_per_hour: 20,
        aggregation_window_minutes: 5
      }
    };
  }

  /**
   * Update alert configuration
   */
  async updateConfig(updates: Partial<AlertConfig>): Promise<void> {
    try {
      const currentConfig = await this.getConfig();
      const newConfig = { ...currentConfig, ...updates };

      // Update each config key
      for (const [key, value] of Object.entries(updates)) {
        const { error } = await supabase
          .from('governance_alert_config')
          .upsert({
            config_key: key,
            config_value: value,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'config_key'
          });

        if (error) throw error;
      }

      // Clear cache to force reload
      this.config = null;
      logger.info('Alert configuration updated:', updates);
    } catch (error) {
      logger.error('Failed to update alert config:', error);
      throw error;
    }
  }

  /**
   * Check if alert should be rate limited
   */
  async checkRateLimit(alertKey: string): Promise<boolean> {
    try {
      const config = await this.getConfig();
      const cooldownMinutes = config.rate_limits.same_violation_cooldown_minutes;

      const { data, error } = await supabase
        .rpc('check_alert_rate_limit', {
          p_alert_key: alertKey,
          p_cooldown_minutes: cooldownMinutes
        });

      if (error) throw error;
      return data === true;
    } catch (error) {
      logger.error('Rate limit check failed:', error);
      // On error, allow alert (fail open)
      return false;
    }
  }

  /**
   * Record that an alert was sent
   */
  async recordAlertSent(alertKey: string): Promise<void> {
    try {
      const { error } = await supabase
        .rpc('record_alert_sent', {
          p_alert_key: alertKey
        });

      if (error) throw error;
    } catch (error) {
      logger.error('Failed to record alert sent:', error);
    }
  }

  /**
   * Check if hourly alert cap is reached
   */
  async isHourlyCapReached(): Promise<boolean> {
    try {
      const config = await this.getConfig();
      const maxPerHour = config.rate_limits.max_alerts_per_hour;

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      const { count, error } = await supabase
        .from('governance_alerts')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', oneHourAgo);

      if (error) throw error;
      return (count || 0) >= maxPerHour;
    } catch (error) {
      logger.error('Failed to check hourly cap:', error);
      return false;
    }
  }

  /**
   * Create and send an alert
   */
  async sendAlert(alert: GovernanceAlert): Promise<string | null> {
    try {
      const config = await this.getConfig();

      // Generate alert key for rate limiting
      const alertKey = alert.alert_key || `${alert.alert_type}_${alert.component_name || 'system'}`;

      // Check rate limiting
      const isRateLimited = await this.checkRateLimit(alertKey);
      if (isRateLimited) {
        logger.info('Alert rate limited:', alertKey);
        return null;
      }

      // Check hourly cap
      const capReached = await this.isHourlyCapReached();
      if (capReached) {
        logger.warn('Hourly alert cap reached, suppressing alert');
        // Send a special "cap reached" alert if this is the first one after cap
        await this.sendCapReachedAlert();
        return null;
      }

      // Determine which channels to send on
      const channelsToSend: string[] = [];

      if (config.channels.in_app_enabled &&
          config.channels.in_app_severity.includes(alert.severity)) {
        channelsToSend.push('in_app');
      }

      if (config.channels.push_enabled &&
          config.channels.push_severity.includes(alert.severity)) {
        channelsToSend.push('push');
      }

      // Create alert in database
      const { data: alertData, error: insertError } = await supabase
        .from('governance_alerts')
        .insert({
          alert_type: alert.alert_type,
          alert_key: alertKey,
          severity: alert.severity,
          title: alert.title,
          message: alert.message,
          metadata: alert.metadata || {},
          violation_id: alert.violation_id,
          component_name: alert.component_name,
          channels_sent: channelsToSend,
          action_url: alert.action_url
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // Record alert sent for rate limiting
      await this.recordAlertSent(alertKey);

      // Send push notification if enabled
      if (channelsToSend.includes('push')) {
        await this.sendPushNotification(alert, alertData.id);
      }

      logger.info('Alert sent:', {
        id: alertData.id,
        type: alert.alert_type,
        severity: alert.severity,
        channels: channelsToSend
      });

      return alertData.id;
    } catch (error) {
      logger.error('Failed to send alert:', error);
      return null;
    }
  }

  /**
   * Send push notification for alert
   */
  private async sendPushNotification(alert: GovernanceAlert, alertId: string): Promise<void> {
    try {
      // Get all admin users with push subscriptions
      const { data: admins, error: adminError } = await supabase
        .from('user_profiles')
        .select('id')
        .eq('is_admin', true);

      if (adminError) throw adminError;

      if (!admins || admins.length === 0) {
        logger.warn('No admin users found for push notification');
        return;
      }

      const adminIds = admins.map(a => a.id);

      // Get push subscriptions for admins
      const { data: subscriptions, error: subError } = await supabase
        .from('push_subscriptions')
        .select('*')
        .in('user_id', adminIds);

      if (subError) throw subError;

      if (!subscriptions || subscriptions.length === 0) {
        logger.warn('No push subscriptions found for admins');
        return;
      }

      // Format notification
      const notification = {
        title: this.getSeverityEmoji(alert.severity) + ' ' + alert.title,
        body: alert.message,
        icon: '/notification-badge.png',
        badge: '/notification-badge.png',
        data: {
          type: 'governance_alert',
          alert_id: alertId,
          violation_id: alert.violation_id,
          severity: alert.severity,
          url: alert.action_url || '/admin?tab=ssot-violations'
        }
      };

      // Queue push notifications
      for (const subscription of subscriptions) {
        const { error } = await supabase
          .from('push_notification_queue')
          .insert({
            user_id: subscription.user_id,
            title: notification.title,
            body: notification.body,
            data: notification.data,
            priority: alert.severity === 'CRITICAL' ? 'high' : 'normal'
          });

        if (error) {
          logger.error('Failed to queue push notification:', error);
        }
      }

      logger.info('Push notifications queued for alert:', alertId);
    } catch (error) {
      logger.error('Failed to send push notification:', error);
    }
  }

  /**
   * Send special alert when hourly cap is reached
   */
  private async sendCapReachedAlert(): Promise<void> {
    // Check if we already sent this alert in the last hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('governance_alerts')
      .select('id')
      .eq('alert_type', 'ALERT_CAP_REACHED')
      .gte('created_at', oneHourAgo)
      .limit(1);

    if (error) {
      logger.error('Failed to check for cap reached alert:', error);
      return;
    }

    if (data && data.length > 0) {
      // Already sent this alert recently
      return;
    }

    const config = await this.getConfig();

    await this.sendAlert({
      alert_type: 'ALERT_CAP_REACHED',
      severity: 'HIGH',
      title: 'Alert Cap Reached',
      message: `Maximum of ${config.rate_limits.max_alerts_per_hour} alerts per hour reached. Subsequent alerts are being suppressed.`,
      action_url: '/admin?tab=settings&section=alerts'
    });
  }

  /**
   * Get emoji for severity level
   */
  private getSeverityEmoji(severity: AlertSeverity): string {
    switch (severity) {
      case 'CRITICAL': return '🚨';
      case 'HIGH': return '⚠️';
      case 'MEDIUM': return '⚡';
      case 'LOW': return 'ℹ️';
      default: return '📢';
    }
  }

  /**
   * Evaluate violation and send alert if threshold met
   */
  async evaluateViolation(violation: {
    id: string;
    violation_type: string;
    component_name: string;
    severity: 'error' | 'warning' | 'info';
    details?: any;
  }): Promise<void> {
    try {
      const config = await this.getConfig();

      // Map violation severity to alert severity
      let alertSeverity: AlertSeverity;
      if (violation.severity === 'error') {
        alertSeverity = 'CRITICAL';
      } else if (violation.severity === 'warning') {
        alertSeverity = 'HIGH';
      } else {
        alertSeverity = 'MEDIUM';
      }

      // Check for critical violation types that always alert
      const criticalTypes = [
        'TRADE_EXECUTION_WITHOUT_VALIDATION',
        'POSITION_SIZING_CALCULATION_ERROR',
        'DATA_CORRUPTION_RISK',
        'PRICE_FRESHNESS_VIOLATION'
      ];

      if (criticalTypes.includes(violation.violation_type)) {
        await this.sendAlert({
          alert_type: violation.violation_type,
          severity: 'CRITICAL',
          title: `Critical Violation: ${violation.violation_type}`,
          message: `Critical SSOT violation detected in ${violation.component_name}`,
          violation_id: violation.id,
          component_name: violation.component_name,
          metadata: violation.details,
          action_url: `/admin?tab=ssot-violations&violation=${violation.id}`
        });
        return;
      }

      // Check for violation spike
      const violationCount = await this.getViolationCount(violation.violation_type, 60);
      if (violationCount >= config.thresholds.violation_spike_threshold) {
        await this.sendAlert({
          alert_type: 'VIOLATION_SPIKE',
          alert_key: `SPIKE_${violation.violation_type}`,
          severity: 'HIGH',
          title: 'Violation Spike Detected',
          message: `${violationCount} ${violation.violation_type} violations in the last hour`,
          component_name: violation.component_name,
          metadata: { count: violationCount, violation_type: violation.violation_type },
          action_url: `/admin?tab=ssot-violations&type=${violation.violation_type}`
        });
      }
    } catch (error) {
      logger.error('Failed to evaluate violation for alert:', error);
    }
  }

  /**
   * Get violation count for a type in the last N minutes
   */
  private async getViolationCount(violationType: string, minutes: number): Promise<number> {
    try {
      const timeAgo = new Date(Date.now() - minutes * 60 * 1000).toISOString();

      const { count, error } = await supabase
        .from('ssot_violations')
        .select('*', { count: 'exact', head: true })
        .eq('violation_type', violationType)
        .gte('created_at', timeAgo);

      if (error) throw error;
      return count || 0;
    } catch (error) {
      logger.error('Failed to get violation count:', error);
      return 0;
    }
  }

  /**
   * Evaluate compliance score and send alert if threshold met
   */
  async evaluateComplianceScore(score: number): Promise<void> {
    try {
      const config = await this.getConfig();

      if (score < config.thresholds.critical_compliance_score) {
        await this.sendAlert({
          alert_type: 'COMPLIANCE_SCORE_CRITICAL',
          alert_key: 'COMPLIANCE_SCORE',
          severity: 'CRITICAL',
          title: 'Critical: Compliance Score Low',
          message: `Platform compliance score dropped to ${score}%. Immediate review required.`,
          metadata: { score },
          action_url: '/admin?tab=ssot-violations'
        });
      }
    } catch (error) {
      logger.error('Failed to evaluate compliance score:', error);
    }
  }

  /**
   * Evaluate component health and send alert if threshold met
   */
  async evaluateComponentHealth(componentName: string, healthScore: number): Promise<void> {
    try {
      const config = await this.getConfig();

      if (healthScore < config.thresholds.component_health_critical) {
        await this.sendAlert({
          alert_type: 'COMPONENT_HEALTH_CRITICAL',
          alert_key: `COMPONENT_${componentName}`,
          severity: 'CRITICAL',
          title: 'Critical: Component Health Low',
          message: `Component '${componentName}' health score: ${healthScore}%`,
          component_name: componentName,
          metadata: { health_score: healthScore },
          action_url: `/admin?tab=ssot-violations&component=${componentName}`
        });
      } else if (healthScore < config.thresholds.component_health_high) {
        await this.sendAlert({
          alert_type: 'COMPONENT_HEALTH_HIGH',
          alert_key: `COMPONENT_${componentName}`,
          severity: 'HIGH',
          title: 'Warning: Component Health Degraded',
          message: `Component '${componentName}' health score: ${healthScore}%`,
          component_name: componentName,
          metadata: { health_score: healthScore },
          action_url: `/admin?tab=ssot-violations&component=${componentName}`
        });
      }
    } catch (error) {
      logger.error('Failed to evaluate component health:', error);
    }
  }

  /**
   * Send test alert (for configuration testing)
   */
  async sendTestAlert(severity: AlertSeverity = 'HIGH'): Promise<string | null> {
    return this.sendAlert({
      alert_type: 'TEST_ALERT',
      severity,
      title: `Test ${severity} Alert`,
      message: `This is a test alert to verify the governance alert system is working correctly.`,
      metadata: { test: true, timestamp: new Date().toISOString() },
      action_url: '/admin?tab=settings&section=alerts'
    });
  }

  /**
   * Get unread alert count for current user
   */
  async getUnreadCount(): Promise<number> {
    try {
      const { data, error } = await supabase.rpc('get_unread_alert_count');
      if (error) throw error;
      return data || 0;
    } catch (error) {
      logger.error('Failed to get unread count:', error);
      return 0;
    }
  }

  /**
   * Mark alert as read
   */
  async markAsRead(alertId: string): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc('mark_alert_as_read', {
        p_alert_id: alertId
      });
      if (error) throw error;
      return data === true;
    } catch (error) {
      logger.error('Failed to mark alert as read:', error);
      return false;
    }
  }

  /**
   * Dismiss alert
   */
  async dismissAlert(alertId: string): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc('dismiss_alert', {
        p_alert_id: alertId
      });
      if (error) throw error;
      return data === true;
    } catch (error) {
      logger.error('Failed to dismiss alert:', error);
      return false;
    }
  }

  /**
   * Get recent alerts
   */
  async getRecentAlerts(limit: number = 50): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('governance_alerts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];
    } catch (error) {
      logger.error('Failed to get recent alerts:', error);
      return [];
    }
  }
}

// Export singleton instance
export const governanceAlertService = new GovernanceAlertService();
