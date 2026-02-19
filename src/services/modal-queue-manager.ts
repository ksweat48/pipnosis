import { supabase } from '@/lib/supabase';
import TinyEmitter from 'tiny-emitter';
import { modalHealthMonitor } from './modal-health-monitor';

export interface PendingModal {
  id: string;
  user_id: string;
  goal_session_id: string | null;
  modal_type: 'trade_closed' | 'goal_achieved' | 'goal_achieved_countdown' | 'session_update' | 'session_ended' | 'entry_edge_loss';
  modal_data: {
    symbol?: string;
    direction?: 'buy' | 'sell' | 'long' | 'short';
    entry_price?: number;
    exit_price?: number;
    profit_loss?: number;
    close_reason?: string;
    current_progress: number;
    target_value: number;
    trades_in_session: number;
    session_status?: string;
    session_id?: string;
    // CCIP FIX (2026-02-19): trade_id used for deduplication across modal paths
    trade_id?: string;
    timestamp?: string;
    duration_minutes?: number;
    final_status?: string;
    message?: string;
    modal_id?: string;
    style?: string;
    entry_zone_min?: number;
    entry_zone_max?: number;
    created_at?: string;
    timeout_minutes?: number;
  };
  created_at: string;
  expires_at: string | null;
  dismissed_at: string | null;
  user_action: string | null;
}

class ModalQueueManager extends TinyEmitter {
  private channel: any = null;
  private currentUserId: string | null = null;

  /**
   * Create a persistent modal that will be shown to user even if they're away
   */
  async createPendingModal(
    userId: string,
    goalSessionId: string | null,
    modalType: 'trade_closed' | 'goal_achieved' | 'goal_achieved_countdown' | 'session_update' | 'session_ended' | 'entry_edge_loss',
    modalData: PendingModal['modal_data']
  ): Promise<{ success: boolean; modalId?: string; error?: any }> {
    try {
      console.log('[ModalQueueManager] Creating pending modal:', {
        userId,
        modalType,
        symbol: modalData.symbol,
        pnl: modalData.profit_loss
      });

      // Add timestamp to modal data
      const dataWithTimestamp = {
        ...modalData,
        timestamp: new Date().toISOString()
      };

      const { data, error } = await supabase
        .from('pending_user_modals')
        .insert({
          user_id: userId,
          goal_session_id: goalSessionId,
          modal_type: modalType,
          modal_data: dataWithTimestamp
        })
        .select()
        .single();

      if (error) {
        console.error('[ModalQueueManager] Failed to create pending modal:', error);
        await modalHealthMonitor.logModalEvent(userId, undefined, modalType, 'error', {
          errorReason: 'Failed to create pending modal',
          error: error?.message
        });
        return { success: false, error };
      }

      console.log('[ModalQueueManager] ✅ Pending modal created:', data.id);

      // Log modal event for governance tracking (CCIP)
      await modalHealthMonitor.logModalEvent(userId, data.id, modalType, 'opened', {
        goalSessionId,
        modalData: modalData
      });

      // Emit event for real-time updates
      this.emit('modal-created', data);

      return { success: true, modalId: data.id };
    } catch (error) {
      console.error('[ModalQueueManager] Exception creating modal:', error);
      return { success: false, error };
    }
  }

  /**
   * Get all pending modals for a user (oldest first)
   * UPDATED: Uses database function that auto-deletes stale modals
   */
  async getPendingModals(userId: string): Promise<PendingModal[]> {
    try {
      // Use database function that auto-deletes stale modals
      const { data, error } = await supabase
        .rpc('get_pending_modals_for_user', { p_user_id: userId });

      if (error) {
        console.error('[ModalQueueManager] Failed to fetch pending modals:', error);
        return [];
      }

      console.log('[ModalQueueManager] Found pending modals:', data?.length || 0);
      return data || [];
    } catch (error) {
      console.error('[ModalQueueManager] Exception fetching modals:', error);
      return [];
    }
  }

