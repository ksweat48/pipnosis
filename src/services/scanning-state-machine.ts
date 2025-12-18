/**
 * Scanning State Machine Service
 *
 * Manages the scanning cycle state machine:
 * - Active: Scanning every 5 minutes for 1 hour (12 scans max)
 * - Cooldown: 15-minute break after each 1-hour session
 * - Lockdown: 12-hour pause after 2.5 hours with no trades
 *
 * Cycle Flow:
 * Session 1 (60 min) → Cooldown (15 min) → Session 2 (60 min) → Cooldown (15 min) → Lockdown (12 hours)
 *
 * Total: 2.5 hours before lockdown
 */

import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

export type ScanningCycleStatus = 'active' | 'cooldown' | 'lockdown';

export interface ScanningState {
  allowed: boolean;
  status: ScanningCycleStatus;
  reason: string;
  message: string;
  sessionNumber?: number;
  scansRemaining?: number;
  secondsRemaining?: number;
  nextScanAt?: string;
  cooldownEndsAt?: string;
  lockdownEndsAt?: string;
}

export interface SessionStatus {
  id: string;
  userId: string;
  scanningCycleStatus: ScanningCycleStatus;
  scanningSessionNumber: number;
  scansInCurrentSession: number;
  totalScansInCycle: number;
  maxScansPerSession: number;
  scanIntervalSeconds: number;
  unlimitedScanning: boolean;
  scanningSessionStartedAt: string | null;
  scanningSessionEndsAt: string | null;
  cooldownStartedAt: string | null;
  cooldownEndsAt: string | null;
  lockdownStartedAt: string | null;
  lockdownEndsAt: string | null;
  lastScanAt: string | null;
  cycleStartedAt: string | null;
  secondsUntilStateChange: number;
  scansRemainingInSession: number;
  secondsUntilNextScan: number;
  secondsInCycle: number;
}

class ScanningStateMachine {
  /**
   * Initialize scanning session with default values
   */
  async initializeSession(sessionId: string, isAdmin: boolean = false): Promise<void> {
    try {
      const { error } = await supabase.rpc('initialize_scanning_session', {
        p_session_id: sessionId,
        p_is_admin: isAdmin
      });

      if (error) throw error;

      logger.info('✅ Scanning session initialized', {
        sessionId,
        isAdmin,
        maxScans: 12,
        interval: '5 minutes'
      });
    } catch (error) {
      logger.error('❌ Failed to initialize scanning session', { error, sessionId });
      throw error;
    }
  }

  /**
   * Check if scanning is allowed right now
   */
  async canScanNow(sessionId: string): Promise<ScanningState> {
    try {
      const { data, error } = await supabase.rpc('can_scan_now', {
        p_session_id: sessionId
      });

      if (error) throw error;

      const state: ScanningState = {
        allowed: data.allowed,
        status: this.mapReasonToStatus(data.reason),
        reason: data.reason,
        message: data.message,
        sessionNumber: data.session_number,
        scansRemaining: data.scans_remaining,
        secondsRemaining: data.seconds_remaining,
        nextScanAt: data.next_scan_at,
        cooldownEndsAt: data.cooldown_ends_at,
        lockdownEndsAt: data.lockdown_ends_at
      };

      logger.debug('🔍 Scan permission check', state);

      return state;
    } catch (error) {
      logger.error('❌ Failed to check scan permission', { error, sessionId });

      // Return safe default
      return {
        allowed: false,
        status: 'active',
        reason: 'error',
        message: 'Unable to check scanning status. Please try again.'
      };
    }
  }

  /**
   * Record that a scan was completed
   * NOTE: This is now a no-op since the simplified 15-minute confirmation system
   * uses time-based checks instead of scan counters.
   */
  async recordScanCompletion(sessionId: string, tradeFound: boolean = false): Promise<void> {
    // No longer needed with simplified scanning system
    // The new system uses time-based continuation checks via should_show_continuation_modal
    logger.debug('📊 Scan completed (tracking via time-based system)', {
      sessionId,
      tradeFound
    });
  }

  /**
   * Manually trigger cooldown (called when session completes)
   */
  async triggerCooldown(sessionId: string): Promise<void> {
    try {
      const { error } = await supabase.rpc('trigger_scanning_cooldown', {
        p_session_id: sessionId
      });

      if (error) throw error;

      logger.info('⏸️ Cooldown triggered', {
        sessionId,
        duration: '15 minutes'
      });
    } catch (error) {
      logger.error('❌ Failed to trigger cooldown', { error, sessionId });
      throw error;
    }
  }

  /**
   * Manually trigger lockdown (called after 2.5 hours)
   */
  async triggerLockdown(sessionId: string): Promise<void> {
    try {
      const { error } = await supabase.rpc('trigger_scanning_lockdown', {
        p_session_id: sessionId
      });

      if (error) throw error;

      logger.warn('🔒 Lockdown triggered', {
        sessionId,
        duration: '12 hours',
        reason: 'No trades found after 2.5 hours'
      });
    } catch (error) {
      logger.error('❌ Failed to trigger lockdown', { error, sessionId });
      throw error;
    }
  }

