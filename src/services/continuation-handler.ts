/**
 * Continuation Handler
 * Manages single-trade mode pausing and user decision handling
 */

import { supabase } from '../lib/supabase';
import { openaiProxyClient } from './openai-proxy-client';
import { alphaExecutionPlanner } from './alpha-execution-planner';
import { logger, LogCategory } from '../lib/logger';

interface ContinuationContext {
  goalSessionId: string;
  userId: string;
  tradeResult: {
    symbol: string;
    direction: 'buy' | 'sell';
    entryPrice: number;
    exitPrice: number;
    profitLoss: number;
    outcome: 'win' | 'loss' | 'breakeven';
  };
  sessionProgress: {
    targetAmount: number;
    currentProgress: number;
    tradesCompleted: number;
  };
}

class ContinuationHandler {
  /**
   * Handle trade closure in single-trade mode
   */
  async handleTradeClose(context: ContinuationContext): Promise<void> {
    try {
      logger.info(LogCategory.AI_TRADING, `[Continuation] Handling trade close for session ${context.goalSessionId}`);

      // Generate continuation prompt
      const prompt = await this.generateContinuationPrompt(context);

      // Pause the session
      await supabase
        .from('goal_sessions')
        .update({
          awaiting_user_continuation: true,
          continuation_prompt: prompt,
          status: 'awaiting_continuation',
          trades_completed: context.sessionProgress.tradesCompleted,
          updated_at: new Date().toISOString()
        })
        .eq('id', context.goalSessionId);

      logger.info(LogCategory.AI_TRADING, '[Continuation] Session paused, awaiting user decision');
    } catch (error) {
      logger.error(LogCategory.AI_TRADING, '[Continuation] Error handling trade close:', error);
    }
  }

  /**
   * Generate AI continuation prompt
   */
  private async generateContinuationPrompt(
    context: ContinuationContext
  ): Promise<string> {
    try {
      const { tradeResult, sessionProgress } = context;
      const remaining = sessionProgress.targetAmount - sessionProgress.currentProgress;
      const progressPct = (sessionProgress.currentProgress / sessionProgress.targetAmount) * 100;

      // Use AI to generate a personalized, encouraging message
      const response = await openaiProxyClient.chat({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are Pipnosis Alpha. Generate a brief, encouraging continuation prompt for the user. Keep it 2-3 sentences, friendly and motivating.'
          },
          {
            role: 'user',
            content: `
Trade ${sessionProgress.tradesCompleted} just closed:
- Symbol: ${tradeResult.symbol}
- Direction: ${tradeResult.direction}
- Entry: ${tradeResult.entryPrice}
- Exit: ${tradeResult.exitPrice}
- Result: ${tradeResult.outcome.toUpperCase()} (${tradeResult.profitLoss >= 0 ? '+' : ''}$${tradeResult.profitLoss.toFixed(2)})

Session Progress:
- Goal: $${sessionProgress.targetAmount}
- Achieved: $${sessionProgress.currentProgress.toFixed(2)} (${progressPct.toFixed(1)}%)
- Remaining: $${remaining.toFixed(2)}

Generate a 2-3 sentence prompt asking if they want to continue.
Be encouraging if the trade won, supportive if it lost.
Mention the remaining amount and that you'll find the next opportunity.
Keep it brief and motivating.
`
          }
        ],
        max_tokens: 150,
        temperature: 0.8,
        requestType: 'continuation-prompt'
      });

