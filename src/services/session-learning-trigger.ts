import { supabase } from '@/lib/supabase';
import { sessionLearningGenerator } from './session-learning-generator';

/**
 * Session Learning Trigger
 *
 * Automatically generates daily learning summaries when:
 * - A trade closes for the day
 * - A backtest completes
 * - User manually requests it
 */

class SessionLearningTrigger {
  private userId: string | null = null;
  private lastGenerationDate: string | null = null;
  private isGenerating: boolean = false;

  /**
   * Initialize the trigger for a user
   */
  initialize(userId: string) {
    this.userId = userId;
    console.log('[Session Learning Trigger] Initialized for user:', userId);
  }

  /**
   * Check if we should generate learning for today
   */
  private shouldGenerateLearning(): boolean {
    const today = new Date().toISOString().split('T')[0];

    if (this.isGenerating) {
      console.log('[Session Learning Trigger] Generation already in progress');
      return false;
    }

    if (this.lastGenerationDate === today) {
      console.log('[Session Learning Trigger] Already generated for today');
      return false;
    }

    return true;
  }

  /**
   * Trigger learning generation after a trade closes
   */
  async onTradeClose(userId: string, tradeId: string): Promise<void> {
    if (!this.shouldGenerateLearning()) return;

    console.log(`[Session Learning Trigger] Trade ${tradeId} closed, checking if we should generate learning...`);

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Check how many trades closed today
      const { data: todayTrades, error } = await supabase
        .from('trade_history')
        .select('id')
        .eq('user_id', userId)
        .gte('closed_at', today.toISOString())
        .lte('closed_at', new Date().toISOString());

      if (error) {
        console.error('[Session Learning Trigger] Error checking trades:', error);
        return;
      }

      const tradeCount = todayTrades?.length || 0;

      // Generate learning after every 3rd trade or at end of day
      if (tradeCount >= 3 && tradeCount % 3 === 0) {
        console.log(`[Session Learning Trigger] ${tradeCount} trades today, generating learning...`);
        await this.generateLearning(userId);
      }
    } catch (error) {
      console.error('[Session Learning Trigger] Error in onTradeClose:', error);
    }
  }

  /**
   * Trigger learning generation after backtest completes
   */
  async onBacktestComplete(userId: string, backtestType: 'synthetic' | 'historical'): Promise<void> {
    console.log(`[Session Learning Trigger] ${backtestType} backtest completed, generating learning...`);

    try {
      await this.generateLearning(userId, backtestType === 'synthetic' ? 'synthetic' : 'backtest');
    } catch (error) {
      console.error('[Session Learning Trigger] Error in onBacktestComplete:', error);
    }
  }

  /**
   * Generate learning summary for today
   */
  private async generateLearning(
    userId: string,
    sessionType: 'live_trading' | 'backtest' | 'synthetic' = 'live_trading'
  ): Promise<void> {
    if (this.isGenerating) {
      console.log('[Session Learning Trigger] Generation already in progress, skipping...');
      return;
    }

    this.isGenerating = true;

    try {
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];

      // Check if learning already exists for today
      const { data: existing } = await supabase
        .from('ai_session_learnings')
        .select('id')
        .eq('user_id', userId)
        .eq('session_date', todayStr)
        .eq('session_type', sessionType)
        .maybeSingle();

      if (existing) {
        console.log('[Session Learning Trigger] Learning already exists for today');
        this.lastGenerationDate = todayStr;
        return;
      }

      console.log('[Session Learning Trigger] 🧠 Generating learning summary...');
      const learning = await sessionLearningGenerator.generateDailyLearning(userId, today);

      if (learning) {
        console.log('[Session Learning Trigger] ✅ Learning summary generated successfully');
        this.lastGenerationDate = todayStr;

        // Log key insights
        if (learning.keyLearnings && learning.keyLearnings.length > 0) {
          console.log('[Session Learning Trigger] 💡 Key Learnings:');
          learning.keyLearnings.forEach((l: string) => console.log(`  - ${l}`));
        }

        if (learning.recommendations && learning.recommendations.length > 0) {
          console.log('[Session Learning Trigger] 📋 Recommendations:');
          learning.recommendations.forEach((r: string) => console.log(`  - ${r}`));
        }
      } else {
        console.log('[Session Learning Trigger] No trades to generate learning from');
      }
    } catch (error) {
      console.error('[Session Learning Trigger] Error generating learning:', error);
    } finally {
      this.isGenerating = false;
    }
  }

  /**
   * Manually trigger learning generation
   */
  async manualGenerate(userId: string): Promise<boolean> {
    console.log('[Session Learning Trigger] Manual generation requested');

    try {
      await this.generateLearning(userId);
      return true;
    } catch (error) {
      console.error('[Session Learning Trigger] Manual generation failed:', error);
      return false;
    }
  }

  /**
   * Generate learning for end of day (can be called by a scheduled job)
   */
  async endOfDayGeneration(userId: string): Promise<void> {
    console.log('[Session Learning Trigger] End of day learning generation');

    try {
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];

      // Check if already generated
      const { data: existing } = await supabase
        .from('ai_session_learnings')
        .select('id')
        .eq('user_id', userId)
        .eq('session_date', todayStr)
        .eq('session_type', 'live_trading')
        .maybeSingle();

      if (existing) {
        console.log('[Session Learning Trigger] End of day learning already exists');
        return;
      }

      await this.generateLearning(userId);
    } catch (error) {
      console.error('[Session Learning Trigger] End of day generation failed:', error);
    }
  }

  /**
   * Reset trigger state (useful for testing)
   */
  reset() {
    this.lastGenerationDate = null;
    this.isGenerating = false;
    console.log('[Session Learning Trigger] Reset');
  }
}

export const sessionLearningTrigger = new SessionLearningTrigger();