  /**
   * Reset scanning cycle (after lockdown or manual reset)
   */
  async resetCycle(sessionId: string): Promise<void> {
    try {
      const { error } = await supabase.rpc('reset_scanning_cycle', {
        p_session_id: sessionId
      });

      if (error) throw error;

      logger.info('🔄 Scanning cycle reset', { sessionId });
    } catch (error) {
      logger.error('❌ Failed to reset cycle', { error, sessionId });
      throw error;
    }
  }

  /**
   * Get current scanning status for dashboard display
   */
  async getSessionStatus(sessionId: string): Promise<SessionStatus | null> {
    try {
      const { data, error } = await supabase
        .from('scanning_status_dashboard')
        .select('*')
        .eq('id', sessionId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // Session not found or not in active/scanning status
          return null;
        }
        throw error;
      }

      return {
        id: data.id,
        userId: data.user_id,
        scanningCycleStatus: data.scanning_cycle_status,
        scanningSessionNumber: data.scanning_session_number,
        scansInCurrentSession: data.scans_in_current_session,
        totalScansInCycle: data.total_scans_in_cycle,
        maxScansPerSession: data.max_scans_per_session,
        scanIntervalSeconds: data.scan_interval_seconds,
        unlimitedScanning: data.unlimited_scanning,
        scanningSessionStartedAt: data.scanning_session_started_at,
        scanningSessionEndsAt: data.scanning_session_ends_at,
        cooldownStartedAt: data.cooldown_started_at,
        cooldownEndsAt: data.cooldown_ends_at,
        lockdownStartedAt: data.lockdown_started_at,
        lockdownEndsAt: data.lockdown_ends_at,
        lastScanAt: data.last_scan_at,
        cycleStartedAt: data.cycle_started_at,
        secondsUntilStateChange: data.seconds_until_state_change,
        scansRemainingInSession: data.scans_remaining_in_session,
        secondsUntilNextScan: data.seconds_until_next_scan,
        secondsInCycle: data.seconds_in_cycle
      };
    } catch (error) {
      logger.error('❌ Failed to get session status', { error, sessionId });
      return null;
    }
  }

  /**
   * Subscribe to scanning status changes
   */
  subscribeToSessionStatus(
    sessionId: string,
    callback: (status: SessionStatus | null) => void
  ): () => void {
    const channel = supabase
      .channel(`scanning-status-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'goal_sessions',
          filter: `id=eq.${sessionId}`
        },
        async () => {
          const status = await this.getSessionStatus(sessionId);
          callback(status);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }

  /**
   * Format countdown time for display
   */
  formatCountdown(seconds: number): string {
    if (seconds <= 0) return '0:00';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Get human-readable status message
   */
  getStatusMessage(status: SessionStatus): string {
    switch (status.scanningCycleStatus) {
      case 'active':
        return `Session ${status.scanningSessionNumber}/2 - ${status.scansRemainingInSession} scans remaining`;

      case 'cooldown':
        return `15-minute break - Session ${status.scanningSessionNumber} complete`;

      case 'lockdown':
        return 'Scanning paused - Markets unfavorable';

      default:
        return 'Unknown status';
    }
  }

  /**
   * Check if user is admin (has unlimited scanning)
   */
  async isUnlimitedScanning(sessionId: string): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from('goal_sessions')
        .select('unlimited_scanning')
        .eq('id', sessionId)
        .single();

      if (error) throw error;

      return data?.unlimited_scanning || false;
    } catch (error) {
      logger.error('❌ Failed to check unlimited scanning', { error, sessionId });
      return false;
    }
  }

  /**
   * Enable unlimited scanning for admin user
   */
  async enableUnlimitedScanning(sessionId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('goal_sessions')
        .update({
          unlimited_scanning: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', sessionId);

      if (error) throw error;

      logger.info('👑 Unlimited scanning enabled', { sessionId });
    } catch (error) {
      logger.error('❌ Failed to enable unlimited scanning', { error, sessionId });
      throw error;
    }
  }

  /**
   * Disable unlimited scanning
   */
  async disableUnlimitedScanning(sessionId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('goal_sessions')
        .update({
          unlimited_scanning: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', sessionId);

      if (error) throw error;

      logger.info('🔓 Unlimited scanning disabled', { sessionId });
    } catch (error) {
      logger.error('❌ Failed to disable unlimited scanning', { error, sessionId });
      throw error;
    }
  }

  /**
   * Map reason code to status
   */
  private mapReasonToStatus(reason: string): ScanningCycleStatus {
    if (reason.includes('lockdown')) return 'lockdown';
    if (reason.includes('cooldown')) return 'cooldown';
    return 'active';
  }
}

// Export singleton instance
export const scanningStateMachine = new ScanningStateMachine();
