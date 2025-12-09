/*
  # Single-Trade Default with Multi-Trade Toggle System

  This migration adds support for pausing goal sessions after each trade
  and prompting users to continue or stop.

  ## New Fields Added to goal_sessions:
    - `multi_trade_enabled` (boolean) - When false (default), pauses after each trade
    - `awaiting_user_continuation` (boolean) - True when session is paused awaiting user response
    - `continuation_prompt` (text) - The AI-generated prompt shown to the user
    - `last_trade_id` (uuid) - Reference to the most recent trade for context
    - `trades_in_session` (integer) - Counter for trades executed in this session

  ## Benefits:
    - Reduces risk of runaway losses
    - Forces user to consciously review each trade
    - Allows users to opt into multi-trade mode if desired
    - Provides clear continuation prompts from AI

  ## Security:
    - RLS policies already exist for goal_sessions
    - New fields are user-specific and protected
*/

-- Add new columns to goal_sessions table
ALTER TABLE goal_sessions
  ADD COLUMN IF NOT EXISTS multi_trade_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS awaiting_user_continuation boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS continuation_prompt text,
  ADD COLUMN IF NOT EXISTS last_trade_id uuid REFERENCES simulated_positions(id),
  ADD COLUMN IF NOT EXISTS trades_in_session integer DEFAULT 0;

-- Add index for faster lookups of sessions awaiting continuation
CREATE INDEX IF NOT EXISTS idx_goal_sessions_awaiting_continuation
  ON goal_sessions(user_id, awaiting_user_continuation, status)
  WHERE awaiting_user_continuation = true AND status = 'active';

-- Add index for trade counting
CREATE INDEX IF NOT EXISTS idx_goal_sessions_trades_counter
  ON goal_sessions(user_id, trades_in_session, status)
  WHERE status = 'active';

-- Add comment explaining the feature
COMMENT ON COLUMN goal_sessions.multi_trade_enabled IS
  'When false (default), session pauses after each trade for user review. When true, continues scanning for multiple trades.';

COMMENT ON COLUMN goal_sessions.awaiting_user_continuation IS
  'True when session has completed a trade and is waiting for user to decide whether to continue.';

COMMENT ON COLUMN goal_sessions.continuation_prompt IS
  'AI-generated prompt explaining the last trade result and asking if user wants to continue.';

COMMENT ON COLUMN goal_sessions.last_trade_id IS
  'Reference to the most recent trade executed in this session, used for generating continuation prompts.';

COMMENT ON COLUMN goal_sessions.trades_in_session IS
  'Counter tracking how many trades have been executed during this goal session.';