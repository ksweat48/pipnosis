/**
 * LLM Call Guard (Advisory Only - SSOT Compliant)
 *
 * ⚠️ CRITICAL: This guard NO LONGER BLOCKS Alpha from thinking.
 *
 * Alpha is the SINGLE SOURCE OF TRUTH for trade decisions.
 * Alpha must ALWAYS be able to call OpenAI to analyze markets and make decisions.
 *
 * The guard now:
 * 1. Logs LLM calls for analytics and monitoring
 * 2. ALWAYS returns allowed=true (never blocks)
 * 3. Tracks state for telemetry purposes only
 * 4. Entry Monitor state is irrelevant to Alpha's ability to think
 *
 * Architecture Decision:
 * - Entry Monitor = Visual advisory (post-execution)
 * - EQS = Informational only
 * - Alpha = Only execution authority (never blocked)
 */

import { supabase } from '../lib/supabase';
import { productionLogger } from '../lib/production-logger';

export interface LLMGuardResult {
  allowed: boolean;
  reason: string;
  state: string;
  violationLogged?: boolean;
}

export interface LLMGuardViolation {
  sessionId: string;
  attemptedCall: string;
  state: string;
  timestamp: Date;
  stackTrace?: string;
}

// DEPRECATED: These states no longer block LLM calls (kept for analytics)
const MONITORED_STATES = [
  'ENTRY_INTENT_CREATED',
  'ENTRY_MONITOR_ACTIVE',
  'EXECUTE_PENDING'
];

const violations: LLMGuardViolation[] = [];
const MAX_VIOLATIONS_LOG = 100;

class LLMCallGuard {
  private sessionStateCache: Map<string, { state: string; timestamp: number }> = new Map();
  private readonly CACHE_TTL_MS = 5000;

  async checkLLMAllowed(sessionId: string, callDescription?: string): Promise<LLMGuardResult> {
    const cached = this.sessionStateCache.get(sessionId);
    const now = Date.now();

    let state: string;

    if (cached && (now - cached.timestamp) < this.CACHE_TTL_MS) {
      state = cached.state;
    } else {
      state = await this.fetchSessionState(sessionId);
      this.sessionStateCache.set(sessionId, { state, timestamp: now });
    }

    // 🔥 CRITICAL: ALWAYS allow LLM calls - Alpha must never be blocked
    const wasMonitored = MONITORED_STATES.includes(state);

    if (wasMonitored) {
      // Log for analytics only - DO NOT BLOCK
      this.logActivity(sessionId, callDescription || 'unknown', state);
    }

    // ALWAYS return allowed=true
    return {
      allowed: true,
      reason: 'Alpha always permitted to analyze markets and make decisions (SSOT)',
      state
    };
  }

  private async fetchSessionState(sessionId: string): Promise<string> {
    try {
      const { data, error } = await supabase
        .from('goal_sessions')
        .select('entry_monitor_state')
        .eq('id', sessionId)
        .maybeSingle();

      if (error || !data) {
        return 'DISCOVERY_SCANNING';
      }

      return data.entry_monitor_state || 'DISCOVERY_SCANNING';
    } catch (error) {
      productionLogger.error('[LLM_GUARD] Failed to fetch session state', { sessionId, error });
      return 'DISCOVERY_SCANNING';
    }
  }

  private logActivity(sessionId: string, attemptedCall: string, state: string): void {
    // Log for analytics only - this is no longer a violation
    const activity: LLMGuardViolation = {
      sessionId,
      attemptedCall,
      state,
      timestamp: new Date(),
      stackTrace: new Error().stack
    };

    violations.push(activity);

    if (violations.length > MAX_VIOLATIONS_LOG) {
      violations.shift();
    }

    // Info level logging - Alpha is allowed to think at any time
    productionLogger.info('[LLM_GUARD] Alpha LLM call during monitoring state (allowed)', {
      sessionId,
      attemptedCall,
      state
    });
  }

  async assertLLMAllowed(sessionId: string, callDescription?: string): Promise<void> {
    // 🔥 CRITICAL: Never throw - Alpha must never be blocked
    // This method is kept for backward compatibility but does nothing
    const result = await this.checkLLMAllowed(sessionId, callDescription);

    // Always allowed - no need to check result
    return;
  }

  getViolations(): LLMGuardViolation[] {
    return [...violations];
  }

  getRecentViolations(count: number = 10): LLMGuardViolation[] {
    return violations.slice(-count);
  }

  clearViolations(): void {
    violations.length = 0;
  }

  invalidateCache(sessionId: string): void {
    this.sessionStateCache.delete(sessionId);
  }

  clearCache(): void {
    this.sessionStateCache.clear();
  }
}

export const llmCallGuard = new LLMCallGuard();

export async function withLLMGuard<T>(
  sessionId: string,
  callDescription: string,
  llmCall: () => Promise<T>
): Promise<T> {
  await llmCallGuard.assertLLMAllowed(sessionId, callDescription);
  return llmCall();
}

export function createGuardedLLMCall<T extends (...args: any[]) => Promise<any>>(
  sessionIdExtractor: (...args: Parameters<T>) => string | undefined,
  callDescription: string,
  originalFn: T
): T {
  return (async (...args: Parameters<T>) => {
    const sessionId = sessionIdExtractor(...args);

    if (sessionId) {
      await llmCallGuard.assertLLMAllowed(sessionId, callDescription);
    }

    return originalFn(...args);
  }) as T;
}
