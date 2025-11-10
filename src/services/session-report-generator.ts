import { supabase } from '@/lib/supabase';
import { spcCalculator } from './spc-calculator';
import { threadPostingService } from './thread-posting-service';

/**
 * Session Report Generator
 *
 * Generates formatted session reports for Pipnosis Thread with:
 * - Session metrics summary
 * - SPC calculation breakdown
 * - Progress bar visualization
 * - Comeback trade highlights
 * - Key learnings and recommendations
 */

interface SessionReport {
  id: string;
  sessionId: string;
  reportTitle: string;
  reportContent: string;
  progressBarData: ProgressBarSegment[];
  spcBreakdown: SPCBreakdown;
  comebackHighlights: string[];
  keyLearnings: string[];
  recommendations: string[];
  cumulativeSPCBefore: number;
  cumulativeSPCAfter: number;
  progressChange: number;
  currentTier: string;
  progressToNextTierPercent: number;
}

interface ProgressBarSegment {
  type: 'positive' | 'negative' | 'comeback' | 'flat';
  value: number;
  label: string;
  color: string;
}

interface SPCBreakdown {
  wins: number;
  losses: number;
  profitFactor: number;
  profitWeight: number;
  baseSPC: number;
  comebackBonus: number;
  totalSPC: number;
  tier: string;
  grade: string;
}

class SessionReportGenerator {
  /**
   * Generate complete session report
   */
  async generateSessionReport(
    userId: string,
    sessionId: string
  ): Promise<{ success: boolean; report?: SessionReport; error?: string }> {
    try {
      console.log(`\n[Session Report] 📊 Generating report for session ${sessionId}`);

      // Get session data
      const { data: session, error: sessionError } = await supabase
        .from('trading_sessions')
        .select('*')
        .eq('id', sessionId)
        .eq('user_id', userId)
        .single();

      if (sessionError || !session) {
        return { success: false, error: 'Session not found' };
      }

      // Get session trades with comeback info
      const { data: trades } = await supabase
        .from('session_trades')
        .select('*')
        .eq('session_id', sessionId)
        .order('trade_number', { ascending: true });

      // Get cumulative SPC before and after
      const cumulativeSPCBefore = await this.getCumulativeSPCBefore(userId, session.session_start);
      const cumulativeSPCAfter = cumulativeSPCBefore + parseFloat(session.session_spc);

      // Get progress to next tier
      const progress = await spcCalculator.getSPCProgress(userId);

      // Build SPC breakdown
      const spcBreakdown: SPCBreakdown = {
        wins: session.winning_trades,
        losses: session.losing_trades,
        profitFactor: parseFloat(session.profit_factor),
        profitWeight: parseFloat(session.profit_weight),
        baseSPC: parseFloat(session.base_spc),
        comebackBonus: parseFloat(session.comeback_bonus),
        totalSPC: parseFloat(session.session_spc),
        tier: session.spc_tier,
        grade: session.session_grade
      };

      // Build progress bar
      const progressBarData = this.buildProgressBar(spcBreakdown);

      // Extract comeback highlights
      const comebackHighlights = this.extractComebackHighlights(trades || []);

      // Generate key learnings
      const keyLearnings = this.generateKeyLearnings(session, spcBreakdown);

      // Generate recommendations
      const recommendations = this.generateRecommendations(session, spcBreakdown, progress);

      // Build formatted report content
      const reportContent = this.formatReportContent(
        session,
        spcBreakdown,
        comebackHighlights,
        keyLearnings,
        recommendations,
        cumulativeSPCBefore,
        cumulativeSPCAfter,
        progress
      );

      const reportTitle = this.generateReportTitle(session);

      // Save report to database
      const { data: savedReport, error: saveError } = await supabase
        .from('session_reports')
        .insert({
          session_id: sessionId,
          user_id: userId,
          report_title: reportTitle,
          report_content: reportContent,
          progress_bar_data: progressBarData,
          spc_breakdown: spcBreakdown,
          comeback_highlights: comebackHighlights,
          key_learnings: keyLearnings,
          recommendations: recommendations,
          cumulative_spc_before: cumulativeSPCBefore,
          cumulative_spc_after: cumulativeSPCAfter,
          progress_change: cumulativeSPCAfter - cumulativeSPCBefore,
          current_tier: progress?.tier || 'Novice',
          progress_to_next_tier_percent: progress?.progressPercent || 0
        })
        .select()
        .single();

      if (saveError) {
        console.error('[Session Report] Error saving report:', saveError);
        return { success: false, error: saveError.message };
      }

      console.log('[Session Report] ✅ Report generated successfully');

      const report: SessionReport = {
        id: savedReport.id,
        sessionId,
        reportTitle,
        reportContent,
        progressBarData,
        spcBreakdown,
        comebackHighlights,
        keyLearnings,
        recommendations,
        cumulativeSPCBefore,
        cumulativeSPCAfter,
        progressChange: cumulativeSPCAfter - cumulativeSPCBefore,
        currentTier: progress?.tier || 'Novice',
        progressToNextTierPercent: progress?.progressPercent || 0
      };

      // Automatically post to thread
      setTimeout(async () => {
        try {
          await threadPostingService.postSessionReport(userId, sessionId, savedReport.id);
        } catch (error) {
          console.error('[Session Report] Error auto-posting to thread:', error);
        }
      }, 500);

      return { success: true, report };
    } catch (error) {
      console.error('[Session Report] Exception generating report:', error);
      return { success: false, error: 'Failed to generate report' };
    }
  }

