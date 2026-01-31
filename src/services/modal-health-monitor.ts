/**
 * Modal Health Monitor Service (CCIP + Governance Compliant)
 *
 * Monitors all modal states for stuck modals and automatic recovery.
 * SSOT: Single authoritative system for modal health tracking.
 * All state changes logged to governance system.
 *
 * Responsibilities:
 * - Detect modals stuck > 10 minutes
 * - Log all modal lifecycle events
 * - Automatic force-close recovery
 * - Emit health alerts for stuck modals
 */

import { supabase } from '../lib/supabase';
import TinyEmitter from 'tiny-emitter';
import { logger, LogLevel } from '../lib/logger';

export interface ModalHealthEvent {
  modalId?: string;
  modalType: string;
  eventType: 'opened' | 'action_triggered' | 'dismissed' | 'auto_closed' | 'error' | 'force_closed';
  timestamp: number;
  userId: string;
  details?: Record<string, any>;
}

class ModalHealthMonitor extends TinyEmitter {
  private cleanupCheckInterval: NodeJS.Timeout | null = null;
  private readonly STUCK_THRESHOLD_MINUTES = 10;
  private readonly CHECK_INTERVAL_MS = 2 * 60 * 1000; // Check every 2 minutes
  private activeModals: Map<string, { openedAt: number; modalType: string }> = new Map();

  constructor() {
    super();
    logger.info('[ModalHealthMonitor] Initialized', LogLevel.INFO);
  }

  /**
   * Log modal event with governance tracking
   * SSOT: All modal events flow through this function
   */
  async logModalEvent(
    userId: string,
    modalId: string | undefined,
    modalType: string,
    eventType: 'opened' | 'action_triggered' | 'dismissed' | 'auto_closed' | 'error' | 'force_closed',
    details?: Record<string, any>
  ): Promise<void> {
    try {
      const event: ModalHealthEvent = {
        modalId,
        modalType,
        eventType,
        timestamp: Date.now(),
        userId,
        details
      };

      // Log to RPC function (SSOT for governance)
      const { error } = await supabase.rpc('log_modal_event', {
        p_user_id: userId,
        p_modal_id: modalId,
        p_modal_type: modalType,
        p_event_type: eventType,
        p_event_details: details || {},
        p_service_responsible: 'modal_queue_manager'
      });

      if (error) {
        logger.error('[ModalHealthMonitor] Failed to log event:', error, LogLevel.WARN);
      }

      // Track opened modals for stuck detection
      if (eventType === 'opened' && modalId) {
        this.activeModals.set(modalId, {
          openedAt: Date.now(),
          modalType
        });
      }

      // Remove from tracking on dismissed
      if ((eventType === 'dismissed' || eventType === 'auto_closed' || eventType === 'force_closed') && modalId) {
        this.activeModals.delete(modalId);
      }

      // Emit event for subscribers
      this.emit('modal-event', event);
    } catch (error) {
      logger.error('[ModalHealthMonitor] Exception in logModalEvent:', error, LogLevel.ERROR);
    }
  }

  /**
   * Start automatic stuck modal detection
   */
  startHealthCheck(): void {
    if (this.cleanupCheckInterval) {
      logger.warn('[ModalHealthMonitor] Health check already running', LogLevel.WARN);
      return;
    }

    logger.info('[ModalHealthMonitor] Starting stuck modal detection', LogLevel.INFO);

    this.cleanupCheckInterval = setInterval(() => {
      this.checkForStuckModals();
    }, this.CHECK_INTERVAL_MS);
  }

  /**
   * Stop automatic stuck modal detection
   */
  stopHealthCheck(): void {
    if (this.cleanupCheckInterval) {
      clearInterval(this.cleanupCheckInterval);
      this.cleanupCheckInterval = null;
      logger.info('[ModalHealthMonitor] Stopped stuck modal detection', LogLevel.INFO);
    }
  }

