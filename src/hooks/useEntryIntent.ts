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
      setLoading(true);
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
    loadIntent();
  }, [loadIntent]);

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
