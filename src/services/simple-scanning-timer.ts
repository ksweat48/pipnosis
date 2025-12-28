/**
 * Simple Scanning Timer Service
 *
 * Replaces the complex state machine with a simple 15-minute timer:
 * - Scan for 15 minutes
 * - If no trade found → show continuation modal
 * - User chooses: Continue (reset timer) or Stop (end session)
 * - 1-minute auto-timeout if no response
 *
 * Same rules for all users (no admin bypass)
 *
 * CRITICAL: Includes client-side fallback to ensure sessions close
 * even if server-side autonomous monitor fails
 */

import { supabase } from '../lib/supabase';

export interface ScanningTimerStatus {
  elapsedMinutes: number;
  shouldShowModal: boolean;
  awaitingConfirmation: boolean;
  timeoutExpiresAt: string | null;
  sessionStatus: string;
}

const TIMEOUT_THRESHOLD_MINUTES = 15;
const SAFETY_NET_MINUTES = 20;
const MAX_RETRY_ATTEMPTS = 3;

class SimpleScanningTimerService {
  private forceCloseAttempts: Map<string, number> = new Map();
  /**
   * Check if we should show the continuation modal
   */
  async shouldShowContinuationModal(sessionId: string): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc('should_show_continuation_modal', {
        p_session_id: sessionId
      });

      if (error) {
        console.error('[Scanning Timer] Error checking modal status:', error);
        return false;
      }

