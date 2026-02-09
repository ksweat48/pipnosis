import { supabase } from '@/lib/supabase';
import { TOKENOMICS, computeTradeCost } from '@/config/tokenomics-constants';
import { logger } from '@/lib/logger';
import { userTradeDiscountSettingService } from './user-trade-discount-setting';

export interface DiscountQuoteResult {
  quoteId: string;
  status: 'approved' | 'rejected' | 'executed' | 'expired';
  baseCost: number;
  discountPct: number;
  creditDiscountAmount: number;
  finalCreditCost: number;
  pipToBurn: number;
  tierLevel: number;
  tierName: string;
  degraded: boolean;
  rejectReason?: string;
  adminBypass?: boolean;
}

export interface DiscountExecutionResult {
  success: boolean;
  finalCreditCost: number;
  pipBurned: number;
  discountPct: number;
  tierName: string;
  newCreditBalance: number;
  degraded: boolean;
  error?: string;
  adminBypass?: boolean;
}

export interface DiscountResult {
  baseCost: number;
  discountCredits: number;
  finalCost: number;
  tierLevel: number;
  tierName: string;
}

class CreditDiscountEngine {
  async quoteTradeCredits(
    userId: string,
    tradeIntentId: string
  ): Promise<DiscountQuoteResult> {
    const base = TOKENOMICS.CREDITS.BASE_TRADE_COST;

    try {
      const { data, error } = await supabase.rpc('quote_trade_cost', {
        p_user_id: userId,
        p_trade_intent_id: tradeIntentId,
      });

      if (error) {
        logger.error('[CreditDiscountEngine] Quote RPC error:', error);
        return this.buildFallbackQuote(base);
      }

      const result = data as Record<string, unknown>;

      return {
        quoteId: result.quote_id as string,
        status: result.status as DiscountQuoteResult['status'],
        baseCost: Number(result.base_credit_cost ?? base),
        discountPct: Number(result.discount_pct ?? 0),
        creditDiscountAmount: Number(result.credit_discount_amount ?? 0),
        finalCreditCost: Number(result.final_credit_cost ?? base),
        pipToBurn: Number(result.pip_to_burn ?? 0),
        tierLevel: Number(result.membership_tier ?? 0),
        tierName: (result.tier_name as string) || 'None',
        degraded: Boolean(result.degraded),
        rejectReason: result.reason as string | undefined,
        adminBypass: Boolean(result.admin_bypass),
      };
    } catch (err) {
      logger.error('[CreditDiscountEngine] Quote exception:', err);
      return this.buildFallbackQuote(base);
    }
  }

  async executeQuote(
    quoteId: string,
    userId: string
  ): Promise<DiscountExecutionResult> {
    try {
      const { data, error } = await supabase.rpc('execute_trade_quote', {
        p_quote_id: quoteId,
        p_user_id: userId,
      });

      if (error) {
        logger.error('[CreditDiscountEngine] Execute RPC error:', error);
        return { success: false, finalCreditCost: 0, pipBurned: 0, discountPct: 0, tierName: 'None', newCreditBalance: 0, degraded: false, error: error.message };
      }

      const result = data as Record<string, unknown>;

      if (!(result.success as boolean)) {
        return {
          success: false,
          finalCreditCost: 0,
          pipBurned: 0,
          discountPct: 0,
          tierName: 'None',
          newCreditBalance: 0,
          degraded: false,
          error: (result.error as string) || 'Unknown execution error',
        };
      }

      return {
        success: true,
        finalCreditCost: Number(result.final_credit_cost ?? 0),
        pipBurned: Number(result.pip_burned ?? 0),
        discountPct: Number(result.discount_pct ?? 0),
        tierName: (result.tier_name as string) || 'None',
        newCreditBalance: Number(result.new_credit_balance ?? 0),
        degraded: Boolean(result.degraded),
        adminBypass: Boolean(result.admin_bypass),
      };
    } catch (err) {
      logger.error('[CreditDiscountEngine] Execute exception:', err);
      return { success: false, finalCreditCost: 0, pipBurned: 0, discountPct: 0, tierName: 'None', newCreditBalance: 0, degraded: false, error: String(err) };
    }
  }

  async resolveTradeCredits(userId: string): Promise<DiscountResult> {
    const baseCost = TOKENOMICS.CREDITS.BASE_TRADE_COST;

    try {
      const toggleEnabled = await userTradeDiscountSettingService.isEnabled(userId);

      const { data, error } = await supabase.rpc('get_user_credit_discount', {
        p_user_id: userId,
      });

      if (error || !data || data.length === 0) {
        return { baseCost, discountCredits: 0, finalCost: baseCost, tierLevel: 0, tierName: 'None' };
      }

      const row = data[0];
      const rawPct = Math.min(Number(row.discount_pct ?? 0), TOKENOMICS.DISCOUNT.MAX_DISCOUNT_PCT);
      const discountPct = toggleEnabled ? rawPct : 0;
      const finalCost = computeTradeCost(discountPct);
      const discountCredits = baseCost - finalCost;

      logger.info(
        `[CreditDiscountEngine] User tier=${row.tier_name} toggleEnabled=${toggleEnabled} discountPct=${discountPct} finalCost=${finalCost}`
      );

      return {
        baseCost,
        discountCredits,
        finalCost,
        tierLevel: row.tier_level || 0,
        tierName: row.tier_name || 'None',
      };
    } catch (err) {
      logger.error('[CreditDiscountEngine] Error resolving discount:', err);
      return { baseCost, discountCredits: 0, finalCost: baseCost, tierLevel: 0, tierName: 'None' };
    }
  }

  private buildFallbackQuote(baseCost: number): DiscountQuoteResult {
    return {
      quoteId: '',
      status: 'rejected',
      baseCost,
      discountPct: 0,
      creditDiscountAmount: 0,
      finalCreditCost: baseCost,
      pipToBurn: 0,
      tierLevel: 0,
      tierName: 'None',
      degraded: false,
      rejectReason: 'SYSTEM_ERROR',
    };
  }
}

export const creditDiscountEngine = new CreditDiscountEngine();
