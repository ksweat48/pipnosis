import { clubMembershipService } from './club-membership-service';
import { TOKENOMICS } from '@/config/tokenomics-constants';
import { logger } from '@/lib/logger';

export interface DiscountResult {
  baseCost: number;
  discountCredits: number;
  finalCost: number;
  tierLevel: number;
  tierName: string;
}

class CreditDiscountEngine {
  async resolveTradeCredits(userId: string): Promise<DiscountResult> {
    const baseCost = TOKENOMICS.CREDITS.BASE_TRADE_COST;

    try {
      const discount = await clubMembershipService.getUserCreditDiscount(userId);

      if (!discount || discount.creditDiscount <= 0) {
        return {
          baseCost,
          discountCredits: 0,
          finalCost: baseCost,
          tierLevel: 0,
          tierName: 'None',
        };
      }

      const cappedDiscount = Math.min(
        discount.creditDiscount,
        TOKENOMICS.DISCOUNT.MAX_DISCOUNT_CREDITS
      );
      const finalCost = Math.max(baseCost - cappedDiscount, 1);

      logger.info(
        `[CreditDiscountEngine] User tier=${discount.tierName} discount=${cappedDiscount} finalCost=${finalCost}`
      );

      return {
        baseCost,
        discountCredits: cappedDiscount,
        finalCost,
        tierLevel: discount.tierLevel,
        tierName: discount.tierName,
      };
    } catch (error) {
      logger.error('[CreditDiscountEngine] Error resolving discount:', error);
      return {
        baseCost,
        discountCredits: 0,
        finalCost: baseCost,
        tierLevel: 0,
        tierName: 'None',
      };
    }
  }
}

export const creditDiscountEngine = new CreditDiscountEngine();