  /**
   * Build progress bar segments
   */
  private buildProgressBar(breakdown: SPCBreakdown): ProgressBarSegment[] {
    const segments: ProgressBarSegment[] = [];

    if (breakdown.baseSPC > 0) {
      segments.push({
        type: 'positive',
        value: breakdown.baseSPC,
        label: `+${breakdown.baseSPC.toFixed(2)} Base SPC`,
        color: '#10b981' // green
      });
    } else if (breakdown.baseSPC < 0) {
      segments.push({
        type: 'negative',
        value: Math.abs(breakdown.baseSPC),
        label: `${breakdown.baseSPC.toFixed(2)} Base SPC`,
        color: '#ef4444' // red
      });
    } else {
      segments.push({
        type: 'flat',
        value: 0,
        label: '0 Base SPC',
        color: '#eab308' // yellow
      });
    }

    if (breakdown.comebackBonus > 0) {
      segments.push({
        type: 'comeback',
        value: breakdown.comebackBonus,
        label: `+${breakdown.comebackBonus.toFixed(2)} Comeback Bonus`,
        color: '#3b82f6' // blue
      });
    }

    return segments;
  }

  /**
   * Extract comeback trade highlights
   */
  private extractComebackHighlights(trades: any[]): string[] {
    const comebackTrades = trades.filter(t => t.is_comeback_trade);

    return comebackTrades.map(trade => {
      const lossesText = trade.losses_before_comeback === 2 ? '2 losses' : `${trade.losses_before_comeback} losses`;
      const bonusText = trade.comeback_bonus_applied === 1.0 ? 'DOUBLE BONUS' : 'bonus';

      return `🎉 Trade #${trade.trade_number}: Comeback after ${lossesText} (${trade.realized_rr.toFixed(2)}R) - ${bonusText} +${trade.comeback_bonus_applied.toFixed(2)}`;
    });
  }

