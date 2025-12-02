/**
 * MetaAPI Account Manager
 *
 * Manages primary and fallback MetaAPI accounts with intelligent failover.
 *
 * Strategy:
 * - Try primary account first
 * - Fall back on auth errors (401/403), not found (404), or service errors (503/504)
 * - After 2 consecutive failures → switch to fallback
 * - Retry primary every 5 minutes to check if recovered
 * - Cache working account for performance
 */

interface AccountHealth {
  accountId: string;
  isPrimary: boolean;
  lastSuccess: number | null;
  lastFailure: number | null;
  lastErrorMessage: string | null;
  consecutiveFailures: number;
  totalRequests: number;
  successfulRequests: number;
}

interface AccountManagerState {
  primaryAccount: AccountHealth;
  fallbackAccount: AccountHealth;
  currentActive: 'primary' | 'fallback';
  lastSwitch: number | null;
  lastPrimaryRetry: number | null;
}

// In-memory state (shared across function invocations in same instance)
let state: AccountManagerState | null = null;

// Constants
const FAILURE_THRESHOLD = 2; // Switch to fallback after 2 consecutive failures
const PRIMARY_RETRY_INTERVAL = 5 * 60 * 1000; // 5 minutes
const CACHE_DURATION = 60 * 1000; // 1 minute

// Error codes that trigger fallback
const FALLBACK_ERROR_CODES = new Set([
  401, // Unauthorized
  403, // Forbidden
  404, // Not Found
  503, // Service Unavailable
  504  // Gateway Timeout
]);

/**
 * Initialize state with environment variables
 */
function initializeState(): AccountManagerState {
  const primaryId = process.env.METAAPI_ACCOUNT_ID || '';
  const fallbackId = process.env.METAAPI_ACCOUNT_ID_FALLBACK || '';

  if (!primaryId) {
    throw new Error('METAAPI_ACCOUNT_ID environment variable is required');
  }

  return {
    primaryAccount: {
      accountId: primaryId,
      isPrimary: true,
      lastSuccess: null,
      lastFailure: null,
      lastErrorMessage: null,
      consecutiveFailures: 0,
      totalRequests: 0,
      successfulRequests: 0
    },
    fallbackAccount: {
      accountId: fallbackId || primaryId, // Use primary as fallback if no fallback specified
      isPrimary: false,
      lastSuccess: null,
      lastFailure: null,
      lastErrorMessage: null,
      consecutiveFailures: 0,
      totalRequests: 0,
      successfulRequests: 0
    },
    currentActive: 'primary',
    lastSwitch: null,
    lastPrimaryRetry: null
  };
}

/**
 * Get current state (initialize if needed)
 */
function getState(): AccountManagerState {
  if (!state) {
    state = initializeState();
  }
  return state;
}

/**
 * Check if an error should trigger fallback
 */
function shouldFallbackOnError(error: any): boolean {
  // Check HTTP status code
  if (error.response && error.response.status) {
    return FALLBACK_ERROR_CODES.has(error.response.status);
  }

  // Check error code property
  if (error.code) {
    const code = parseInt(error.code);
    if (!isNaN(code)) {
      return FALLBACK_ERROR_CODES.has(code);
    }
  }

  // Check error message for status codes
  if (error.message) {
    for (const code of FALLBACK_ERROR_CODES) {
      if (error.message.includes(`${code}`)) {
        return true;
      }
    }
  }

  // Don't fallback on rate limits or network errors (should retry same account)
  return false;
}

/**
 * Check if it's time to retry primary account
 */
function shouldRetryPrimary(): boolean {
  const currentState = getState();

  // Already on primary
  if (currentState.currentActive === 'primary') {
    return false;
  }

  // Never retried before - wait for retry interval
  if (!currentState.lastPrimaryRetry) {
    const switchTime = currentState.lastSwitch || Date.now();
    return Date.now() - switchTime >= PRIMARY_RETRY_INTERVAL;
  }

  // Check if retry interval has passed
  return Date.now() - currentState.lastPrimaryRetry >= PRIMARY_RETRY_INTERVAL;
}

/**
 * Get the working MetaAPI account ID
 *
 * Returns the best account to use based on current health status
 */
export function getWorkingMetaApiAccount(): string {
  const currentState = getState();

  // Check if we should retry primary
  if (shouldRetryPrimary()) {
    console.log('[MetaAPI-AccountManager] Retry interval elapsed, testing primary account...');
    currentState.lastPrimaryRetry = Date.now();
    // Don't switch yet - just return primary to test it
    // If it works, markAccountSuccess will switch us back
    return currentState.primaryAccount.accountId;
  }

  // Return currently active account
  if (currentState.currentActive === 'primary') {
    return currentState.primaryAccount.accountId;
  } else {
    return currentState.fallbackAccount.accountId;
  }
}