  /**
   * Check for stuck modals and attempt recovery
   * CCIP: All recovery attempts logged to governance
   */
  private async checkForStuckModals(): Promise<void> {
    try {
      const now = Date.now();
      const stuckThresholdMs = this.STUCK_THRESHOLD_MINUTES * 60 * 1000;

      for (const [modalId, modal] of this.activeModals.entries()) {
        const openDurationMs = now - modal.openedAt;

        if (openDurationMs > stuckThresholdMs) {
          logger.warn(
            `[ModalHealthMonitor] Stuck modal detected: ${modal.modalType} (${Math.round(openDurationMs / 1000 / 60)} minutes)`,
            LogLevel.WARN
          );

          // Trigger recovery for each stuck modal
          await this.recoverStuckModal(modalId);
        }
      }

      // Also run RPC cleanup for database-persisted stuck modals
      const { data: result, error } = await supabase.rpc('cleanup_stuck_modals');

      if (error) {
        logger.error('[ModalHealthMonitor] Failed to cleanup stuck modals via RPC:', error, LogLevel.WARN);
      } else if (result && Array.isArray(result) && result[0]) {
        const { recovered_count } = result[0];
        if (recovered_count > 0) {
          logger.info(
            `[ModalHealthMonitor] Auto-recovered ${recovered_count} stuck modal(s)`,
            LogLevel.INFO
          );
          this.emit('stuck-modals-recovered', { count: recovered_count });
        }
      }
    } catch (error) {
      logger.error('[ModalHealthMonitor] Exception in checkForStuckModals:', error, LogLevel.ERROR);
    }
  }

  /**
   * Attempt to recover a stuck modal
   */
  private async recoverStuckModal(modalId: string): Promise<void> {
    try {
      const modal = this.activeModals.get(modalId);
      if (!modal) return;

      // Get user ID from auth
      const { data: authData } = await supabase.auth.getSession();
      const userId = authData?.session?.user?.id;

      if (!userId) {
        logger.warn('[ModalHealthMonitor] Cannot recover stuck modal - no authenticated user', LogLevel.WARN);
        return;
      }

      logger.info(`[ModalHealthMonitor] Attempting to recover stuck modal: ${modalId}`, LogLevel.INFO);

      // Call RPC to force-close the modal
      const { data: recoveryResult, error } = await supabase.rpc('detect_and_recover_stuck_modal', {
        p_user_id: userId,
        p_modal_id: modalId,
        p_stuck_threshold_minutes: this.STUCK_THRESHOLD_MINUTES
      });

      if (error) {
        logger.error('[ModalHealthMonitor] Recovery failed:', error, LogLevel.WARN);
      } else if (recoveryResult?.recovered) {
        logger.info(`[ModalHealthMonitor] Successfully recovered stuck modal: ${modalId}`, LogLevel.INFO);
        this.activeModals.delete(modalId);
        this.emit('modal-recovered', { modalId, modalType: modal.modalType });
      }
    } catch (error) {
      logger.error('[ModalHealthMonitor] Exception in recoverStuckModal:', error, LogLevel.ERROR);
    }
  }

  /**
   * Get current modal health status
   */
  getHealthStatus(): {
    activeModals: number;
    stuckModals: number;
    details: Array<{ modalId: string; type: string; openMinutes: number }>;
  } {
    const now = Date.now();
    const stuckThresholdMs = this.STUCK_THRESHOLD_MINUTES * 60 * 1000;
    const details: Array<{ modalId: string; type: string; openMinutes: number }> = [];
    let stuckCount = 0;

    for (const [modalId, modal] of this.activeModals.entries()) {
      const openDurationMs = now - modal.openedAt;
      const openMinutes = Math.round(openDurationMs / 1000 / 60);

      details.push({
        modalId,
        type: modal.modalType,
        openMinutes
      });

      if (openDurationMs > stuckThresholdMs) {
        stuckCount++;
      }
    }

    return {
      activeModals: this.activeModals.size,
      stuckModals: stuckCount,
      details
    };
  }

  /**
   * Manually dismiss a modal and log the event
   */
  async dismissModal(
    userId: string,
    modalId: string,
    modalType: string,
    closeMethod: 'user_action' | 'auto_dismiss' | 'timeout' | 'error_recovery'
  ): Promise<void> {
    await this.logModalEvent(userId, modalId, modalType, 'dismissed', {
      closeMethod,
      dismissedAt: new Date().toISOString()
    });
  }

  /**
   * Record modal action
   */
  async recordModalAction(
    userId: string,
    modalId: string,
    modalType: string,
    actionType: string,
    actionDetails?: Record<string, any>
  ): Promise<void> {
    await this.logModalEvent(userId, modalId, modalType, 'action_triggered', {
      actionType,
      ...actionDetails
    });
  }
}

export const modalHealthMonitor = new ModalHealthMonitor();
