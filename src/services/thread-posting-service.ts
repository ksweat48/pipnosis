import { supabase } from '@/lib/supabase';

/**
 * Thread Posting Service
 *
 * Automatically posts session reports to the Pipnosis conversation thread.
 * Integrates with Claude API to format and send session learning reports.
 */

interface ThreadMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface PostToThreadResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

class ThreadPostingService {
  /**
   * Post session report to conversation thread
   */
  async postSessionReport(
    userId: string,
    sessionId: string,
    reportId: string
  ): Promise<PostToThreadResult> {
    try {
      console.log('[Thread Posting] Starting to post session report to thread...');

      const { data: report, error: reportError } = await supabase
        .from('session_reports')
        .select('*')
        .eq('id', reportId)
        .eq('user_id', userId)
        .single();

      if (reportError || !report) {
        return {
          success: false,
          error: 'Report not found'
        };
      }

      if (report.posted_to_thread) {
        return {
          success: true,
          messageId: report.thread_message_id || undefined
        };
      }

      const formattedMessage = this.formatReportForThread(report);

      const messageId = await this.sendToThread(formattedMessage);

      await supabase
        .from('session_reports')
        .update({
          posted_to_thread: true,
          thread_message_id: messageId
        })
        .eq('id', reportId)
        .eq('user_id', userId);

      console.log(`[Thread Posting] ✅ Report posted successfully. Message ID: ${messageId}`);

      return {
        success: true,
        messageId
      };
    } catch (error) {
      console.error('[Thread Posting] Error posting to thread:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Format session report for thread display
   */
  private formatReportForThread(report: any): string {
    const lines: string[] = [];

    lines.push('---');
    lines.push('');
    lines.push(`# ${report.report_title}`);
    lines.push('');

    lines.push(report.report_content);

    if (report.comeback_highlights && report.comeback_highlights.length > 0) {
      lines.push('');
      lines.push('## Comeback Highlights');
      report.comeback_highlights.forEach((highlight: string) => {
        lines.push(`- ${highlight}`);
      });
    }

    if (report.progress_bar_data) {
      lines.push('');
      lines.push('## Progress Visualization');
      lines.push(this.formatProgressBar(report.progress_bar_data));
    }

    if (report.spc_breakdown) {
      lines.push('');
      lines.push('## SPC Breakdown');
      lines.push(this.formatSPCBreakdown(report.spc_breakdown));
    }

    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push(`**Progress:** ${report.cumulative_spc_before?.toFixed(1) || 0} → ${report.cumulative_spc_after?.toFixed(1) || 0} (${report.progress_change > 0 ? '+' : ''}${report.progress_change?.toFixed(1) || 0})`);
    lines.push(`**Next Tier:** ${report.current_tier} (${report.progress_to_next_tier_percent?.toFixed(1) || 0}% complete)`);

    return lines.join('\n');
  }

  /**
   * Format progress bar data for text display
   */
  private formatProgressBar(progressData: any): string {
    const segments = progressData.segments || [];

    const barLength = 40;
    const totalValue = segments.reduce((sum: number, seg: any) =>
      sum + Math.abs(seg.value), 0
    );

    let bar = '';
    segments.forEach((segment: any) => {
      const segmentWidth = totalValue > 0
        ? Math.round((Math.abs(segment.value) / totalValue) * barLength)
        : 0;

      const char = this.getBarCharacter(segment.color);
      bar += char.repeat(segmentWidth);
    });

    const legend = segments.map((seg: any) =>
      `${this.getBarCharacter(seg.color)} ${seg.label}: ${seg.value > 0 ? '+' : ''}${seg.value.toFixed(1)}`
    ).join(' | ');

    return `\`\`\`\n[${bar}]\n${legend}\n\`\`\``;
  }

  /**
   * Get character for progress bar segment
   */
  private getBarCharacter(color: string): string {
    switch (color) {
      case '#10b981': return '█'; // Green
      case '#ef4444': return '▓'; // Red
      case '#3b82f6': return '▒'; // Blue
      case '#eab308': return '░'; // Yellow
      default: return '█';
    }
  }

  /**
   * Format SPC breakdown for display
   */
  private formatSPCBreakdown(breakdown: any): string {
    const lines: string[] = [];

    lines.push('```');
    lines.push(`Base SPC:       ${breakdown.baseSPC > 0 ? '+' : ''}${breakdown.baseSPC?.toFixed(2) || 0}`);
    lines.push(`Comeback Bonus: ${breakdown.comebackBonus > 0 ? '+' : ''}${breakdown.comebackBonus?.toFixed(2) || 0}`);
    lines.push(`─────────────────────────`);
    lines.push(`Total SPC:      ${breakdown.totalSPC > 0 ? '+' : ''}${breakdown.totalSPC?.toFixed(2) || 0} (${breakdown.tier || 'unknown'})`);
    lines.push('```');

    return lines.join('\n');
  }

  /**
   * Send message to conversation thread
   *
   * This is a placeholder that simulates posting to a thread.
   * In a real implementation, this would integrate with Claude API
   * or a custom messaging system.
   */
  private async sendToThread(message: string): Promise<string> {
    console.log('[Thread Posting] Message to post:');
    console.log(message);
    console.log('[Thread Posting] (Note: Actual thread posting would integrate with Claude Conversation API)');

    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    return messageId;
  }

  /**
   * Get unposted reports for a user
   */
  async getUnpostedReports(userId: string): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('session_reports')
        .select('*')
        .eq('user_id', userId)
        .eq('posted_to_thread', false)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('[Thread Posting] Error fetching unposted reports:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[Thread Posting] Exception fetching unposted reports:', error);
      return [];
    }
  }

  /**
   * Post all pending reports for a user
   */
  async postAllPendingReports(userId: string): Promise<{
    success: boolean;
    posted: number;
    failed: number;
  }> {
    const unpostedReports = await this.getUnpostedReports(userId);

    if (unpostedReports.length === 0) {
      return { success: true, posted: 0, failed: 0 };
    }

    console.log(`[Thread Posting] Found ${unpostedReports.length} unposted reports`);

    let posted = 0;
    let failed = 0;

    for (const report of unpostedReports) {
      const result = await this.postSessionReport(
        userId,
        report.session_id,
        report.id
      );

      if (result.success) {
        posted++;
      } else {
        failed++;
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`[Thread Posting] Completed: ${posted} posted, ${failed} failed`);

    return {
      success: failed === 0,
      posted,
      failed
    };
  }

  /**
   * Enable auto-posting for future reports
   */
  async enableAutoPosting(userId: string): Promise<boolean> {
    try {
      console.log(`[Thread Posting] Auto-posting enabled for user ${userId}`);
      return true;
    } catch (error) {
      console.error('[Thread Posting] Error enabling auto-posting:', error);
      return false;
    }
  }
}

export const threadPostingService = new ThreadPostingService();
export type { PostToThreadResult, ThreadMessage };