      return data || false;
    } catch (error) {
      console.error('[Scanning Timer] Exception checking modal status:', error);
      return false;
    }
  }

  /**
   * Get elapsed scanning minutes
   */
  async getElapsedMinutes(sessionId: string): Promise<number> {
    try {
      const { data, error } = await supabase.rpc('get_scanning_elapsed_minutes', {
        p_session_id: sessionId
      });

      if (error) {
        console.error('[Scanning Timer] Error getting elapsed time:', error);
        return 0;
      }

      return data || 0;
    } catch (error) {
      console.error('[Scanning Timer] Exception getting elapsed time:', error);
      return 0;
    }
  }

  /**
   * Trigger the continuation modal
   */
  async triggerContinuationModal(sessionId: string): Promise<void> {
    try {
      console.log('[Scanning Timer] 🕐 15 minutes elapsed - triggering continuation modal');

      const { error } = await supabase.rpc('trigger_continuation_modal', {
        p_session_id: sessionId
      });

      if (error) {
        console.error('[Scanning Timer] Error triggering modal:', error);
        throw error;
      }

      console.log('[Scanning Timer] ✅ Modal triggered - awaiting user response');
    } catch (error) {
      console.error('[Scanning Timer] Exception triggering modal:', error);
      throw error;
    }
  }

  /**
   * Handle user response to continuation modal
   */
  async handleContinuationResponse(
    sessionId: string,
    continueScanning: boolean
  ): Promise<void> {
    try {
      console.log(`[Scanning Timer] User choice: ${continueScanning ? 'Continue' : 'Stop'}`);

      const { error } = await supabase.rpc('handle_continuation_response', {
        p_session_id: sessionId,
        p_continue_scanning: continueScanning
      });

      if (error) {
        console.error('[Scanning Timer] Error handling response:', error);
        throw error;
      }

      if (continueScanning) {
        console.log('[Scanning Timer] ✅ Timer reset - scanning for another 15 minutes');
      } else {
        console.log('[Scanning Timer] ✅ Session stopped by user');
      }
    } catch (error) {
      console.error('[Scanning Timer] Exception handling response:', error);
      throw error;
    }
  }

  /**
   * Check if modal has timed out and auto-close if needed
   */
  async checkModalTimeout(sessionId: string): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc('check_continuation_modal_timeout', {
        p_session_id: sessionId
      });

      if (error) {
        console.error('[Scanning Timer] Error checking timeout:', error);
        return false;
      }

      if (data) {
        console.log('[Scanning Timer] ⏰ Modal timed out - session auto-closed');
      }

      return data || false;
    } catch (error) {
      console.error('[Scanning Timer] Exception checking timeout:', error);
      return false;
    }
  }

  /**
   * Get current scanning timer status
   */
  async getTimerStatus(sessionId: string): Promise<ScanningTimerStatus | null> {
    try {
      const { data: session, error } = await supabase
        .from('goal_sessions')
        .select('scanning_started_at, awaiting_continuation_confirmation, continuation_confirmation_expires_at, status')
        .eq('id', sessionId)
        .maybeSingle();

      if (error || !session) {
        console.error('[Scanning Timer] Error fetching status:', error);
        return null;
      }

      let elapsedMinutes = 0;
      if (session.scanning_started_at) {
        const elapsed = Date.now() - new Date(session.scanning_started_at).getTime();
        elapsedMinutes = Math.floor(elapsed / 60000);
      }

      const shouldShowModal = await this.shouldShowContinuationModal(sessionId);

      return {
        elapsedMinutes,
        shouldShowModal,
        awaitingConfirmation: session.awaiting_continuation_confirmation || false,
        timeoutExpiresAt: session.continuation_confirmation_expires_at,
        sessionStatus: session.status
      };
    } catch (error) {
      console.error('[Scanning Timer] Exception getting status:', error);
      return null;
    }
  }

  /**
   * Initialize scanning timer for a new session
   */
  async initializeTimer(sessionId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('goal_sessions')
        .update({
          scanning_started_at: new Date().toISOString(),
          awaiting_continuation_confirmation: false,
          continuation_confirmation_expires_at: null
        })
        .eq('id', sessionId);

      if (error) {
        console.error('[Scanning Timer] Error initializing timer:', error);
        throw error;
      }

      console.log('[Scanning Timer] ✅ Timer initialized - scanning for 15 minutes');
    } catch (error) {
      console.error('[Scanning Timer] Exception initializing timer:', error);
      throw error;
    }
  }

  /**
   * Reset timer when trade is found (prevents modal from showing)
   */
  async resetTimerOnTradeFound(sessionId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('goal_sessions')
        .update({
          scanning_started_at: new Date().toISOString(),
          awaiting_continuation_confirmation: false,
          continuation_confirmation_expires_at: null
        })
        .eq('id', sessionId);

      if (error) {
        console.error('[Scanning Timer] Error resetting timer:', error);
        return;
      }

      console.log('[Scanning Timer] ✅ Timer reset - trade found!');
    } catch (error) {
      console.error('[Scanning Timer] Exception resetting timer:', error);
    }
  }

  /**
   * CLIENT-SIDE FALLBACK: Check and enforce timeout locally
   * This runs as a backup if server-side autonomous monitor fails
   */
  async clientSideTimeoutCheck(sessionId: string): Promise<{
    shouldTriggerModal: boolean;
    shouldForceClose: boolean;
    timedOut: boolean;
    elapsedMinutes: number;
  }> {
    try {
      const { data: session, error } = await supabase
        .from('goal_sessions')
        .select('scanning_started_at, start_time, created_at, status, awaiting_continuation_confirmation, continuation_confirmation_expires_at')
        .eq('id', sessionId)
        .maybeSingle();

      if (error || !session) {
        return { shouldTriggerModal: false, shouldForceClose: false, timedOut: false, elapsedMinutes: 0 };
      }

      const scanningStartedAt = session.scanning_started_at || session.start_time || session.created_at;
      if (!scanningStartedAt) {
        return { shouldTriggerModal: false, shouldForceClose: false, timedOut: false, elapsedMinutes: 0 };
      }

      const elapsed = Date.now() - new Date(scanningStartedAt).getTime();
      const elapsedMinutes = Math.floor(elapsed / 60000);

      // Check 1: Modal timeout expired - force close
      if (session.awaiting_continuation_confirmation && session.continuation_confirmation_expires_at) {
        const expiresAt = new Date(session.continuation_confirmation_expires_at);
        if (new Date() > expiresAt) {
          console.log('[Scanning Timer] ⏰ CLIENT-SIDE: Modal timeout expired - forcing close');
          return { shouldTriggerModal: false, shouldForceClose: true, timedOut: true, elapsedMinutes };
        }
      }

      // Check 2: Safety net - scanning >20 minutes without modal
      if (session.status === 'scanning' || session.status === 'trade_pending') {
        if (elapsedMinutes >= SAFETY_NET_MINUTES && !session.awaiting_continuation_confirmation) {
          console.log('[Scanning Timer] ⚠️ CLIENT-SIDE: Safety net - >20min without modal, forcing close');
          return { shouldTriggerModal: false, shouldForceClose: true, timedOut: true, elapsedMinutes };
        }

        // Check 3: 15 minutes elapsed - should trigger modal
        if (elapsedMinutes >= TIMEOUT_THRESHOLD_MINUTES && !session.awaiting_continuation_confirmation) {
          console.log('[Scanning Timer] 🕐 CLIENT-SIDE: 15 minutes elapsed - triggering modal');
          return { shouldTriggerModal: true, shouldForceClose: false, timedOut: false, elapsedMinutes };
        }
      }

      return { shouldTriggerModal: false, shouldForceClose: false, timedOut: false, elapsedMinutes };
    } catch (error) {
      console.error('[Scanning Timer] Exception in client-side timeout check:', error);
      return { shouldTriggerModal: false, shouldForceClose: false, timedOut: false, elapsedMinutes: 0 };
    }
  }

  /**
   * CLIENT-SIDE FALLBACK: Trigger continuation modal from client
   */
  async clientTriggerModal(sessionId: string): Promise<boolean> {
    try {
      console.log('[Scanning Timer] 🔔 CLIENT-SIDE: Triggering continuation modal');

      const { data, error } = await supabase.rpc('client_trigger_continuation_modal', {
        p_session_id: sessionId
      });

      if (error) {
        console.error('[Scanning Timer] Error in client trigger:', error);
        return false;
      }

      if (data) {
        console.log('[Scanning Timer] ✅ CLIENT-SIDE: Modal triggered successfully');
      }

      return data || false;
    } catch (error) {
      console.error('[Scanning Timer] Exception in client trigger:', error);
      return false;
    }
  }

  /**
   * CLIENT-SIDE FALLBACK: Force close a stale session
   * Includes circuit breaker to prevent infinite retry loops
   */
  async forceCloseStaleSession(sessionId: string): Promise<boolean> {
    try {
      // Circuit breaker: Check retry count
      const attempts = this.forceCloseAttempts.get(sessionId) || 0;
      if (attempts >= MAX_RETRY_ATTEMPTS) {
        console.warn(`[Scanning Timer] ⛔ Circuit breaker engaged - exceeded ${MAX_RETRY_ATTEMPTS} attempts for session ${sessionId}`);
        // Clear the counter after sufficient backoff
        setTimeout(() => {
          this.forceCloseAttempts.delete(sessionId);
        }, 60000); // Reset after 1 minute
        return false;
      }

      console.log('[Scanning Timer] 🛑 CLIENT-SIDE: Force closing stale session');

      // Increment attempt counter
      this.forceCloseAttempts.set(sessionId, attempts + 1);

      const { data, error } = await supabase.rpc('force_close_stale_session', {
        p_session_id: sessionId
      });

      if (error) {
        console.error('[Scanning Timer] Error force closing:', error);
        // Keep the attempt counter (will prevent retries if max reached)
        return false;
      }

      if (data) {
        console.log('[Scanning Timer] ✅ CLIENT-SIDE: Session force closed');
        // Success - clear the counter
        this.forceCloseAttempts.delete(sessionId);
      }

      return data || false;
    } catch (error) {
      console.error('[Scanning Timer] Exception force closing:', error);
      return false;
    }
  }

  /**
   * Full client-side timeout enforcement - call this periodically
   * Returns true if an action was taken (modal triggered or session closed)
   */
  async enforceTimeoutClientSide(sessionId: string): Promise<boolean> {
    const check = await this.clientSideTimeoutCheck(sessionId);

    if (check.shouldForceClose) {
      const closed = await this.forceCloseStaleSession(sessionId);
      return closed;
    }

    if (check.shouldTriggerModal) {
      const triggered = await this.clientTriggerModal(sessionId);
      return triggered;
    }

    return false;
  }
}

export const simpleScanningTimer = new SimpleScanningTimerService();
