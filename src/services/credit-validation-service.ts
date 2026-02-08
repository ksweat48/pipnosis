import { supabase } from '../lib/supabase';
import { creditMeterService } from './credit-meter-service';
import { creditDiscountEngine } from './credit-discount-engine';
import { logger } from '../lib/logger';
import { TRADING_CONSTANTS } from '../config/trading-constants';

export interface CreditValidationResult {
  valid: boolean;
  reason?: string;
  balance?: number;
}

export interface CreditDeductionResult {
  success: boolean;
  newBalance?: number;
  error?: string;
}

class CreditValidationService {
  private readonly SIGNAL_COST = 10;
  private readonly MIN_BALANCE_FOR_SESSION = 10;

  async validatePreSession(userId: string): Promise<CreditValidationResult> {
    try {
      logger.info(`[Credit Validation] Pre-session check for user ${userId}`);

      // CRITICAL: Check if credits are enabled platform-wide
      const creditsEnabled = await this.isCreditsEnabled();
      if (!creditsEnabled) {
        logger.info('[Credit Validation] Credits disabled platform-wide - validation bypassed');
        return { valid: true, balance: 999999 };
      }

      const balance = await creditMeterService.getBalance(userId);

      if (!balance) {
        logger.error('[Credit Validation] Failed to fetch user balance');
        return {
          valid: false,
          reason: 'Unable to verify credit balance. Please try again.'
        };
      }

      if (balance.isAdmin) {
        logger.info('[Credit Validation] Admin user - unlimited credits');
        return { valid: true, balance: balance.balance };
      }

      if (balance.balance < this.MIN_BALANCE_FOR_SESSION) {
        logger.warn(`[Credit Validation] Insufficient balance: ${balance.balance} credits`);
        return {
          valid: false,
          reason: `Insufficient credits. You need at least ${this.MIN_BALANCE_FOR_SESSION} credits to start a session. Current balance: ${balance.balance} credits.`,
          balance: balance.balance
        };
      }

      const testResult = await this.testCreditSystem(userId);
      if (!testResult.success) {
        logger.error('[Credit Validation] Credit system test failed');
        return {
          valid: false,
          reason: 'Credit system is currently unavailable. Please try again in a moment.'
        };
      }

      logger.info(`[Credit Validation] ✅ Pre-session validation passed. Balance: ${balance.balance} credits`);
      return { valid: true, balance: balance.balance };
    } catch (error) {
      logger.error('[Credit Validation] Error during pre-session validation:', error);
      return {
        valid: false,
        reason: 'Unable to validate credits. Please try again.'
      };
    }
  }

  async deductSignalCredits(
    userId: string,
    sessionId: string,
    signalMetadata: {
      symbol: string;
      intentId: string;
      intentType: string;
      confidence: number;
    }
  ): Promise<CreditDeductionResult> {
    try {
      const creditsEnabled = await this.isCreditsEnabled();
      if (!creditsEnabled) {
        logger.info('[Credit Deduction] Credits disabled platform-wide - deduction bypassed');
        return { success: true, newBalance: 999999 };
      }

      const balance = await creditMeterService.getBalance(userId);
      if (balance?.isAdmin) {
        logger.info('[Credit Deduction] Admin user - no deduction needed');
        return { success: true, newBalance: balance.balance };
      }

      const discount = await creditDiscountEngine.resolveTradeCredits(userId);
      const effectiveCost = discount.finalCost;

      logger.info(`[Credit Deduction] Deducting ${effectiveCost} credits (base=${discount.baseCost} discount=${discount.discountCredits}) for signal ${signalMetadata.intentId}`);

      if (!balance || balance.balance < effectiveCost) {
        logger.error(`[Credit Deduction] Insufficient balance: ${balance?.balance || 0} credits, need ${effectiveCost}`);

        await this.blockSessionForCredits(sessionId, signalMetadata.intentId);

        return {
          success: false,
          error: `Insufficient credits. Need ${effectiveCost} credits, have ${balance?.balance || 0}.`,
          newBalance: balance?.balance
        };
      }

      const deductSuccess = await creditMeterService.deductCredits(
        userId,
        effectiveCost,
        'signal_detected',
        {
          session_id: sessionId,
          intent_id: signalMetadata.intentId,
          symbol: signalMetadata.symbol,
          intent_type: signalMetadata.intentType,
          confidence: signalMetadata.confidence,
          discount_applied: discount.discountCredits,
          tier_name: discount.tierName,
          base_cost: discount.baseCost,
          final_cost: effectiveCost,
          timestamp: new Date().toISOString()
        }
      );

      if (!deductSuccess) {
        logger.error('[Credit Deduction] Deduction failed - blocking session');

        await this.blockSessionForCredits(sessionId, signalMetadata.intentId);

        return {
          success: false,
          error: 'Credit deduction failed. Session is now blocked until credits are resolved.'
        };
      }

      const newBalance = await creditMeterService.getBalance(userId);
      logger.info(`[Credit Deduction] Successfully deducted ${effectiveCost} credits. New balance: ${newBalance?.balance || 0}`);

      await this.recordSuccessfulDeduction(userId, sessionId, signalMetadata.intentId, effectiveCost);

      return {
        success: true,
        newBalance: newBalance?.balance
      };
    } catch (error) {
      logger.error('[Credit Deduction] Unexpected error during deduction:', error);

      await this.blockSessionForCredits(sessionId, signalMetadata.intentId);

      return {
        success: false,
        error: 'Unexpected error during credit deduction. Session blocked.'
      };
    }
  }

