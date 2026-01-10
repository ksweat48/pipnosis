import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import type { ThesisFingerprint, ThesisMemoryEntry, EntryOutcomeReason, EntryOutcomeStatus } from '../types/entry';

/**
 * Entry Thesis Memory Service
 *
 * Prevents infinite loop by remembering abandoned entry theses.
 * Key concept: "EXPIRED" thesis means execution window closed - do NOT rescan same thesis.
 *
 * Architecture:
 * - Generates unique fingerprint for each thesis (symbol + direction + structure)
 * - Tracks lifecycle: ACTIVE → EXPIRED/INVALIDATED/PAUSED
 * - Expires memory after 10 minutes (allows market structure to change)
 * - Provides pre-flight checks before creating new entry intents
 */
class EntryThesisMemoryService {
  private sessionMemoryCache: Map<string, Map<string, ThesisMemoryEntry>>;

  constructor() {
    this.sessionMemoryCache = new Map();
  }

  /**
   * Generate thesis fingerprint from components
   */
  generateFingerprint(
    symbol: string,
    direction: 'BUY' | 'SELL',
    structureAnchor: number,
    timeframe: string = 'M15'
  ): ThesisFingerprint {
    const roundedAnchor = Math.round(structureAnchor * 100) / 100;
    const fingerprint = `${symbol.toLowerCase()}_${direction}_${roundedAnchor}_${timeframe}`;

    return {
      symbol,
      direction,
      structure_anchor: roundedAnchor,
      timeframe,
      fingerprint,
    };
  }

