import { supabase } from '../lib/supabase';

interface LearningPipelineDiagnostics {
  isWorking: boolean;
  issues: string[];
  checks: {
    tradeAnalysis: { count: number; lastUpdated: string | null };
    winningPatterns: { count: number; lastDiscovered: string | null };
    losingPatterns: { count: number; lastIdentified: string | null };
    skillProgression: { currentLevel: string; totalWinningTrades: number };
    performanceEvolution: { sessions: number; lastSession: string | null };
    patternEVTracking: { patterns: number; avgEV: number };
  };
}

/**
 * Diagnostic utility to verify AI learning pipeline is working correctly
 */
class AILearningDiagnostics {
  async verifyLearningPipeline(userId: string): Promise<LearningPipelineDiagnostics> {
    console.log('[AI Learning Diagnostics] Starting verification...');

    const issues: string[] = [];
    let isWorking = true;

    // Check 1: Trade Analysis
    const { data: tradeAnalysis } = await supabase
      .from('ai_trade_analysis')
      .select('created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1);

    const tradeAnalysisCount = tradeAnalysis?.length || 0;
    const lastTradeAnalysis = tradeAnalysis?.[0]?.created_at || null;

    if (tradeAnalysisCount === 0) {
      issues.push('No trade analysis records found');
      isWorking = false;
    }

    // Check 2: Winning Patterns
    const { data: winningPatterns } = await supabase
      .from('ai_winning_patterns')
      .select('discovered_at')
      .eq('user_id', userId)
      .order('discovered_at', { ascending: false })
      .limit(1);

    const winningPatternsCount = winningPatterns?.length || 0;
    const lastWinningPattern = winningPatterns?.[0]?.discovered_at || null;

    if (winningPatternsCount === 0) {
      issues.push('No winning patterns discovered');
    }

    // Check 3: Losing Patterns
    const { data: losingPatterns } = await supabase
      .from('ai_losing_patterns')
      .select('identified_at')
      .eq('user_id', userId)
      .order('identified_at', { ascending: false })
      .limit(1);

    const losingPatternsCount = losingPatterns?.length || 0;
    const lastLosingPattern = losingPatterns?.[0]?.identified_at || null;

    // Check 4: Skill Progression
    const { data: skillData } = await supabase
      .from('ai_skill_progression')
      .select('*')
      .eq('user_id', userId)
      .single();

    const currentLevel = skillData?.current_level || 'Novice';
    const totalWinningTrades = skillData?.total_winning_trades || 0;

    if (totalWinningTrades === 0) {
      issues.push('No winning trades recorded in skill progression');
    }

    // Check 5: Performance Evolution
    const { data: perfEvolution } = await supabase
      .from('ai_performance_evolution')
      .select('session_date')
      .eq('user_id', userId)
      .order('session_date', { ascending: false })
      .limit(1);

    const perfEvolutionSessions = perfEvolution?.length || 0;
    const lastPerfEvolution = perfEvolution?.[0]?.session_date || null;

    if (perfEvolutionSessions === 0) {
      issues.push('No performance evolution data');
    }

    // Check 6: Pattern EV Tracking
    const { data: patternEV } = await supabase
      .from('ai_pattern_ev_tracking')
      .select('expected_value')
      .eq('user_id', userId);

    const patternEVCount = patternEV?.length || 0;
    const avgEV = patternEVCount > 0
      ? patternEV.reduce((sum, p) => sum + (p.expected_value || 0), 0) / patternEVCount
      : 0;

    if (patternEVCount === 0) {
      issues.push('No pattern EV tracking data');
    }

    const result: LearningPipelineDiagnostics = {
      isWorking,
      issues,
      checks: {
        tradeAnalysis: {
          count: tradeAnalysisCount,
          lastUpdated: lastTradeAnalysis
        },
        winningPatterns: {
          count: winningPatternsCount,
          lastDiscovered: lastWinningPattern
        },
        losingPatterns: {
          count: losingPatternsCount,
          lastIdentified: lastLosingPattern
        },
        skillProgression: {
          currentLevel,
          totalWinningTrades
        },
        performanceEvolution: {
          sessions: perfEvolutionSessions,
          lastSession: lastPerfEvolution
        },
        patternEVTracking: {
          patterns: patternEVCount,
          avgEV
        }
      }
    };

    console.log('[AI Learning Diagnostics] Verification complete:', result);
    return result;
  }

  /**
   * Generate a human-readable diagnostic report
   */
  async generateReport(userId: string): Promise<string> {
    const diagnostics = await this.verifyLearningPipeline(userId);

    let report = '=== AI LEARNING PIPELINE DIAGNOSTICS ===\n\n';
    report += `Status: ${diagnostics.isWorking ? '✅ WORKING' : '❌ ISSUES DETECTED'}\n\n`;

    if (diagnostics.issues.length > 0) {
      report += 'Issues Found:\n';
      diagnostics.issues.forEach((issue, i) => {
        report += `  ${i + 1}. ${issue}\n`;
      });
      report += '\n';
    }

    report += 'Pipeline Checks:\n';
    report += `  Trade Analysis: ${diagnostics.checks.tradeAnalysis.count} records\n`;
    report += `    Last updated: ${diagnostics.checks.tradeAnalysis.lastUpdated || 'Never'}\n`;
    report += `  Winning Patterns: ${diagnostics.checks.winningPatterns.count} patterns\n`;
    report += `    Last discovered: ${diagnostics.checks.winningPatterns.lastDiscovered || 'Never'}\n`;
    report += `  Losing Patterns: ${diagnostics.checks.losingPatterns.count} patterns\n`;
    report += `    Last identified: ${diagnostics.checks.losingPatterns.lastIdentified || 'Never'}\n`;
    report += `  Skill Progression: ${diagnostics.checks.skillProgression.currentLevel}\n`;
    report += `    Total winning trades: ${diagnostics.checks.skillProgression.totalWinningTrades}\n`;
    report += `  Performance Evolution: ${diagnostics.checks.performanceEvolution.sessions} sessions\n`;
    report += `    Last session: ${diagnostics.checks.performanceEvolution.lastSession || 'Never'}\n`;
    report += `  Pattern EV Tracking: ${diagnostics.checks.patternEVTracking.patterns} patterns\n`;
    report += `    Average EV: ${diagnostics.checks.patternEVTracking.avgEV.toFixed(2)}\n`;

    return report;
  }
}

export const aiLearningDiagnostics = new AILearningDiagnostics();
export type { LearningPipelineDiagnostics };
