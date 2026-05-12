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

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import {
  getActiveEntryIntent,
  getEntryIntentById,
  getRecentlyFinalizedIntent,
  type EntryIntentData
} from '../services/entry-intent-monitor-mode';

interface UseActiveEntryIntentResult {
  activeIntent: EntryIntentData | null;
  finalizedIntent: EntryIntentData | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

const REALTIME_RELOAD_DEBOUNCE_MS = 300;

/**
 * Hook to get active entry intent for a session.
 *
 * CCIP-2026-0513D fixes:
 * - Active channel only returns monitoring | executed (never leaks finalized rows).
 * - Separate finalizedIntent channel surfaces recently canceled/abandoned/timeout
 *   intents so the UI can render an explicit "ended" state instead of unmounting.
 * - useEffect depends on [sessionId] only; loadIntent is held in a ref to prevent
 *   subscription churn when parent re-renders.
 * - Realtime-driven reloads are coalesced through a 300ms debounce so heartbeat
 *   bursts collapse to a single reload.
 */
export function useActiveEntryIntent(sessionId: string | null): UseActiveEntryIntentResult {
  const [activeIntent, setActiveIntent] = useState<EntryIntentData | null>(null);
  const [finalizedIntent, setFinalizedIntent] = useState<EntryIntentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const sessionIdRef = useRef<string | null>(sessionId);
  sessionIdRef.current = sessionId;

  const loadIntent = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) {
      setActiveIntent(null);
      setFinalizedIntent(null);
      setLoading(false);
      return;
    }

    try {
      setError(null);

      const [active, finalized] = await Promise.all([
        getActiveEntryIntent(sid),
        getRecentlyFinalizedIntent(sid)
      ]);

      setActiveIntent(active);
      // Only surface a finalized intent if no active one exists — an active
      // monitoring intent always wins over a dead one.
      setFinalizedIntent(active ? null : finalized);
    } catch (err) {
      console.error('[useActiveEntryIntent] Error loading intent:', err);
      setError(err instanceof Error ? err : new Error('Failed to load entry intent'));
      setActiveIntent(null);
      setFinalizedIntent(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadIntentRef = useRef(loadIntent);
  loadIntentRef.current = loadIntent;

  useEffect(() => {
    loadIntentRef.current();

    if (!sessionId) {
      return;
    }

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let debounceHandle: ReturnType<typeof setTimeout> | null = null;

    const scheduleReload = () => {
      if (debounceHandle) clearTimeout(debounceHandle);
      debounceHandle = setTimeout(() => {
        loadIntentRef.current();
      }, REALTIME_RELOAD_DEBOUNCE_MS);
    };

    try {
      channel = supabase
        .channel(`entry-intents-${sessionId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'entry_intents',
            filter: `session_id=eq.${sessionId}`
          },
          (payload) => {
            if (payload.eventType === 'INSERT') {
              scheduleReload();
            } else if (payload.eventType === 'UPDATE') {
              const oldStatus = payload.old?.status;
              const newStatus = payload.new?.status;
              // Only reload on real status transitions; ignore heartbeat-only updates.
              if (oldStatus && newStatus && oldStatus !== newStatus) {
                scheduleReload();
              }
            } else if (payload.eventType === 'DELETE') {
              scheduleReload();
            }
          }
        )
        .subscribe();
    } catch (error) {
      console.log('[useActiveEntryIntent] Realtime subscription error:', error);
    }

    return () => {
      if (debounceHandle) clearTimeout(debounceHandle);
      if (channel) {
        try {
          supabase.removeChannel(channel);
        } catch {
          // cleanup errors are non-critical
        }
      }
    };
  }, [sessionId]);

  return {
    activeIntent,
    finalizedIntent,
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