/**
 * Mark an account as failed
 *
 * Records failure and switches to fallback if threshold exceeded
 */
export function markAccountFailed(accountId: string, error: any): void {
  const currentState = getState();
  const isPrimary = accountId === currentState.primaryAccount.accountId;
  const account = isPrimary ? currentState.primaryAccount : currentState.fallbackAccount;

  account.lastFailure = Date.now();
  account.consecutiveFailures++;
  account.totalRequests++;
  account.lastErrorMessage = error.message || String(error);

  const errorCode = error.response?.status || error.code || 'unknown';
  console.log(`[MetaAPI-AccountManager] Account failed: ${isPrimary ? 'PRIMARY' : 'FALLBACK'} (${accountId.slice(0, 8)}...) - Error: ${errorCode}`);

  // Check if we should fallback
  if (isPrimary &&
      currentState.currentActive === 'primary' &&
      account.consecutiveFailures >= FAILURE_THRESHOLD &&
      shouldFallbackOnError(error)) {

    // Switch to fallback
    currentState.currentActive = 'fallback';
    currentState.lastSwitch = Date.now();
    console.warn(`[MetaAPI-AccountManager] ⚠️ PRIMARY ACCOUNT FAILED ${FAILURE_THRESHOLD} times - SWITCHING TO FALLBACK`);
    console.warn(`[MetaAPI-AccountManager] Fallback Account: ${currentState.fallbackAccount.accountId.slice(0, 8)}...`);
  }

  // If fallback also fails, we're in trouble
  if (!isPrimary && currentState.currentActive === 'fallback' && account.consecutiveFailures >= FAILURE_THRESHOLD) {
    console.error('[MetaAPI-AccountManager] ❌ CRITICAL: Both primary and fallback accounts are failing!');
  }
}

/**
 * Mark an account as successful
 *
 * Records success and potentially switches back to primary
 */
export function markAccountSuccess(accountId: string): void {
  const currentState = getState();
  const isPrimary = accountId === currentState.primaryAccount.accountId;
  const account = isPrimary ? currentState.primaryAccount : currentState.fallbackAccount;

  account.lastSuccess = Date.now();
  account.consecutiveFailures = 0; // Reset failure count
  account.totalRequests++;
  account.successfulRequests++;
  account.lastErrorMessage = null;

  // If primary succeeded and we're on fallback, switch back to primary
  if (isPrimary && currentState.currentActive === 'fallback') {
    currentState.currentActive = 'primary';
    currentState.lastSwitch = Date.now();
    console.log('[MetaAPI-AccountManager] ✅ PRIMARY ACCOUNT RECOVERED - Switching back to primary');
  }
}

/**
 * Get health status of both accounts
 */
export function getAccountHealth(): {
  primary: AccountHealth;
  fallback: AccountHealth;
  currentActive: 'primary' | 'fallback';
  lastSwitch: number | null;
} {
  const currentState = getState();

  return {
    primary: { ...currentState.primaryAccount },
    fallback: { ...currentState.fallbackAccount },
    currentActive: currentState.currentActive,
    lastSwitch: currentState.lastSwitch
  };
}

/**
 * Manually reset to primary account
 *
 * Use this to force a switch back to primary (e.g., from admin UI)
 */
export function resetToPrimary(): void {
  const currentState = getState();

  if (currentState.currentActive !== 'primary') {
    currentState.currentActive = 'primary';
    currentState.lastSwitch = Date.now();
    currentState.primaryAccount.consecutiveFailures = 0;
    console.log('[MetaAPI-AccountManager] Manual reset to PRIMARY account');
  }
}

/**
 * Get currently active account info
 */
export function getCurrentAccount(): {
  accountId: string;
  isPrimary: boolean;
  health: AccountHealth;
} {
  const currentState = getState();
  const isPrimary = currentState.currentActive === 'primary';
  const account = isPrimary ? currentState.primaryAccount : currentState.fallbackAccount;

  return {
    accountId: account.accountId,
    isPrimary,
    health: { ...account }
  };
}

/**
 * Check if fallback is available
 */
export function hasFallback(): boolean {
  const currentState = getState();
  return currentState.primaryAccount.accountId !== currentState.fallbackAccount.accountId;
}
