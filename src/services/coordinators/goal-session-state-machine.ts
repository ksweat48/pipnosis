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
  | 'awaiting_continuation'
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
  'scanning': ['active', 'awaiting_continuation', 'goal_achieved', 'timeout', 'paused', 'stopped', 'weekend_shutdown'],
  'active': ['awaiting_continuation', 'scanning', 'goal_achieved', 'timeout', 'paused', 'stopped'],
  'paused': ['scanning', 'active', 'stopped', 'timeout'],
  'awaiting_continuation': ['scanning', 'stopped', 'timeout'],
  'goal_achieved': [],
  'stopped': [],
  'timeout': [],
  'weekend_shutdown': ['scanning', 'stopped'],
};

const TERMINAL_STATES: GoalSessionStatus[] = ['goal_achieved', 'stopped', 'timeout'];

class GoalSessionStateMachine {
  private transitionLocks = new Map<string, boolean>();

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

      const currentStatus = session.status as GoalSessionStatus;

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

      const updateData: Record<string, unknown> = {
        status: newStatus,
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
      }

      const { error: updateError } = await supabase
        .from('goal_sessions')
        .update(updateData)
        .eq('id', sessionId)
        .eq('status', currentStatus);

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

    const currentStatus = session.status as GoalSessionStatus;

    const updateData: Record<string, unknown> = {
      status: newStatus,
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
    return data.status as GoalSessionStatus;
  }

  async canTransitionTo(sessionId: string, targetStatus: GoalSessionStatus): Promise<boolean> {
    const currentStatus = await this.getCurrentStatus(sessionId);
    if (!currentStatus) return false;
    return this.isValidTransition(currentStatus, targetStatus);
  }
}

export const goalSessionStateMachine = new GoalSessionStateMachine();
