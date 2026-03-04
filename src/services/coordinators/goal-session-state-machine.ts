/**
 * GOAL SESSION STATE MACHINE - Single Source of Truth
 *
 * ALL goal session status transitions MUST go through this state machine.
 * DO NOT update goal_sessions.status directly elsewhere in the codebase.
 *
 * This ensures:
 * - Valid state transitions only
 * - No race conditions between services
 * - Auditable state change history
 * - Consistent behavior across the system
 */

import { supabase } from '../../lib/supabase';

export type GoalSessionStatus =
  | 'initializing'
  | 'scanning'
  | 'active'
  | 'paused'
  | 'goal_achieved'
  | 'stopped'
  | 'timeout'
  | 'weekend_shutdown';

export interface StateTransitionResult {
  success: boolean;
  previousStatus: GoalSessionStatus | null;
  newStatus: GoalSessionStatus | null;
  error?: string;
  transitionId?: string;
}

export interface TransitionMetadata {
  reason?: string;
  triggeredBy?: string;
  tradeId?: string;
  pnl?: number;
  additionalData?: Record<string, unknown>;
}

const VALID_TRANSITIONS: Record<GoalSessionStatus, GoalSessionStatus[]> = {
  'initializing': ['scanning', 'timeout', 'stopped'],
  'scanning': ['active', 'goal_achieved', 'timeout', 'paused', 'stopped', 'weekend_shutdown'],
  'active': ['scanning', 'goal_achieved', 'timeout', 'paused', 'stopped'],
  'paused': ['scanning', 'active', 'stopped', 'timeout'],
  'goal_achieved': [],
  'stopped': [],
  'timeout': [],
  'weekend_shutdown': ['scanning', 'stopped'],
};

const TERMINAL_STATES: GoalSessionStatus[] = ['goal_achieved', 'stopped', 'timeout'];

const DB_STATUS_MAP: Partial<Record<GoalSessionStatus, string>> = {
  'stopped': 'user_stopped',
};

const DB_STATUS_REVERSE: Record<string, GoalSessionStatus> = {
  'user_stopped': 'stopped',
  'system_stopped': 'stopped',
};

class GoalSessionStateMachine {
  private transitionLocks = new Map<string, boolean>();

  private toDbStatus(status: GoalSessionStatus): string {
    return DB_STATUS_MAP[status] ?? status;
  }

  private fromDbStatus(dbStatus: string): GoalSessionStatus {
    return DB_STATUS_REVERSE[dbStatus] ?? (dbStatus as GoalSessionStatus);
  }

  isValidTransition(from: GoalSessionStatus, to: GoalSessionStatus): boolean {
    return VALID_TRANSITIONS[from]?.includes(to) ?? false;
  }

  isTerminalState(status: GoalSessionStatus): boolean {
    return TERMINAL_STATES.includes(status);
  }

  getValidTransitionsFrom(status: GoalSessionStatus): GoalSessionStatus[] {
    return VALID_TRANSITIONS[status] ?? [];
  }

  async transition(
    sessionId: string,
    newStatus: GoalSessionStatus,
    metadata?: TransitionMetadata
  ): Promise<StateTransitionResult> {
    if (this.transitionLocks.get(sessionId)) {
      return {
        success: false,
        previousStatus: null,
        newStatus: null,
        error: 'Transition already in progress for this session',
      };
    }

    this.transitionLocks.set(sessionId, true);

    try {
      const { data: session, error: fetchError } = await supabase
        .from('goal_sessions')
        .select('status, user_id')
        .eq('id', sessionId)
        .maybeSingle();

      if (fetchError || !session) {
        return {
          success: false,
          previousStatus: null,
          newStatus: null,
          error: fetchError?.message || 'Session not found',
        };
      }

      const rawDbStatus = session.status as string;
      const currentStatus = this.fromDbStatus(rawDbStatus);

      if (currentStatus === newStatus) {
        return {
          success: true,
          previousStatus: currentStatus,
          newStatus: currentStatus,
        };
      }

      if (!this.isValidTransition(currentStatus, newStatus)) {
        console.warn(
          `[StateMachine] Invalid transition attempted: ${currentStatus} -> ${newStatus} for session ${sessionId}`
        );
        return {
          success: false,
          previousStatus: currentStatus,
          newStatus: null,
          error: `Invalid transition: ${currentStatus} -> ${newStatus}`,
        };
      }

      const dbStatus = this.toDbStatus(newStatus);

      const updateData: Record<string, unknown> = {
        status: dbStatus,
        updated_at: new Date().toISOString(),
      };

      if (newStatus === 'goal_achieved') {
        updateData.goal_achieved_at = new Date().toISOString();
        if (metadata?.pnl !== undefined) {
          updateData.goal_achieved_pnl = metadata.pnl;
        }
      }

      if (TERMINAL_STATES.includes(newStatus)) {
        updateData.completed_at = new Date().toISOString();
        const stats = await this.computeSessionStats(sessionId);
        if (stats) {
          updateData.session_win_rate = stats.winRate;
          updateData.session_profit_factor = stats.profitFactor;
          updateData.session_total_trades = stats.totalTrades;
        }
      }

      const { error: updateError } = await supabase
        .from('goal_sessions')
        .update(updateData)
        .eq('id', sessionId)
        .eq('status', rawDbStatus);

      if (updateError) {
        return {
          success: false,
          previousStatus: currentStatus,
          newStatus: null,
          error: updateError.message,
        };
      }

      console.log(
        `[StateMachine] Transition successful: ${currentStatus} -> ${newStatus} for session ${sessionId}`,
        metadata?.reason ? `Reason: ${metadata.reason}` : ''
      );

      return {
        success: true,
        previousStatus: currentStatus,
        newStatus: newStatus,
        transitionId: `${sessionId}-${Date.now()}`,
      };
    } finally {
      this.transitionLocks.delete(sessionId);
    }
  }