      return response.choices[0].message.content || this.getDefaultPrompt(context);
    } catch (error) {
      logger.error(LogCategory.AI_TRADING, '[Continuation] Error generating prompt:', error);
      return this.getDefaultPrompt(context);
    }
  }

  /**
   * Get default prompt if AI fails
   */
  private getDefaultPrompt(context: ContinuationContext): string {
    const { tradeResult, sessionProgress } = context;
    const remaining = sessionProgress.targetAmount - sessionProgress.currentProgress;

    if (tradeResult.outcome === 'win') {
      return `Great trade! We made $${tradeResult.profitLoss.toFixed(2)} on ${tradeResult.symbol}.\n\nYou're ${sessionProgress.currentProgress.toFixed(2)} / $${sessionProgress.targetAmount} towards your goal ($${remaining.toFixed(2)} to go).\n\nReady to continue? I'll scan the markets for the next high-quality setup.`;
    } else if (tradeResult.outcome === 'loss') {
      return `Trade on ${tradeResult.symbol} closed at ${tradeResult.profitLoss.toFixed(2)}.\n\nCurrent progress: $${sessionProgress.currentProgress.toFixed(2)} / $${sessionProgress.targetAmount} ($${remaining.toFixed(2)} remaining).\n\nWant to continue? I'll find a strong opportunity to get back on track.`;
    } else {
      return `Trade on ${tradeResult.symbol} broke even.\n\nCurrent progress: $${sessionProgress.currentProgress.toFixed(2)} / $${sessionProgress.targetAmount} ($${remaining.toFixed(2)} remaining).\n\nReady to continue? I'll look for the next opportunity.`;
    }
  }

  /**
   * Handle user's decision to continue
   */
  async handleContinue(goalSessionId: string): Promise<void> {
    try {
      logger.info(LogCategory.AI_TRADING, `[Continuation] User chose to continue session ${goalSessionId}`);

      // Get session data
      const { data: session } = await supabase
        .from('goal_sessions')
        .select('*')
        .eq('id', goalSessionId)
        .single();

      if (!session) {
        logger.error(LogCategory.AI_TRADING, '[Continuation] Session not found');
        return;
      }

      // Resume the session
      await supabase
        .from('goal_sessions')
        .update({
          awaiting_user_continuation: false,
          continuation_prompt: null,
          status: 'scanning',
          updated_at: new Date().toISOString()
        })
        .eq('id', goalSessionId);

      // Reassess the plan with current market conditions
      try {
        await alphaExecutionPlanner.reassessPlan(
          goalSessionId,
          { profit_loss: session.current_progress || 0 },
          session.user_id
        );

        logger.info(LogCategory.AI_TRADING, '[Continuation] Plan reassessed, session resumed');
      } catch (error) {
        logger.warn(LogCategory.AI_TRADING, '[Continuation] Could not reassess plan, continuing anyway:', error);
      }

      // Log continuation to conversations
      await supabase.from('goal_ai_conversations').insert({
        goal_session_id: goalSessionId,
        user_id: session.user_id,
        role: 'ai',
        message: `Resuming session! Scanning markets for your next trade opportunity...`,
        context: { action: 'continue', trades_completed: session.trades_completed },
        sentiment: 'encouraging'
      });

      logger.info(LogCategory.AI_TRADING, '[Continuation] Session resumed successfully');
    } catch (error) {
      logger.error(LogCategory.AI_TRADING, '[Continuation] Error handling continue:', error);
    }
  }

  /**
   * Handle user's decision to stop
   */
  async handleStop(goalSessionId: string, userId: string): Promise<void> {
    try {
      logger.info(LogCategory.AI_TRADING, `[Continuation] User chose to stop session ${goalSessionId}`);

      // Get final stats
      const { data: session } = await supabase
        .from('goal_sessions')
        .select('*')
        .eq('id', goalSessionId)
        .single();

      await supabase
        .from('goal_sessions')
        .update({
          status: 'user_stopped',
          end_time: new Date().toISOString(),
          awaiting_user_continuation: false,
          continuation_prompt: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', goalSessionId);

      // Log session end to conversations
      if (session) {
        const finalMessage = session.current_progress >= session.target_value
          ? `Goal achieved! Congratulations on reaching $${session.target_value}! 🎯`
          : `Session ended. You achieved $${session.current_progress || 0} out of $${session.target_value} goal. Great effort! 💪`;

        await supabase.from('goal_ai_conversations').insert({
          goal_session_id: goalSessionId,
          user_id: userId,
          role: 'ai',
          message: finalMessage,
          context: {
            action: 'stop',
            final_progress: session.current_progress,
            goal: session.target_value,
            trades_completed: session.trades_completed
          },
          sentiment: session.current_progress >= session.target_value ? 'celebratory' : 'neutral'
        });
      }

      logger.info(LogCategory.AI_TRADING, '[Continuation] Session stopped successfully');
    } catch (error) {
      logger.error(LogCategory.AI_TRADING, '[Continuation] Error handling stop:', error);
    }
  }
}

export const continuationHandler = new ContinuationHandler();