  /**
   * Generate key learnings
   */
  private generateKeyLearnings(session: any, breakdown: SPCBreakdown): string[] {
    const learnings: string[] = [];

    // Win rate analysis
    learnings.push(
      `Session completed with ${breakdown.wins}W/${breakdown.losses}L (${session.win_rate.toFixed(1)}% win rate)`
    );

    // SPC performance
    if (breakdown.totalSPC >= 3) {
      learnings.push(`⭐ Strong session performance with +${breakdown.totalSPC.toFixed(2)} SPC`);
    } else if (breakdown.totalSPC > 0) {
      learnings.push(`✅ Positive session with +${breakdown.totalSPC.toFixed(2)} SPC`);
    } else if (breakdown.totalSPC < 0) {
      learnings.push(`⚠️ Negative session with ${breakdown.totalSPC.toFixed(2)} SPC`);
    }

    // Comeback analysis
    if (session.comeback_trades_count > 0) {
      learnings.push(
        `💪 ${session.comeback_trades_count} comeback trade${session.comeback_trades_count > 1 ? 's' : ''} demonstrated resilience`
      );
    }

    // Profit factor
    if (breakdown.profitFactor >= 2.0) {
      learnings.push(`🎯 Excellent profit factor of ${breakdown.profitFactor.toFixed(2)} (${breakdown.profitWeight}x weight)`);
    } else if (breakdown.profitFactor < 1.0) {
      learnings.push(`📉 Profit factor ${breakdown.profitFactor.toFixed(2)} needs improvement`);
    }

    // Drawdown
    if (session.max_consecutive_losses >= 3) {
      learnings.push(`🛑 ${session.max_consecutive_losses} consecutive losses detected - defensive mode may activate`);
    }

    return learnings;
  }

  /**
   * Generate recommendations
   */
  private generateRecommendations(
    session: any,
    breakdown: SPCBreakdown,
    progress: any
  ): string[] {
    const recommendations: string[] = [];

    // Based on SPC performance
    if (breakdown.totalSPC < 0) {
      recommendations.push('⚠️ Focus on reducing losses and improving profit factor');
      recommendations.push('Consider taking a break and reviewing recent trades');
    } else if (breakdown.totalSPC >= 5) {
      recommendations.push('⭐ Excellent session! Maintain current approach');
    }

    // Based on profit factor
    if (breakdown.profitFactor < 1.0) {
      recommendations.push('📊 Work on letting winners run longer for better R:R');
      recommendations.push('Review stop loss placement to reduce premature exits');
    }

    // Based on comebacks
    if (session.comeback_trades_count >= 2) {
      recommendations.push('💪 Your comeback ability is strong - trust the process after losses');
    }

    // Based on progress
    if (progress && progress.spcNeeded > 0) {
      recommendations.push(
        `🎯 ${progress.spcNeeded.toFixed(1)} more SPC points needed for ${progress.tier} level`
      );
    }

    // Defensive mode check
    if (session.session_mood === 'Defensive Mode Active' || breakdown.profitFactor < 0.8) {
      recommendations.push('🛡️ Consider activating Defensive Mode: reduce risk and focus on quality setups');
    }

    return recommendations;
  }

