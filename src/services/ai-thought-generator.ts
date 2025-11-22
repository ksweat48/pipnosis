import { supabase } from '../lib/supabase';

/**
 * AI Thought Generator
 *
 * Generates natural language thoughts that show the AI's internal reasoning process.
 * Thoughts are casual, conversational, and show emotions (excitement, confusion, frustration).
 *
 * Think of this as the AI's internal monologue - what it's thinking as it learns to trade.
 */

type ThoughtCategory =
  | 'observation'
  | 'hypothesis'
  | 'experiment'
  | 'result'
  | 'conclusion'
  | 'goal_progress'
  | 'confusion'
  | 'breakthrough'
  | 'frustration'
  | 'excitement';

interface ThoughtContext {
  symbol?: string;
  timeframe?: string;
  metricAffected?: string;
  relatedTradeId?: string;
  relatedPatternId?: string;
  relatedSessionId?: string;
  confidence?: number;
}

class AIThoughtGenerator {
  /**
   * Log a thought to the database
   */
  async logThought(
    userId: string,
    category: ThoughtCategory,
    thoughtText: string,
    context: ThoughtContext = {}
  ): Promise<void> {
    try {
      const { error } = await supabase.from('ai_thought_stream').insert({
        user_id: userId,
        thought_category: category,
        thought_text: thoughtText,
        symbol: context.symbol,
        timeframe: context.timeframe,
        metric_affected: context.metricAffected,
        related_trade_id: context.relatedTradeId,
        related_pattern_id: context.relatedPatternId,
        related_session_id: context.relatedSessionId,
        confidence: context.confidence || 75
      });

      if (error) {
        console.error('[AI Thought Generator] Error logging thought:', error);
      }
    } catch (error) {
      console.error('[AI Thought Generator] Exception logging thought:', error);
    }
  }

  /**
   * Generate end-of-session reflection
   */
  async generateDailyReflection(
    userId: string,
    sessionId: string,
    sessionData: {
      sessionDate: Date;
      sessionNumber: number;
      winRate: number;
      profitFactor: number;
      tradesCount: number;
      bestPattern?: string;
      worstPattern?: string;
      discoveries: string[];
      challenges: string[];
      adjustments: string[];
      currentGoal?: string;
      goalProgress?: number;
    }
  ): Promise<void> {
    console.log('[AI Thought Generator] 📝 Generating daily reflection...');

    try {
      // Generate the main reflection text
      const reflectionText = this.createReflectionNarrative(sessionData);

      // Determine mood based on performance
      const mood = this.determineMood(sessionData.winRate, sessionData.goalProgress || 0);

      // Generate tomorrow's focus areas
      const tomorrowFocus = this.generateTomorrowFocus(sessionData);

      const { error } = await supabase.from('ai_daily_reflections').upsert({
        user_id: userId,
        session_date: sessionData.sessionDate.toISOString().split('T')[0],
        session_id: sessionId,
        session_number: sessionData.sessionNumber,
        reflection_text: reflectionText,
        current_goal: sessionData.currentGoal,
        goal_progress_percentage: sessionData.goalProgress,
        on_track: sessionData.winRate >= 50, // Simple heuristic
        key_discoveries: sessionData.discoveries,
        challenges_faced: sessionData.challenges,
        adjustments_made: sessionData.adjustments,
        session_win_rate: sessionData.winRate,
        session_profit_factor: sessionData.profitFactor,
        trades_count: sessionData.tradesCount,
        tomorrow_focus: tomorrowFocus,
        mood
      }, {
        onConflict: 'user_id,session_date'
      });

      if (error) {
        console.error('[AI Thought Generator] Error saving reflection:', error);
      } else {
        console.log('[AI Thought Generator] ✅ Daily reflection saved');
      }
    } catch (error) {
      console.error('[AI Thought Generator] Exception generating reflection:', error);
    }
  }

