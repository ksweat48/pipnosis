/**
 * Balance Initialization Authority
 *
 * SSOT (Single Source of Truth) for all user token balance operations
 * CCIP Compliant: Governance-tracked, immutable audit trail
 *
 * Responsibilities:
 * - Retrieve existing user balance OR initialize with proper governance
 * - Prevent hardcoded defaults from overriding real account balance
 * - Track all balance decisions to audit trail
 * - Enforce that balance initialization is explicit, not implicit
 * - Flag suspicious initializations (e.g., hardcoded $50) for review
 *
 * This is the ONLY place where user_token_balance should be accessed
 * for retrieval/initialization. All other code must use this service.
 */

import { supabase } from '../lib/supabase';
import { logger, LogCategory } from '../lib/logger';

export interface BalanceInitializationResult {
  success: boolean;
  balance: number;
  isNew: boolean;
  reason: string;
  initializedWith: string;
  isDefaultFallback: boolean;
  governanceFlags?: {
    suspectedHardcodedDefault: boolean;
    requiresManualVerification: boolean;
    auditTrailCreated: boolean;
  };
  error?: string;
}

/**
 * SSOT: Get or initialize user balance
 *
 * This is the ONLY authorized path for retrieving/creating user_token_balance
 * Never hardcode balance values - always go through this function
 *
 * GOVERNANCE: If balance is hardcoded default (50), flags for review
 */
export async function getOrInitializeUserBalance(
  userId: string,
  initialBalance?: number,
  reason: string = 'unknown'
): Promise<BalanceInitializationResult> {
  try {
    logger.info(
      LogCategory.RISK_MANAGEMENT,
      '[BalanceInitializationAuthority] Retrieving or initializing balance',
      {
        userId,
        providedBalance: initialBalance,
        reason,
      }
    );

    // CCIP: Call the RPC which is the SSOT for balance operations
    const { data, error } = await supabase.rpc('initialize_or_get_user_balance', {
      p_user_id: userId,
      p_initial_balance: initialBalance || null,
      p_reason: reason,
    });

    if (error) {
      logger.error(
        LogCategory.RISK_MANAGEMENT,
        '[BalanceInitializationAuthority] RPC call failed',
        {
          userId,
          reason,
          error: error.message,
        }
      );

      return {
        success: false,
        balance: 0,
        isNew: false,
        reason: 'Failed to initialize balance',
        initializedWith: 'error',
        isDefaultFallback: false,
        error: error.message,
      };
    }

    if (!data) {
      logger.error(
        LogCategory.RISK_MANAGEMENT,
        '[BalanceInitializationAuthority] RPC returned no data',
        { userId, reason }
      );

      return {
        success: false,
        balance: 0,
        isNew: false,
        reason: 'No balance data returned',
        initializedWith: 'error',
        isDefaultFallback: false,
        error: 'RPC returned no data',
      };
    }

    const balance = parseFloat(data.balance);

    // GOVERNANCE: Check for suspicious hardcoded defaults
    const governanceFlags = {
      suspectedHardcodedDefault: data.is_default_fallback === true && balance === 50,
      requiresManualVerification: data.is_default_fallback === true,
      auditTrailCreated: data.is_new === true,
    };

    if (governanceFlags.suspectedHardcodedDefault) {
      logger.warn(
        LogCategory.RISK_MANAGEMENT,
        '[BalanceInitializationAuthority] GOVERNANCE: Hardcoded default $50 detected',
        {
          userId,
          balance,
          reason,
          message: 'This balance may be incorrect. Manual verification required.',
        }
      );
    }

    logger.info(
      LogCategory.RISK_MANAGEMENT,
      '[BalanceInitializationAuthority] Balance retrieved/initialized successfully',
      {
        userId,
        balance,
        isNew: data.is_new,
        initializedWith: data.initialized_with,
        isDefaultFallback: data.is_default_fallback,
        governanceFlags,
      }
    );

    return {
      success: true,
      balance,
      isNew: data.is_new,
      reason: data.reason,
      initializedWith: data.initialized_with,
      isDefaultFallback: data.is_default_fallback,
      governanceFlags,
    };
  } catch (error) {
    logger.error(
      LogCategory.RISK_MANAGEMENT,
      '[BalanceInitializationAuthority] Exception occurred',
      {
        userId,
        reason,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    );

    return {
      success: false,
      balance: 0,
      isNew: false,
      reason: 'Exception during balance initialization',
      initializedWith: 'error',
      isDefaultFallback: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * CCIP Governance: Verify balance is reasonable
 *
 * Prevents clearly incorrect balances from being used in calculations
 * Logs failures for audit trail
 */
export function validateBalanceIsReasonable(
  balance: number,
  userId: string
): { valid: boolean; reason?: string } {
  // Balance must be positive
  if (balance <= 0) {
    logger.warn(
      LogCategory.RISK_MANAGEMENT,
      '[BalanceInitializationAuthority] Balance validation failed: zero or negative',
      { userId, balance }
    );
    return {
      valid: false,
      reason: 'Balance must be positive',
    };
  }

  // Balance must be a number
  if (!isFinite(balance)) {
    logger.warn(
      LogCategory.RISK_MANAGEMENT,
      '[BalanceInitializationAuthority] Balance validation failed: not a valid number',
      { userId, balance }
    );
    return {
      valid: false,
      reason: 'Balance is not a valid number',
    };
  }

  // No upper limit check - users can have large accounts

  return {
    valid: true,
  };
}

/**
 * Get balance without initialization
 * Use when you only want to read, never create
 */
export async function getUserBalance(userId: string): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .from('user_token_balance')
      .select('balance')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      logger.error(
        LogCategory.RISK_MANAGEMENT,
        '[BalanceInitializationAuthority] Failed to fetch balance',
        { userId, error: error.message }
      );
      return null;
    }

    return data ? parseFloat(data.balance.toString()) : null;
  } catch (error) {
    logger.error(
      LogCategory.RISK_MANAGEMENT,
      '[BalanceInitializationAuthority] Exception in getUserBalance',
      { userId, error: error instanceof Error ? error.message : 'Unknown error' }
    );
    return null;
  }
}
