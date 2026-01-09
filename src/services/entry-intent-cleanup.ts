/**
 * Entry Intent Cleanup Service - SSOT for Intent Lifecycle Management
 *
 * Handles automatic cleanup of expired, orphaned, and invalid entry intents.
 * Prevents stale intents from being resumed on page load.
 */

import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

export interface CleanupResult {
  expiredIntents: number;
  orphanedIntents: number;
  invalidatedIntents: number;
  totalCleaned: number;
}

export class EntryIntentCleanupService {
  /**
   * Clean up expired intents (past their timeout_at timestamp)
   */
  static async cleanupExpiredIntents(userId: string): Promise<number> {
    try {
      const now = new Date().toISOString();

      const { data, error } = await supabase
        .from('entry_intents')
        .update({
          status: 'timeout',
          canceled_at: now,
          canceled_reason: 'Automatically timed out - exceeded timeout_at'
        })
        .eq('user_id', userId)
        .eq('status', 'monitoring')
        .lt('timeout_at', now)
        .select('id');

      if (error) {
        logger.error('[IntentCleanup] Error cleaning expired intents:', error);
        return 0;
      }

      const count = data?.length || 0;
      if (count > 0) {
        logger.info(`[IntentCleanup] Cleaned up ${count} expired intents`);
      }

      return count;
    } catch (error) {
      logger.error('[IntentCleanup] Exception cleaning expired intents:', error);
      return 0;
    }
  }

  /**
   * Clean up orphaned intents (no active session or session doesn't exist)
   */
  static async cleanupOrphanedIntents(userId: string): Promise<number> {
    try {
      const now = new Date().toISOString();

      // Get all monitoring intents with their sessions
      const { data: intents, error: fetchError } = await supabase
        .from('entry_intents')
        .select('id, session_id, goal_sessions!inner(id, status)')
        .eq('user_id', userId)
        .eq('status', 'monitoring');

      if (fetchError) {
        logger.error('[IntentCleanup] Error fetching intents for orphan check:', fetchError);
        return 0;
      }

      if (!intents || intents.length === 0) {
        return 0;
      }

      // Find intents with inactive sessions
      const orphanedIntentIds = intents
        .filter((intent: any) => {
          const session = intent.goal_sessions;
          return !session || session.status !== 'active';
        })
        .map((intent: any) => intent.id);

      if (orphanedIntentIds.length === 0) {
        return 0;
      }

      // Mark orphaned intents as canceled
      const { error: updateError } = await supabase
        .from('entry_intents')
        .update({
          status: 'canceled',
          canceled_at: now,
          canceled_reason: 'Session no longer active'
        })
        .in('id', orphanedIntentIds);

      if (updateError) {
        logger.error('[IntentCleanup] Error updating orphaned intents:', updateError);
        return 0;
      }

      logger.info(`[IntentCleanup] Cleaned up ${orphanedIntentIds.length} orphaned intents`);
      return orphanedIntentIds.length;
    } catch (error) {
      logger.error('[IntentCleanup] Exception cleaning orphaned intents:', error);
      return 0;
    }
  }

  /**
   * Clean up intents where session_id is null (should never happen, but handle it)
   */
  static async cleanupIntentsWithoutSession(userId: string): Promise<number> {
    try {
      const now = new Date().toISOString();

      const { data, error } = await supabase
        .from('entry_intents')
        .update({
          status: 'canceled',
          canceled_at: now,
          canceled_reason: 'No session ID - invalid intent'
        })
        .eq('user_id', userId)
        .eq('status', 'monitoring')
        .is('session_id', null)
        .select('id');

      if (error) {
        logger.error('[IntentCleanup] Error cleaning intents without session:', error);
        return 0;
      }

      const count = data?.length || 0;
      if (count > 0) {
        logger.info(`[IntentCleanup] Cleaned up ${count} intents without session_id`);
      }

      return count;
    } catch (error) {
      logger.error('[IntentCleanup] Exception cleaning intents without session:', error);
      return 0;
    }
  }

  /**
   * Comprehensive cleanup - runs all cleanup operations
   */
  static async performFullCleanup(userId: string): Promise<CleanupResult> {
    logger.info(`[IntentCleanup] Starting full cleanup for user ${userId}`);

    const expiredIntents = await this.cleanupExpiredIntents(userId);
    const orphanedIntents = await this.cleanupOrphanedIntents(userId);
    const invalidatedIntents = await this.cleanupIntentsWithoutSession(userId);

    const totalCleaned = expiredIntents + orphanedIntents + invalidatedIntents;

    const result: CleanupResult = {
      expiredIntents,
      orphanedIntents,
      invalidatedIntents,
      totalCleaned
    };

    if (totalCleaned > 0) {
      logger.info(`[IntentCleanup] Full cleanup complete:`, result);
    }

    return result;
  }
}

export const entryIntentCleanupService = EntryIntentCleanupService;