  /**
   * Get count of pending modals for badge display
   */
  async getPendingModalCount(userId: string): Promise<number> {
    try {
      const { count, error } = await supabase
        .from('pending_user_modals')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .is('dismissed_at', null)
        .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString());

      if (error) {
        console.error('[ModalQueueManager] Failed to count pending modals:', error);
        return 0;
      }

      return count || 0;
    } catch (error) {
      console.error('[ModalQueueManager] Exception counting modals:', error);
      return 0;
    }
  }

  /**
   * Dismiss a modal after user interacts with it
   * UPDATED: Now DELETES modal instead of just marking dismissed
   */
  async dismissModal(
    modalId: string,
    userAction: 'continue' | 'close' | 'acknowledged'
  ): Promise<{ success: boolean; error?: any }> {
    try {
      console.log('[ModalQueueManager] Dismissing (deleting) modal:', { modalId, userAction });

      // Use database function that DELETES the modal
      const { data, error } = await supabase
        .rpc('dismiss_pending_modal', {
          p_modal_id: modalId,
          p_user_action: userAction
        });

      if (error) {
        console.error('[ModalQueueManager] Failed to dismiss modal:', error);
        // Fallback: direct delete if RPC fails
        const { error: deleteError } = await supabase
          .from('pending_user_modals')
          .delete()
          .eq('id', modalId);

        if (deleteError) {
          console.error('[ModalQueueManager] Fallback delete also failed:', deleteError);
          return { success: false, error: deleteError };
        }
      }

      console.log('[ModalQueueManager] ✅ Modal deleted');

      // Get user ID from auth for governance logging
      const { data: authData } = await supabase.auth.getSession();
      const userId = authData?.session?.user?.id;

      if (userId) {
        // Log modal dismiss event for governance tracking (CCIP)
        await modalHealthMonitor.dismissModal(userId, modalId, 'unknown', 'user_action');
      }

      // Emit event for real-time updates
      this.emit('modal-dismissed', { modalId, userAction });

      return { success: true };
    } catch (error) {
      console.error('[ModalQueueManager] Exception dismissing modal:', error);
      return { success: false, error };
    }
  }

  /**
   * Check if a session already has a pending modal (prevent duplicates)
   */
  async hasSessionPendingModal(
    goalSessionId: string,
    modalType: 'trade_closed' | 'goal_achieved' | 'goal_achieved_countdown' | 'session_update' | 'session_ended'
  ): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from('pending_user_modals')
        .select('id')
        .eq('goal_session_id', goalSessionId)
        .eq('modal_type', modalType)
        .is('dismissed_at', null)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.error('[ModalQueueManager] Error checking for existing modal:', error);
        return false;
      }

      return !!data;
    } catch (error) {
      console.error('[ModalQueueManager] Exception checking for existing modal:', error);
      return false;
    }
  }

  /**
   * Subscribe to real-time modal updates for a user
   */
  subscribeToModalUpdates(userId: string, onUpdate: () => void): void {
    if (this.channel) {
      supabase.removeChannel(this.channel);
    }

    this.currentUserId = userId;

    this.channel = supabase
      .channel(`pending-modals-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pending_user_modals',
          filter: `user_id=eq.${userId}`
        },
        (payload) => {
          console.log('[ModalQueueManager] Real-time modal update:', payload);
          onUpdate();
        }
      )
      .subscribe();

    console.log('[ModalQueueManager] Subscribed to modal updates for user:', userId);
  }

  /**
   * Unsubscribe from real-time updates
   */
  unsubscribeFromModalUpdates(): void {
    if (this.channel) {
      supabase.removeChannel(this.channel);
      this.channel = null;
      console.log('[ModalQueueManager] Unsubscribed from modal updates');
    }
  }

  /**
   * Clean up expired modals manually
   */
  async cleanupExpiredModals(): Promise<number> {
    try {
      const { data, error } = await supabase.rpc('cleanup_expired_pending_modals');

      if (error) {
        console.error('[ModalQueueManager] Failed to cleanup expired modals:', error);
        return 0;
      }

      console.log('[ModalQueueManager] Cleaned up expired modals:', data || 0);
      return data || 0;
    } catch (error) {
      console.error('[ModalQueueManager] Exception cleaning up modals:', error);
      return 0;
    }
  }

  /**
   * Get the oldest pending modal for display
   */
  async getNextPendingModal(userId: string): Promise<PendingModal | null> {
    const modals = await this.getPendingModals(userId);
    return modals.length > 0 ? modals[0] : null;
  }

  /**
   * Delete a modal (for cleanup/testing)
   */
  async deleteModal(modalId: string): Promise<{ success: boolean; error?: any }> {
    try {
      const { error } = await supabase
        .from('pending_user_modals')
        .delete()
        .eq('id', modalId);

      if (error) {
        console.error('[ModalQueueManager] Failed to delete modal:', error);
        return { success: false, error };
      }

      return { success: true };
    } catch (error) {
      console.error('[ModalQueueManager] Exception deleting modal:', error);
      return { success: false, error };
    }
  }

  /**
   * Auto-cleanup stale modals (older than 24 hours)
   * Called automatically when loading pending modals
   */
  private async autoCleanupStaleModals(): Promise<void> {
    try {
      const { data, error } = await supabase.rpc('auto_dismiss_stale_pending_modals');

      if (error) {
        console.error('[ModalQueueManager] Failed to auto-cleanup stale modals:', error);
        return;
      }

      if (data && data > 0) {
        console.log(`[ModalQueueManager] Auto-dismissed ${data} stale modal(s)`);
      }
    } catch (error) {
      console.error('[ModalQueueManager] Exception during auto-cleanup:', error);
    }
  }

  /**
   * Clear all pending modals for current user
   */
  async deleteAllModalsForUser(userId: string): Promise<{ success: boolean; deletedCount?: number; error?: any }> {
    try {
      console.log('[ModalQueueManager] Deleting ALL modals for user:', userId);

      const { data, error } = await supabase
        .rpc('delete_all_pending_modals_for_user', { p_user_id: userId });

      if (error) {
        console.error('[ModalQueueManager] Failed to delete all modals:', error);
        return { success: false, error };
      }

      console.log('[ModalQueueManager] ✅ Deleted all pending modals:', data);

      // Emit event for real-time updates
      this.emit('modals-cleared', { userId, deletedCount: data });

      return { success: true, deletedCount: data || 0 };
    } catch (error) {
      console.error('[ModalQueueManager] Exception deleting all modals:', error);
      return { success: false, error };
    }
  }

  /**
   * Clear all pending modals for all users (admin only)
   */
  async adminClearAllModals(): Promise<{ success: boolean; deletedCount?: number; error?: any }> {
    try {
      const { data, error } = await supabase.rpc('admin_clear_all_pending_modals');

      if (error) {
        console.error('[ModalQueueManager] Failed to clear all modals:', error);
        return { success: false, error };
      }

      console.log('[ModalQueueManager] ✅ Cleared all pending modals:', data);
      return { success: true, deletedCount: data?.[0]?.deleted_count || 0 };
    } catch (error) {
      console.error('[ModalQueueManager] Exception clearing all modals:', error);
      return { success: false, error };
    }
  }
}

export const modalQueueManager = new ModalQueueManager();
