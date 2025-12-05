/*
  # Add Block State Tracking to Goal Sessions

  1. Purpose
    - Track when sessions are blocked by adversarial market conditions
    - Show users why scanning isn't finding trades
    - Enable manual override functionality
    - Prevent "stuck scanning" UI issues

  2. New Columns
    - `block_state` - Current block status (null, 'manipulation_spike', 'stop_run', etc.)
    - `block_reason` - Human-readable explanation of the block
    - `blocked_since` - Timestamp when block started
    - `block_expires_at` - Estimated time when block will clear
    - `block_override_enabled` - Whether user can manually override
    - `block_candles_ago` - How many candles ago the blocking event occurred

  3. Security
    - Maintains existing RLS policies
    - Users can view and update their own sessions
*/

-- Add block tracking columns to goal_sessions
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'goal_sessions' AND column_name = 'block_state') THEN
    ALTER TABLE goal_sessions ADD COLUMN block_state text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'goal_sessions' AND column_name = 'block_reason') THEN
    ALTER TABLE goal_sessions ADD COLUMN block_reason text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'goal_sessions' AND column_name = 'blocked_since') THEN
    ALTER TABLE goal_sessions ADD COLUMN blocked_since timestamptz;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'goal_sessions' AND column_name = 'block_expires_at') THEN
    ALTER TABLE goal_sessions ADD COLUMN block_expires_at timestamptz;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'goal_sessions' AND column_name = 'block_override_enabled') THEN
    ALTER TABLE goal_sessions ADD COLUMN block_override_enabled boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'goal_sessions' AND column_name = 'block_candles_ago') THEN
    ALTER TABLE goal_sessions ADD COLUMN block_candles_ago integer DEFAULT 0;
  END IF;
END $$;

-- Add index for quick block state queries
CREATE INDEX IF NOT EXISTS idx_goal_sessions_block_state
  ON goal_sessions(user_id, block_state)
  WHERE block_state IS NOT NULL;

-- Add comment explaining the block states
COMMENT ON COLUMN goal_sessions.block_state IS 'Current adversarial block state: manipulation_spike, active_stop_run, or null if not blocked';
COMMENT ON COLUMN goal_sessions.block_reason IS 'Human-readable explanation of why trading is blocked';
COMMENT ON COLUMN goal_sessions.blocked_since IS 'Timestamp when the current block started';
COMMENT ON COLUMN goal_sessions.block_expires_at IS 'Estimated timestamp when block will automatically clear';
COMMENT ON COLUMN goal_sessions.block_override_enabled IS 'Whether user is allowed to manually override this block';
COMMENT ON COLUMN goal_sessions.block_candles_ago IS 'Number of candles ago the blocking event occurred';