  async isSessionCreditBlocked(sessionId: string): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from('goal_sessions')
        .select('credit_blocked, pending_credit_intent_id')
        .eq('id', sessionId)
        .maybeSingle();

      if (error || !data) {
        logger.error('[Credit Validation] Error checking credit block status:', error);
        return false;
      }

      return data.credit_blocked === true;
    } catch (error) {
      logger.error('[Credit Validation] Error checking credit block:', error);
      return false;
    }
  }

  async retryPendingDeduction(
    userId: string,
    sessionId: string
  ): Promise<CreditDeductionResult> {
    try {
      const { data, error } = await supabase
        .from('goal_sessions')
        .select('pending_credit_intent_id, pending_credit_metadata')
        .eq('id', sessionId)
        .eq('credit_blocked', true)
        .maybeSingle();

      if (error || !data || !data.pending_credit_intent_id) {
        return {
          success: false,
          error: 'No pending credit deduction found for this session.'
        };
      }

      const metadata = data.pending_credit_metadata as any;

      const result = await this.deductSignalCredits(userId, sessionId, {
        symbol: metadata?.symbol || 'UNKNOWN',
        intentId: data.pending_credit_intent_id,
        intentType: metadata?.intent_type || 'unknown',
        confidence: metadata?.confidence || 0
      });

      if (result.success) {
        await this.unblockSession(sessionId);
        logger.info(`[Credit Validation] ✅ Pending deduction resolved. Session ${sessionId} unblocked.`);
      }

      return result;
    } catch (error) {
      logger.error('[Credit Validation] Error retrying pending deduction:', error);
      return {
        success: false,
        error: 'Failed to retry credit deduction.'
      };
    }
  }

  private async testCreditSystem(userId: string): Promise<{ success: boolean }> {
    try {
      const balance1 = await creditMeterService.getBalance(userId);
      if (!balance1) return { success: false };

      const testAmount = TRADING_CONSTANTS.CREDIT_SYSTEM.TEST_DEDUCTION_AMOUNT;
      const deducted = await creditMeterService.deductCredits(
        userId,
        testAmount,
        'system_test',
        { test: true, timestamp: new Date().toISOString() }
      );

      if (!deducted) return { success: false };

      const added = await creditMeterService.addCredits(
        userId,
        testAmount,
        'system_test_refund',
        { test: true, timestamp: new Date().toISOString() }
      );

      if (!added) return { success: false };

      const balance2 = await creditMeterService.getBalance(userId);
      if (!balance2) return { success: false };

      const balanceTolerance = TRADING_CONSTANTS.CREDIT_SYSTEM.BALANCE_TOLERANCE;
      const balanceDiff = Math.abs(balance1.balance - balance2.balance);
      if (balanceDiff > balanceTolerance) {
        logger.error(`[Credit Validation] Test failed - balance mismatch: ${balanceDiff}`);
        return { success: false };
      }

      return { success: true };
    } catch (error) {
      logger.error('[Credit Validation] Test error:', error);
      return { success: false };
    }
  }

  private async blockSessionForCredits(sessionId: string, intentId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('goal_sessions')
        .update({
          credit_blocked: true,
          pending_credit_intent_id: intentId,
          pending_credit_metadata: {
            blocked_at: new Date().toISOString(),
            reason: 'Credit deduction failed'
          },
          updated_at: new Date().toISOString()
        })
        .eq('id', sessionId);

      if (error) {
        logger.error('[Credit Validation] Failed to block session:', error);
      } else {
        logger.warn(`[Credit Validation] 🔒 Session ${sessionId} blocked due to credit deduction failure`);
      }
    } catch (error) {
      logger.error('[Credit Validation] Error blocking session:', error);
    }
  }

  private async unblockSession(sessionId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('goal_sessions')
        .update({
          credit_blocked: false,
          pending_credit_intent_id: null,
          pending_credit_metadata: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', sessionId);

      if (error) {
        logger.error('[Credit Validation] Failed to unblock session:', error);
      } else {
        logger.info(`[Credit Validation] 🔓 Session ${sessionId} unblocked`);
      }
    } catch (error) {
      logger.error('[Credit Validation] Error unblocking session:', error);
    }
  }

  private async recordSuccessfulDeduction(
    userId: string,
    sessionId: string,
    intentId: string,
    amount: number
  ): Promise<void> {
    try {
      await supabase
        .from('credit_deduction_history')
        .insert({
          user_id: userId,      // SSOT FIX: Required by schema and RLS policy
          session_id: sessionId,
          intent_id: intentId,
          amount,
          status: 'success',
          timestamp: new Date().toISOString()
        });
    } catch (error) {
      logger.error('[Credit Validation] Failed to record deduction:', error);
    }
  }

  getSignalCost(): number {
    return this.SIGNAL_COST;
  }

  getMinBalanceForSession(): number {
    return this.MIN_BALANCE_FOR_SESSION;
  }

  private async isCreditsEnabled(): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc('is_credits_enabled');

      if (error) {
        logger.error('[Credit Validation] Error checking if credits enabled:', error);
        return true;
      }

      return data === true;
    } catch (error) {
      logger.error('[Credit Validation] Error in isCreditsEnabled:', error);
      return true;
    }
  }
}

export const creditValidationService = new CreditValidationService();