  /**
   * Check if thesis is expired (should NOT be rescanned)
   */
  async isThesisExpired(
    userId: string,
    sessionId: string,
    thesisFingerprint: string
  ): Promise<{ isExpired: boolean; reason?: string; expiresAt?: string }> {
    try {
      const { data: memory, error } = await supabase
        .from('entry_thesis_memory')
        .select('*')
        .eq('user_id', userId)
        .eq('session_id', sessionId)
        .eq('thesis_fingerprint', thesisFingerprint)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        logger.error('Failed to check thesis memory', { error, thesisFingerprint });
        return { isExpired: false };
      }

      if (!memory) {
        return { isExpired: false };
      }

      if (memory.status === 'EXPIRED') {
        const now = new Date();
        const expiresAt = memory.expires_at ? new Date(memory.expires_at) : null;

        if (!expiresAt || expiresAt > now) {
          return {
            isExpired: true,
            reason: `Thesis expired after ${memory.abandonment_count} abandonment(s)`,
            expiresAt: memory.expires_at || undefined,
          };
        }
      }

      return { isExpired: false };
    } catch (error) {
      logger.error('Error checking thesis expiration', { error, thesisFingerprint });
      return { isExpired: false };
    }
  }

  /**
   * Store thesis in memory with status
   */
  async storeThesis(
    userId: string,
    sessionId: string,
    thesis: ThesisFingerprint,
    status: 'ACTIVE' | 'EXPIRED' | 'INVALIDATED' | 'ESCALATED',
    metadata: {
      entryIntentId?: string;
      alphaConfidence?: number;
      abandonmentReason?: EntryOutcomeReason;
      expirationMinutes?: number;
    } = {}
  ): Promise<ThesisMemoryEntry | null> {
    try {
      const expiresAt = metadata.expirationMinutes
        ? new Date(Date.now() + metadata.expirationMinutes * 60 * 1000).toISOString()
        : status === 'EXPIRED'
        ? new Date(Date.now() + 10 * 60 * 1000).toISOString()
        : null;

      const { data, error } = await supabase
        .from('entry_thesis_memory')
        .upsert(
          {
            user_id: userId,
            session_id: sessionId,
            symbol: thesis.symbol,
            direction: thesis.direction,
            structure_anchor: thesis.structure_anchor,
            timeframe: thesis.timeframe,
            thesis_fingerprint: thesis.fingerprint,
            status,
            entry_intent_id: metadata.entryIntentId,
            alpha_confidence: metadata.alphaConfidence,
            expires_at: expiresAt,
            abandonment_count: 1,
          },
          {
            onConflict: 'user_id,session_id,thesis_fingerprint',
            ignoreDuplicates: false,
          }
        )
        .select()
        .single();

      if (error) {
        logger.error('Failed to store thesis memory', { error, thesis });
        return null;
      }

      this.updateSessionCache(sessionId, thesis.fingerprint, data);

      logger.info('Stored thesis in memory', {
        fingerprint: thesis.fingerprint,
        status,
        expiresAt,
      });

      return data;
    } catch (error) {
      logger.error('Error storing thesis memory', { error, thesis });
      return null;
    }
  }

  /**
   * Mark thesis as expired (called when intent is abandoned due to runaway)
   */
  async markThesisExpired(
    entryIntentId: string,
    abandonmentReason: EntryOutcomeReason,
    expirationMinutes: number = 10
  ): Promise<void> {
    try {
      const { error } = await supabase.rpc('mark_thesis_expired', {
        p_entry_intent_id: entryIntentId,
        p_abandonment_reason: abandonmentReason,
        p_expiration_duration: `${expirationMinutes} minutes`,
      });

      if (error) {
        logger.error('Failed to mark thesis as expired', { error, entryIntentId });
      } else {
        logger.info('Marked thesis as expired', { entryIntentId, abandonmentReason });
      }
    } catch (error) {
      logger.error('Error marking thesis expired', { error, entryIntentId });
    }
  }

  /**
   * Get thesis memory for session
   */
  async getSessionThesisMemory(
    userId: string,
    sessionId: string
  ): Promise<ThesisMemoryEntry[]> {
    try {
      const { data, error } = await supabase
        .from('entry_thesis_memory')
        .select('*')
        .eq('user_id', userId)
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false });

      if (error) {
        logger.error('Failed to get session thesis memory', { error, sessionId });
        return [];
      }

      return data || [];
    } catch (error) {
      logger.error('Error getting session thesis memory', { error, sessionId });
      return [];
    }
  }

  /**
   * Get expired theses for session (for debugging/analytics)
   */
  async getExpiredTheses(
    userId: string,
    sessionId: string
  ): Promise<ThesisMemoryEntry[]> {
    try {
      const { data, error } = await supabase
        .from('entry_thesis_memory')
        .select('*')
        .eq('user_id', userId)
        .eq('session_id', sessionId)
        .eq('status', 'EXPIRED')
        .order('created_at', { ascending: false });

      if (error) {
        logger.error('Failed to get expired theses', { error, sessionId });
        return [];
      }

      return data || [];
    } catch (error) {
      logger.error('Error getting expired theses', { error, sessionId });
      return [];
    }
  }

  /**
   * Clear session cache
   */
  clearSessionCache(sessionId: string): void {
    this.sessionMemoryCache.delete(sessionId);
    logger.debug('Cleared session thesis memory cache', { sessionId });
  }

  /**
   * Update in-memory cache
   */
  private updateSessionCache(
    sessionId: string,
    fingerprint: string,
    entry: ThesisMemoryEntry
  ): void {
    if (!this.sessionMemoryCache.has(sessionId)) {
      this.sessionMemoryCache.set(sessionId, new Map());
    }

    this.sessionMemoryCache.get(sessionId)!.set(fingerprint, entry);
  }

  /**
   * Get from cache (fast path)
   */
  getCachedThesis(sessionId: string, fingerprint: string): ThesisMemoryEntry | null {
    const sessionCache = this.sessionMemoryCache.get(sessionId);
    if (!sessionCache) return null;
    return sessionCache.get(fingerprint) || null;
  }

  /**
   * Pre-flight check: Should we create intent for this thesis?
   */
  async shouldCreateIntent(
    userId: string,
    sessionId: string,
    symbol: string,
    direction: 'BUY' | 'SELL',
    entryZoneCenter: number,
    timeframe: string = 'M15'
  ): Promise<{
    allowed: boolean;
    reason?: string;
    fingerprint: string;
    existingMemory?: ThesisMemoryEntry;
  }> {
    const thesis = this.generateFingerprint(symbol, direction, entryZoneCenter, timeframe);

    const cachedEntry = this.getCachedThesis(sessionId, thesis.fingerprint);
    if (cachedEntry && cachedEntry.status === 'EXPIRED') {
      const expiresAt = cachedEntry.expires_at ? new Date(cachedEntry.expires_at) : null;
      if (!expiresAt || expiresAt > new Date()) {
        return {
          allowed: false,
          reason: `Thesis already expired (${cachedEntry.abandonment_count} attempts)`,
          fingerprint: thesis.fingerprint,
          existingMemory: cachedEntry,
        };
      }
    }

    const { isExpired, reason, expiresAt } = await this.isThesisExpired(
      userId,
      sessionId,
      thesis.fingerprint
    );

    if (isExpired) {
      return {
        allowed: false,
        reason: reason || 'Thesis expired',
        fingerprint: thesis.fingerprint,
      };
    }

    return {
      allowed: true,
      fingerprint: thesis.fingerprint,
    };
  }

  /**
   * Cleanup expired thesis memory (called periodically)
   */
  async cleanupExpiredMemory(): Promise<number> {
    try {
      const { data, error } = await supabase.rpc('cleanup_expired_thesis_memory');

      if (error) {
        logger.error('Failed to cleanup expired thesis memory', { error });
        return 0;
      }

      if (data && data > 0) {
        logger.info('Cleaned up expired thesis memory', { count: data });
      }

      return data || 0;
    } catch (error) {
      logger.error('Error cleaning up expired thesis memory', { error });
      return 0;
    }
  }

  /**
   * Update thesis status
   */
  async updateThesisStatus(
    entryIntentId: string,
    status: 'EXECUTED' | 'ESCALATED' | 'INVALIDATED'
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('entry_thesis_memory')
        .update({ status })
        .eq('entry_intent_id', entryIntentId);

      if (error) {
        logger.error('Failed to update thesis status', { error, entryIntentId, status });
      } else {
        logger.debug('Updated thesis status', { entryIntentId, status });
      }
    } catch (error) {
      logger.error('Error updating thesis status', { error, entryIntentId });
    }
  }
}

export const entryThesisMemoryService = new EntryThesisMemoryService();