  async forceTransition(
    sessionId: string,
    newStatus: GoalSessionStatus,
    metadata?: TransitionMetadata
  ): Promise<StateTransitionResult> {
    console.warn(
      `[StateMachine] FORCE transition to ${newStatus} for session ${sessionId}`,
      metadata?.reason ? `Reason: ${metadata.reason}` : ''
    );

    const { data: session, error: fetchError } = await supabase
      .from('goal_sessions')
      .select('status')
      .eq('id', sessionId)
      .maybeSingle();

    if (fetchError || !session) {
      return {
        success: false,
        previousStatus: null,
        newStatus: null,
        error: fetchError?.message || 'Session not found',
      };
    }

    const currentStatus = this.fromDbStatus(session.status);
    const dbStatus = this.toDbStatus(newStatus);

    const updateData: Record<string, unknown> = {
      status: dbStatus,
      updated_at: new Date().toISOString(),
    };

    if (newStatus === 'goal_achieved') {
      updateData.goal_achieved_at = new Date().toISOString();
      if (metadata?.pnl !== undefined) {
        updateData.goal_achieved_pnl = metadata.pnl;
      }
    }

    if (TERMINAL_STATES.includes(newStatus)) {
      updateData.completed_at = new Date().toISOString();
      const stats = await this.computeSessionStats(sessionId);
      if (stats) {
        updateData.session_win_rate = stats.winRate;
        updateData.session_profit_factor = stats.profitFactor;
        updateData.session_total_trades = stats.totalTrades;
      }
    }

    const { error: updateError } = await supabase
      .from('goal_sessions')
      .update(updateData)
      .eq('id', sessionId);

    if (updateError) {
      return {
        success: false,
        previousStatus: currentStatus,
        newStatus: null,
        error: updateError.message,
      };
    }

    return {
      success: true,
      previousStatus: currentStatus,
      newStatus: newStatus,
    };
  }

  async getCurrentStatus(sessionId: string): Promise<GoalSessionStatus | null> {
    const { data, error } = await supabase
      .from('goal_sessions')
      .select('status')
      .eq('id', sessionId)
      .maybeSingle();

    if (error || !data) return null;
    return this.fromDbStatus(data.status);
  }

  async canTransitionTo(sessionId: string, targetStatus: GoalSessionStatus): Promise<boolean> {
    const currentStatus = await this.getCurrentStatus(sessionId);
    if (!currentStatus) return false;
    return this.isValidTransition(currentStatus, targetStatus);
  }

  private async computeSessionStats(sessionId: string): Promise<{
    winRate: number;
    profitFactor: number;
    totalTrades: number;
  } | null> {
    try {
      const { data: trades, error } = await supabase
        .from('goal_session_trades')
        .select('profit_loss, status')
        .eq('goal_session_id', sessionId)
        .eq('status', 'closed');

      if (error || !trades || trades.length === 0) return null;

      const totalTrades = trades.length;
      const wins = trades.filter(t => (t.profit_loss ?? 0) > 0);
      const losses = trades.filter(t => (t.profit_loss ?? 0) < 0);

      const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;

      const grossProfit = wins.reduce((sum, t) => sum + (t.profit_loss ?? 0), 0);
      const grossLoss = Math.abs(losses.reduce((sum, t) => sum + (t.profit_loss ?? 0), 0));
      const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;

      return { winRate, profitFactor, totalTrades };
    } catch {
      return null;
    }
  }
}

export const goalSessionStateMachine = new GoalSessionStateMachine();
