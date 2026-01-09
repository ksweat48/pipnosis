/**
 * LLM Call Guard
 *
 * Enforces ZERO LLM calls during ENTRY_MONITOR mode.
 *
 * This guard MUST be checked before ANY OpenAI API call.
 * If the session is in ENTRY_MONITOR mode, LLM calls are blocked.
 *
 * The guard:
 * 1. Checks current entry_monitor_state for the session
 * 2. Returns blocked=true if state is ENTRY_MONITOR_ACTIVE or EXECUTE_PENDING
 * 3. Logs violation attempts for debugging
 * 4. Provides clear error messages
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

const BLOCKED_STATES = [
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

    const isBlocked = BLOCKED_STATES.includes(state);

    if (isBlocked) {
      this.logViolation(sessionId, callDescription || 'unknown', state);

      return {
        allowed: false,
        reason: `LLM calls blocked in ${state} mode. Entry monitoring uses deterministic scoring only.`,
        state,
        violationLogged: true
      };
    }

    return {
      allowed: true,
      reason: 'LLM calls permitted in DISCOVERY_SCANNING mode',
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

  private logViolation(sessionId: string, attemptedCall: string, state: string): void {
    const violation: LLMGuardViolation = {
      sessionId,
      attemptedCall,
      state,
      timestamp: new Date(),
      stackTrace: new Error().stack
    };

    violations.push(violation);

    if (violations.length > MAX_VIOLATIONS_LOG) {
      violations.shift();
    }

    productionLogger.warn('[LLM_GUARD] VIOLATION: LLM call attempted during ENTRY_MONITOR', {
      sessionId,
      attemptedCall,
      state
    });

    console.warn(
      '%c[LLM_GUARD] VIOLATION: LLM call attempted during ENTRY_MONITOR mode!',
      'color: #ff0000; font-weight: bold; font-size: 14px',
      { sessionId, attemptedCall, state }
    );
  }

  async assertLLMAllowed(sessionId: string, callDescription?: string): Promise<void> {
    const result = await this.checkLLMAllowed(sessionId, callDescription);

    if (!result.allowed) {
      throw new Error(`LLM_GUARD_BLOCK: ${result.reason}`);
    }
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
