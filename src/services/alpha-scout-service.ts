import { logger } from '../lib/logger';
import { councilContextService, type CouncilContext } from './council-context-service';
import { improvementDetector, type ImprovementAnalysis } from './improvement-detector';

export interface ScoutDecision {
  should_reconvene: boolean;
  improvement_score: number;
  reasoning: string;
  key_changes: string[];
  scout_mode: 'lightweight' | 'force_refresh';
}

class AlphaScoutService {
  async performScout(
    userId: string,
    sessionId: string,
    currentSnapshot: Record<string, any>
  ): Promise<ScoutDecision> {
    try {
      logger.info('[AlphaScout] Starting scout cycle', {
        user_id: userId,
        session_id: sessionId,
      });

      const context = await councilContextService.getLatestContext(userId, sessionId);

      if (!context) {
        logger.info('[AlphaScout] No context found - forcing full council');
        return {
          should_reconvene: true,
          improvement_score: 0,
          reasoning: 'No previous council context - running full scan',
          key_changes: [],
          scout_mode: 'force_refresh',
        };
      }

      const forceRefresh = improvementDetector.checkForceRefreshConditions(context);
      if (forceRefresh.should_refresh) {
        logger.info('[AlphaScout] Force refresh triggered', {
          reason: forceRefresh.reason,
        });
        return {
          should_reconvene: true,
          improvement_score: 0,
          reasoning: `Force refresh: ${forceRefresh.reason}`,
          key_changes: [],
          scout_mode: 'force_refresh',
        };
      }

      const analysis = improvementDetector.compareSnapshots(
        context.last_snapshot,
        currentSnapshot,
        context.required_improvements
      );

      await councilContextService.incrementScoutCycle(
        userId,
        sessionId,
        analysis.improvement_score
      );

      const decision: ScoutDecision = {
        should_reconvene: analysis.should_reconvene,
        improvement_score: analysis.improvement_score,
        reasoning: analysis.reasoning,
        key_changes: analysis.key_changes,
        scout_mode: 'lightweight',
      };

      logger.info('[AlphaScout] Scout decision made', {
        should_reconvene: decision.should_reconvene,
        improvement_score: decision.improvement_score,
        scout_cycles: (context.scout_cycles || 0) + 1,
      });

      return decision;
    } catch (error) {
      logger.error('[AlphaScout] Exception during scout', { error });
      return {
        should_reconvene: true,
        improvement_score: 0,
        reasoning: 'Error during scout - defaulting to full council',
        key_changes: [],
        scout_mode: 'force_refresh',
      };
    }
  }



  formatScoutMessage(decision: ScoutDecision, scoutCycles: number): string {
    const lines: string[] = [];

    if (decision.should_reconvene) {
      lines.push(`🚨 Alpha Scout: Conditions improved (${decision.improvement_score}%) - Reconvening Omega Council!`);
      if (decision.key_changes.length > 0) {
        lines.push('Key changes detected:');
        for (const change of decision.key_changes.slice(0, 3)) {
          lines.push(`  • ${change}`);
        }
      }
    } else {
      lines.push(`🔍 Alpha Scout (Cycle ${scoutCycles}): ${decision.improvement_score}% improvement detected, monitoring...`);
      if (decision.key_changes.length > 0) {
        lines.push(`Changes: ${decision.key_changes.slice(0, 2).join(', ')}`);
      } else {
        lines.push('Waiting for market conditions to improve...');
      }
    }

    return lines.join('\n');
  }

  async buildQuickSnapshot(symbols: string[]): Promise<Record<string, any>> {
    logger.info('[AlphaScout] Building quick snapshot', { symbols });

    return {};
  }
}

export const alphaScoutService = new AlphaScoutService();
