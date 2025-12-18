import { supabase } from '@/lib/supabase';
import TinyEmitter from 'tiny-emitter';

export interface PendingModal {
  id: string;
  user_id: string;
  goal_session_id: string | null;
  modal_type: 'trade_closed' | 'goal_achieved' | 'session_update';
  modal_data: {
    symbol: string;
    direction: 'buy' | 'sell';
    entry_price: number;
    exit_price: number;
    profit_loss: number;
    close_reason: string;
    current_progress: number;
    target_value: number;
    trades_in_session: number;
    session_status?: string;
    timestamp?: string;
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
    modalType: 'trade_closed' | 'goal_achieved' | 'session_update',
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
        return { success: false, error };
      }

      console.log('[ModalQueueManager] ✅ Pending modal created:', data.id);

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
   */
  async getPendingModals(userId: string): Promise<PendingModal[]> {
    try {
      const { data, error } = await supabase
        .from('pending_user_modals')
        .select('*')
        .eq('user_id', userId)
        .is('dismissed_at', null)
        .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString())
        .order('created_at', { ascending: true });

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
   */
  async dismissModal(
    modalId: string,
    userAction: 'continue' | 'close' | 'acknowledged'
  ): Promise<{ success: boolean; error?: any }> {
    try {
      console.log('[ModalQueueManager] Dismissing modal:', { modalId, userAction });

      const { error } = await supabase
        .from('pending_user_modals')
        .update({
          dismissed_at: new Date().toISOString(),
          user_action: userAction
        })
        .eq('id', modalId);

      if (error) {
        console.error('[ModalQueueManager] Failed to dismiss modal:', error);
        return { success: false, error };
      }

      console.log('[ModalQueueManager] ✅ Modal dismissed');

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
    modalType: 'trade_closed' | 'goal_achieved' | 'session_update'
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
}

export const modalQueueManager = new ModalQueueManager();