  /**
   * Create narrative reflection text
   */
  private createReflectionNarrative(data: any): string {
    const parts: string[] = [];

    // Opening
    if (data.sessionNumber <= 5) {
      parts.push(`Day ${data.sessionNumber} - Still pretty new to this.`);
    } else if (data.sessionNumber <= 20) {
      parts.push(`Day ${data.sessionNumber} - Getting the hang of things.`);
    } else if (data.sessionNumber <= 50) {
      parts.push(`Day ${data.sessionNumber} - Feeling more confident now.`);
    } else {
      parts.push(`Day ${data.sessionNumber} - Trading like a pro!`);
    }

    // Performance summary
    if (data.winRate >= 70) {
      parts.push(`Really crushing it today with ${data.winRate.toFixed(1)}% win rate! Took ${data.tradesCount} trades and won ${Math.round(data.tradesCount * data.winRate / 100)} of them.`);
    } else if (data.winRate >= 60) {
      parts.push(`Solid session with ${data.winRate.toFixed(1)}% win rate. Made ${data.tradesCount} trades - feeling good about my progress.`);
    } else if (data.winRate >= 50) {
      parts.push(`Okay day with ${data.winRate.toFixed(1)}% win rate on ${data.tradesCount} trades. Not amazing but not terrible either.`);
    } else if (data.winRate >= 40) {
      parts.push(`Rough day... ${data.winRate.toFixed(1)}% win rate on ${data.tradesCount} trades. Need to figure out what's going wrong.`);
    } else {
      parts.push(`Man, today was tough. Only ${data.winRate.toFixed(1)}% win rate. Something's off and I need to fix it.`);
    }

    // Best/worst patterns
    if (data.bestPattern) {
      parts.push(`My ${data.bestPattern} setup is working great - that's my bread and butter right now.`);
    }

    if (data.worstPattern) {
      parts.push(`Really struggling with ${data.worstPattern} though. Might need to stop trading that pattern for a while.`);
    }

    // Discoveries
    if (data.discoveries && data.discoveries.length > 0) {
      const discovery = data.discoveries[0];
      parts.push(`Big discovery: ${discovery} This could be a game changer!`);
    }

    // Challenges
    if (data.challenges && data.challenges.length > 0) {
      const challenge = data.challenges[0];
      parts.push(`Challenged by: ${challenge}`);
    }

    // Goal progress
    if (data.currentGoal && data.goalProgress !== undefined) {
      if (data.goalProgress >= 90) {
        parts.push(`Almost there! ${data.goalProgress.toFixed(0)}% of the way to my goal: ${data.currentGoal}`);
      } else if (data.goalProgress >= 75) {
        parts.push(`Making solid progress toward my goal: ${data.currentGoal}. At ${data.goalProgress.toFixed(0)}% now.`);
      } else if (data.goalProgress >= 50) {
        parts.push(`Working on: ${data.currentGoal}. Halfway there at ${data.goalProgress.toFixed(0)}%.`);
      } else {
        parts.push(`Goal: ${data.currentGoal}. Still early at ${data.goalProgress.toFixed(0)}% but I'll get there.`);
      }
    }

    // Adjustments
    if (data.adjustments && data.adjustments.length > 0) {
      parts.push(`I'm adjusting my approach: ${data.adjustments[0]}`);
    }

    return parts.join(' ');
  }

  /**
   * Determine AI's mood based on performance
   */
  private determineMood(winRate: number, goalProgress: number): string {
    if (winRate >= 70) return 'excited';
    if (winRate >= 60) return 'confident';
    if (winRate >= 50) return 'focused';
    if (winRate >= 40) return 'cautious';
    return 'frustrated';
  }

  /**
   * Generate tomorrow's focus areas
   */
  private generateTomorrowFocus(data: any): string[] {
    const focus: string[] = [];

    if (data.winRate < 55) {
      focus.push('Improve win rate by being more selective with entries');
    }

    if (data.profitFactor < 1.5) {
      focus.push('Focus on higher quality setups with better risk:reward');
    }

    if (data.bestPattern) {
      focus.push(`Trade more ${data.bestPattern} setups - they're working well`);
    }

    if (data.worstPattern) {
      focus.push(`Avoid ${data.worstPattern} or wait for better confirmation`);
    }

    if (focus.length === 0) {
      focus.push('Keep doing what is working - maintain current strategy');
    }

    return focus;
  }

  /**
   * Generate observation thoughts
   */
  async logObservation(
    userId: string,
    observation: string,
    context: ThoughtContext = {}
  ): Promise<void> {
    await this.logThought(userId, 'observation', observation, context);
  }

  /**
   * Generate hypothesis thoughts
   */
  async logHypothesis(
    userId: string,
    hypothesis: string,
    context: ThoughtContext = {}
  ): Promise<void> {
    await this.logThought(userId, 'hypothesis', hypothesis, context);
  }

  /**
   * Generate breakthrough thoughts
   */
  async logBreakthrough(
    userId: string,
    breakthrough: string,
    context: ThoughtContext = {}
  ): Promise<void> {
    await this.logThought(userId, 'breakthrough', breakthrough, context);
  }

  /**
   * Generate goal progress thoughts
   */
  async logGoalProgress(
    userId: string,
    goalUpdate: string,
    context: ThoughtContext = {}
  ): Promise<void> {
    await this.logThought(userId, 'goal_progress', goalUpdate, context);
  }

  /**
   * Get recent thoughts for display
   */
  async getRecentThoughts(
    userId: string,
    limit: number = 50
  ): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('ai_thought_stream')
        .select('*')
        .eq('user_id', userId)
        .order('thought_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('[AI Thought Generator] Error fetching thoughts:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[AI Thought Generator] Exception fetching thoughts:', error);
      return [];
    }
  }

  /**
   * Get daily reflections
   */
  async getDailyReflections(
    userId: string,
    limit: number = 30
  ): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('ai_daily_reflections')
        .select('*')
        .eq('user_id', userId)
        .order('session_date', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('[AI Thought Generator] Error fetching reflections:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[AI Thought Generator] Exception fetching reflections:', error);
      return [];
    }
  }

  /**
   * Get reflection for specific date
   */
  async getReflectionForDate(
    userId: string,
    date: Date
  ): Promise<any | null> {
    try {
      const dateStr = date.toISOString().split('T')[0];

      const { data, error } = await supabase
        .from('ai_daily_reflections')
        .select('*')
        .eq('user_id', userId)
        .eq('session_date', dateStr)
        .maybeSingle();

      if (error) {
        console.error('[AI Thought Generator] Error fetching reflection:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('[AI Thought Generator] Exception fetching reflection:', error);
      return null;
    }
  }
}

export const aiThoughtGenerator = new AIThoughtGenerator();
export type { ThoughtCategory, ThoughtContext };
