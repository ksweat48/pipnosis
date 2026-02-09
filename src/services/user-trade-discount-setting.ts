import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

class UserTradeDiscountSettingService {
  private cache = new Map<string, { enabled: boolean; timestamp: number }>();
  private cacheTTL = 15000;

  async isEnabled(userId: string): Promise<boolean> {
    if (!userId) return false;

    const cached = this.cache.get(userId);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.enabled;
    }

    try {
      const { data, error } = await supabase.rpc('get_user_trade_discount_enabled', {
        p_user_id: userId,
      });

      if (error) {
        logger.error('[TradeDiscountSetting] RPC error:', error);
        return false;
      }

      const enabled = Boolean(data);
      this.cache.set(userId, { enabled, timestamp: Date.now() });
      return enabled;
    } catch (err) {
      logger.error('[TradeDiscountSetting] Exception:', err);
      return false;
    }
  }

  async setEnabled(userId: string, enabled: boolean): Promise<{ success: boolean; error?: string }> {
    if (!userId) return { success: false, error: 'Missing userId' };

    try {
      const { data, error } = await supabase.rpc('set_user_trade_discount_enabled', {
        p_user_id: userId,
        p_enabled: enabled,
      });

      if (error) {
        logger.error('[TradeDiscountSetting] Set RPC error:', error);
        return { success: false, error: error.message };
      }

      const result = data as Record<string, unknown>;
      this.cache.set(userId, { enabled, timestamp: Date.now() });

      logger.info(
        `[TradeDiscountSetting] User ${userId} toggled discounts: ${result.old_value} -> ${result.new_value}`
      );

      return { success: true };
    } catch (err) {
      logger.error('[TradeDiscountSetting] Set exception:', err);
      return { success: false, error: String(err) };
    }
  }

  invalidateCache(userId: string): void {
    this.cache.delete(userId);
  }
}

export const userTradeDiscountSettingService = new UserTradeDiscountSettingService();
