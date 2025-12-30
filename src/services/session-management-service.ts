/**
 * Session Management Service - Type Definitions
 *
 * This file provides stub implementations for session management.
 * The actual functionality is handled by goal_sessions table and smart-goal-session-manager.
 */

export interface TradingSession {
  id: string;
  user_id: string;
  status: 'active' | 'paused' | 'ended';
  session_type: 'manual' | 'goal_based';
  start_time: string;
  end_time?: string;
  metadata?: Record<string, any>;
}

export const sessionManagementService = {
  getActiveSession: async (userId: string): Promise<TradingSession | null> => {
    console.warn('[session-management-service] getActiveSession called but not implemented');
    console.warn('Use smart-goal-session-manager or query goal_sessions table instead');
    return null;
  },

  getRecentSessions: async (userId: string, limit = 10): Promise<TradingSession[]> => {
    console.warn('[session-management-service] getRecentSessions called but not implemented');
    console.warn('Use smart-goal-session-manager or query goal_sessions table instead');
    return [];
  },

  startSession: async (userId: string, sessionType: string): Promise<TradingSession | null> => {
    console.warn('[session-management-service] startSession called but not implemented');
    console.warn('Use smart-goal-session-manager.startGoalSession() instead');
    return null;
  },

  pauseSession: async (sessionId: string): Promise<boolean> => {
    console.warn('[session-management-service] pauseSession called but not implemented');
    console.warn('Use smart-goal-session-manager methods instead');
    return false;
  },

  resumeSession: async (sessionId: string): Promise<boolean> => {
    console.warn('[session-management-service] resumeSession called but not implemented');
    console.warn('Use smart-goal-session-manager methods instead');
    return false;
  },

  endSession: async (sessionId: string): Promise<boolean> => {
    console.warn('[session-management-service] endSession called but not implemented');
    console.warn('Use smart-goal-session-manager methods instead');
    return false;
  }
};