  /**
   * Format complete report content
   */
  private formatReportContent(
    session: any,
    breakdown: SPCBreakdown,
    comebackHighlights: string[],
    keyLearnings: string[],
    recommendations: string[],
    spcBefore: number,
    spcAfter: number,
    progress: any
  ): string {
    const duration = this.calculateSessionDuration(session.session_start, session.session_end);

    let report = `# ${this.generateReportTitle(session)}\n\n`;

    // Session Summary
    report += `## Session Summary\n\n`;
    report += `📅 **Duration:** ${duration}\n`;
    report += `📊 **Trades:** ${session.total_trades} (${breakdown.wins}W / ${breakdown.losses}L)\n`;
    report += `📈 **Win Rate:** ${session.win_rate.toFixed(1)}%\n`;
    report += `💰 **P/L:** $${session.total_pnl.toFixed(2)}\n`;
    report += `⚖️ **Profit Factor:** ${breakdown.profitFactor.toFixed(2)}\n`;
    report += `📏 **Avg R:R:** ${session.average_rr.toFixed(2)}\n`;
    report += `🎓 **Grade:** ${breakdown.grade}\n`;
    report += `😊 **Mood:** ${session.session_mood}\n\n`;

    // SPC Breakdown
    report += `## SPC Calculation\n\n`;
    report += `**Formula:** (Wins - Losses) × Profit Weight + Comeback Bonus\n\n`;
    report += `- Base SPC: (${breakdown.wins} - ${breakdown.losses}) × ${breakdown.profitWeight} = **${breakdown.baseSPC.toFixed(2)}**\n`;
    if (breakdown.comebackBonus > 0) {
      report += `- Comeback Bonus: **+${breakdown.comebackBonus.toFixed(2)}**\n`;
    }
    report += `- **Total Session SPC: ${breakdown.totalSPC.toFixed(2)}** (${breakdown.tier})\n\n`;

    // Progress Update
    report += `## Progress Update\n\n`;
    report += `- SPC Before: ${spcBefore.toFixed(2)}\n`;
    report += `- Session Change: ${breakdown.totalSPC >= 0 ? '+' : ''}${breakdown.totalSPC.toFixed(2)}\n`;
    report += `- **SPC After: ${spcAfter.toFixed(2)}**\n\n`;

    if (progress) {
      report += `**Progress to ${progress.tier}:** ${progress.progressPercent.toFixed(1)}% (${progress.spcNeeded.toFixed(1)} SPC needed)\n\n`;
    }

    // Comeback Highlights
    if (comebackHighlights.length > 0) {
      report += `## 🎉 Comeback Highlights\n\n`;
      comebackHighlights.forEach(highlight => {
        report += `${highlight}\n`;
      });
      report += `\n`;
    }

    // Key Learnings
    report += `## 📚 Key Learnings\n\n`;
    keyLearnings.forEach(learning => {
      report += `- ${learning}\n`;
    });
    report += `\n`;

    // Recommendations
    report += `## 💡 Recommendations\n\n`;
    recommendations.forEach(rec => {
      report += `- ${rec}\n`;
    });
    report += `\n`;

    report += `---\n\n`;
    report += `*Session ended at ${new Date(session.session_end).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET*`;

    return report;
  }

  /**
   * Generate report title
   */
  private generateReportTitle(session: any): string {
    const date = new Date(session.session_start).toLocaleDateString();
    const spc = parseFloat(session.session_spc);

    if (spc >= 5) return `🌟 Exceptional Session - ${date}`;
    if (spc >= 2) return `💪 Strong Session - ${date}`;
    if (spc > 0) return `✅ Positive Session - ${date}`;
    if (spc === 0) return `➖ Flat Session - ${date}`;
    return `⚠️ Challenging Session - ${date}`;
  }

  /**
   * Calculate session duration
   */
  private calculateSessionDuration(start: string, end: string): string {
    const startTime = new Date(start).getTime();
    const endTime = new Date(end).getTime();
    const durationMs = endTime - startTime;

    const hours = Math.floor(durationMs / (1000 * 60 * 60));
    const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  /**
   * Get cumulative SPC before this session
   */
  private async getCumulativeSPCBefore(userId: string, sessionStart: string): Promise<number> {
    try {
      const { data: progression } = await supabase
        .from('ai_skill_progression')
        .select('cumulative_spc')
        .eq('user_id', userId)
        .single();

      if (!progression) return 0;

      // Get current cumulative and subtract this session (if already added)
      const { data: currentSession } = await supabase
        .from('trading_sessions')
        .select('session_spc')
        .eq('user_id', userId)
        .eq('session_start', sessionStart)
        .single();

      const currentCumulative = parseFloat(progression.cumulative_spc) || 0;
      const currentSessionSPC = currentSession ? parseFloat(currentSession.session_spc) || 0 : 0;

      return currentCumulative - currentSessionSPC;
    } catch (error) {
      console.error('[Session Report] Error getting SPC before:', error);
      return 0;
    }
  }

  /**
   * Get recent session reports
   */
  async getRecentReports(userId: string, limit: number = 5): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('session_reports')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('[Session Report] Error fetching reports:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[Session Report] Exception fetching reports:', error);
      return [];
    }
  }
}

export const sessionReportGenerator = new SessionReportGenerator();
export type { SessionReport, ProgressBarSegment, SPCBreakdown };
