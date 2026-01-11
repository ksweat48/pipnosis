/**
 * useEntryIntent Hook
 *
 * React hook providing SSOT access to entry intent data
 * Wraps entry-intent-monitor-mode.ts functions for React components
 *
 * Architecture:
 * - All database queries go through entry-intent-monitor-mode.ts
 * - Components NEVER directly query entry_intents table
 * - Single source of truth for all entry intent data access
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import {
  getActiveEntryIntent,
  getEntryIntentById,
  type EntryIntentData
} from '../services/entry-intent-monitor-mode';

interface UseActiveEntryIntentResult {
  activeIntent: EntryIntentData | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

/**
 * Hook to get active entry intent for a session
 * SSOT: Uses getActiveEntryIntent from entry-intent-monitor-mode.ts
 */
export function useActiveEntryIntent(sessionId: string | null): UseActiveEntryIntentResult {
  const [activeIntent, setActiveIntent] = useState<EntryIntentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const loadIntent = useCallback(async () => {
    if (!sessionId) {
      setActiveIntent(null);
      setLoading(false);
      return;
    }

    try {
      // Don't toggle loading on refresh - only set false when done
      // Loading is only true on initial mount
      setError(null);

      console.log('[useActiveEntryIntent] 🔄 Loading intent for session:', sessionId.substring(0, 8));

      const intent = await getActiveEntryIntent(sessionId);

      console.log('[useActiveEntryIntent] 📦 Received intent:', {
        hasIntent: !!intent,
        intentId: intent?.id?.substring(0, 8),
        status: intent?.status,
        symbol: intent?.symbol
      });

      setActiveIntent(intent);
    } catch (err) {
      console.error('[useActiveEntryIntent] ❌ Error loading intent:', err);
      setError(err instanceof Error ? err : new Error('Failed to load entry intent'));
      setActiveIntent(null);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    // Initial load
    loadIntent();

    // Set up realtime subscription for entry_intents table changes
    console.log('[useActiveEntryIntent] 📡 Setting up realtime subscription for session:', sessionId.substring(0, 8));

    // Declare channel variable in outer scope so cleanup can access it
    // CRITICAL: Must be declared here, not inside try block, for proper cleanup
    let channel: ReturnType<typeof supabase.channel> | null = null;

    try {
      channel = supabase
        .channel(`entry-intents-${sessionId}`)
        .on(
          'postgres_changes',
          {
            event: '*', // Listen for INSERT, UPDATE, DELETE
            schema: 'public',
            table: 'entry_intents',
            filter: `session_id=eq.${sessionId}`
          },
          (payload) => {
            console.log('[useActiveEntryIntent] 🔔 Realtime update received:', {
              event: payload.eventType,
              intentId: payload.new?.id?.substring(0, 8) || payload.old?.id?.substring(0, 8),
              status: payload.new?.status
            });

            // Smart refresh: Only reload if meaningful fields changed
            if (payload.eventType === 'INSERT') {
              // New intent created - always reload
              console.log('[useActiveEntryIntent] 🆕 New intent detected, reloading...');
              loadIntent();
            } else if (payload.eventType === 'UPDATE') {
              // Check if status changed (meaningful) or just heartbeat (ignore)
              const oldStatus = payload.old?.status;
              const newStatus = payload.new?.status;

              if (oldStatus !== newStatus) {
                console.log('[useActiveEntryIntent] 📊 Status changed, reloading...', {oldStatus, newStatus});
                loadIntent();
              } else {
                console.log('[useActiveEntryIntent] 💓 Heartbeat update, skipping reload');
                // Don't reload - just a heartbeat update
              }
            } else if (payload.eventType === 'DELETE') {
              // Intent removed - clear state
              console.log('[useActiveEntryIntent] 🗑️ Intent deleted');
              setActiveIntent(null);
            }
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log('[useActiveEntryIntent] 📡 Realtime subscription CONNECTED for session:', sessionId.substring(0, 8));
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            // Log as info, not warning - fallback polling will handle updates
            console.log('[useActiveEntryIntent] ℹ️ Realtime subscription unavailable, using polling fallback (normal for some network configs)');
          } else if (status === 'CLOSED') {
            console.log('[useActiveEntryIntent] 📡 Realtime subscription CLOSED');
          }
        });
    } catch (error) {
      console.log('[useActiveEntryIntent] ℹ️ Realtime subscription error, using polling fallback:', error);
    }

    // Set up fallback polling (30 seconds) as safety net
    const pollInterval = setInterval(() => {
      console.log('[useActiveEntryIntent] 🔄 Fallback poll (subscription backup)');
      loadIntent();
    }, 30000);

    // Cleanup function with defensive null checking
    return () => {
      console.log('[useActiveEntryIntent] 🧹 Cleaning up subscription and polling');

      // Defensive cleanup: Check if channel exists before removing
      if (channel) {
        try {
          supabase.removeChannel(channel);
          console.log('[useActiveEntryIntent] ✅ Channel removed successfully');
        } catch (error) {
          // Log but don't throw - cleanup should never crash
          console.log('[useActiveEntryIntent] ⚠️ Error removing channel (non-critical):', error);
        }
      }

      clearInterval(pollInterval);
    };
  }, [loadIntent, sessionId]);

  return {
    activeIntent,
    loading,
    error,
    refresh: loadIntent
  };
}

interface UseEntryIntentByIdResult {
  intent: EntryIntentData | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

/**
 * Hook to get entry intent by ID
 * SSOT: Uses getEntryIntentById from entry-intent-monitor-mode.ts
 */
export function useEntryIntentById(intentId: string | null): UseEntryIntentByIdResult {
  const [intent, setIntent] = useState<EntryIntentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const loadIntent = useCallback(async () => {
    if (!intentId) {
      setIntent(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await getEntryIntentById(intentId);
      setIntent(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load entry intent'));
      setIntent(null);
    } finally {
      setLoading(false);
    }
  }, [intentId]);

  useEffect(() => {
    loadIntent();
  }, [loadIntent]);

  return {
    intent,
    loading,
    error,
    refresh: loadIntent
  };
}
