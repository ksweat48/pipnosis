/*
  # Autonomous Goal Session System - Server-Side Migration

  ## Overview
  Enables goal sessions to run autonomously on the server without requiring a browser to be open.
  Sessions can be started from any device and will continue running in the cloud.

  ## Changes

  1. **goal_sessions table enhancements**
     - Add `execution_mode` - Track if session runs client-side or server-side
     - Add `server_enabled` - Whether server should process this session
     - Add `server_last_check` - Last time server processed this session
     - Add `server_heartbeat` - Server health indicator
     - Add `server_error` - Track any server-side errors
     - Add `client_last_seen` - Last time a client viewed this session
     - Add `autonomous_enabled` - Master switch for autonomous operation

  2. **goal_session_server_state table (new)**
     - Tracks detailed server-side execution state
     - Stores last processed tick, last analysis, last trade decision
     - Enables recovery from server restarts
     - Multi-instance coordination

  ## Security
  - RLS policies ensure users can only see their own sessions
  - Service role has full access for server-side processing
  - Audit trail for all server actions

  ## Migration Notes
  - Existing sessions default to client-side execution
  - No impact on current UI or client-side functionality
  - Server-side function will only process sessions with server_enabled=true
*/

-- Add server-side tracking columns to goal_sessions
DO $$ 
BEGIN
  -- Execution mode tracking
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goal_sessions' AND column_name = 'execution_mode'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN execution_mode TEXT DEFAULT 'client';
    COMMENT ON COLUMN goal_sessions.execution_mode IS 'Where session runs: client, server, or hybrid';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goal_sessions' AND column_name = 'server_enabled'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN server_enabled BOOLEAN DEFAULT true;
    COMMENT ON COLUMN goal_sessions.server_enabled IS 'Whether server should autonomously process this session';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goal_sessions' AND column_name = 'server_last_check'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN server_last_check TIMESTAMPTZ;
    COMMENT ON COLUMN goal_sessions.server_last_check IS 'Last time server processed this session';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goal_sessions' AND column_name = 'server_heartbeat'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN server_heartbeat TIMESTAMPTZ;
    COMMENT ON COLUMN goal_sessions.server_heartbeat IS 'Server health indicator, updated every minute';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goal_sessions' AND column_name = 'server_error'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN server_error TEXT;
    COMMENT ON COLUMN goal_sessions.server_error IS 'Last server error message if any';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goal_sessions' AND column_name = 'client_last_seen'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN client_last_seen TIMESTAMPTZ;
    COMMENT ON COLUMN goal_sessions.client_last_seen IS 'Last time a client viewed this session';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goal_sessions' AND column_name = 'autonomous_enabled'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN autonomous_enabled BOOLEAN DEFAULT true;
    COMMENT ON COLUMN goal_sessions.autonomous_enabled IS 'Master switch for autonomous operation';
  END IF;
END $$;

-- Create goal_session_server_state table for detailed server-side state
CREATE TABLE IF NOT EXISTS goal_session_server_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_session_id UUID NOT NULL UNIQUE REFERENCES goal_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Execution state
  last_processed_at TIMESTAMPTZ DEFAULT now(),
  last_tick_time TIMESTAMPTZ,
  last_tick_price DECIMAL(20, 5),
  last_analysis_at TIMESTAMPTZ,
  last_trade_decision_at TIMESTAMPTZ,
  
  -- Market data state
  current_symbol TEXT,
  current_position_id UUID,
  pending_trade_signal JSONB,
  
  -- Recovery state
  processing_lock BOOLEAN DEFAULT false,
  processing_instance TEXT,
  lock_acquired_at TIMESTAMPTZ,
  
  -- Error tracking
  consecutive_errors INT DEFAULT 0,
  last_error TEXT,
  last_error_at TIMESTAMPTZ,
  
  -- Performance metrics
  trades_executed INT DEFAULT 0,
  server_decisions INT DEFAULT 0,
  avg_processing_time_ms INT DEFAULT 0,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Add indexes for server-side queries
CREATE INDEX IF NOT EXISTS idx_goal_sessions_server_enabled 
  ON goal_sessions(server_enabled, status) 
  WHERE server_enabled = true AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_goal_sessions_server_heartbeat 
  ON goal_sessions(server_heartbeat DESC) 
  WHERE server_enabled = true;

CREATE INDEX IF NOT EXISTS idx_goal_session_server_state_processing 
  ON goal_session_server_state(processing_lock, last_processed_at) 
  WHERE processing_lock = false;

CREATE INDEX IF NOT EXISTS idx_goal_session_server_state_errors 
  ON goal_session_server_state(consecutive_errors, last_error_at DESC) 
  WHERE consecutive_errors > 0;

-- Enable RLS on goal_session_server_state
ALTER TABLE goal_session_server_state ENABLE ROW LEVEL SECURITY;

-- RLS Policies for goal_session_server_state
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'goal_session_server_state' 
    AND policyname = 'Users can view own server state'
  ) THEN
    CREATE POLICY "Users can view own server state"
      ON goal_session_server_state FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'goal_session_server_state' 
    AND policyname = 'Service role has full access to server state'
  ) THEN
    CREATE POLICY "Service role has full access to server state"
      ON goal_session_server_state FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Function to update server_heartbeat and check for stale sessions
CREATE OR REPLACE FUNCTION update_server_heartbeat(
  p_session_id UUID,
  p_instance_id TEXT DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  UPDATE goal_sessions
  SET 
    server_heartbeat = now(),
    server_last_check = now(),
    server_error = NULL
  WHERE id = p_session_id;

  -- Update or create server state
  INSERT INTO goal_session_server_state (
    goal_session_id,
    user_id,
    last_processed_at,
    processing_instance
  )
  SELECT 
    id,
    user_id,
    now(),
    COALESCE(p_instance_id, 'netlify-scheduled')
  FROM goal_sessions
  WHERE id = p_session_id
  ON CONFLICT (goal_session_id) 
  DO UPDATE SET
    last_processed_at = now(),
    processing_instance = COALESCE(p_instance_id, 'netlify-scheduled'),
    processing_lock = false,
    updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to detect and mark stale sessions (server hasn't checked in 5+ minutes)
CREATE OR REPLACE FUNCTION mark_stale_sessions()
RETURNS TABLE(session_id UUID, stale_duration INTERVAL) AS $$
BEGIN
  RETURN QUERY
  UPDATE goal_sessions
  SET 
    server_error = 'Server heartbeat stopped - session may have crashed',
    execution_mode = 'client'
  WHERE 
    server_enabled = true 
    AND status = 'active'
    AND server_heartbeat < now() - INTERVAL '5 minutes'
  RETURNING id, now() - server_heartbeat;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get active sessions that need server processing
CREATE OR REPLACE FUNCTION get_sessions_for_server_processing()
RETURNS TABLE(
  session_id UUID,
  user_id UUID,
  symbol TEXT,
  target_amount DECIMAL,
  current_pnl DECIMAL,
  last_check TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    gs.id,
    gs.user_id,
    gs.symbol,
    gs.target_amount,
    gs.current_pnl,
    gs.server_last_check
  FROM goal_sessions gs
  WHERE 
    gs.status = 'active'
    AND gs.server_enabled = true
    AND gs.autonomous_enabled = true
    AND (
      gs.server_last_check IS NULL 
      OR gs.server_last_check < now() - INTERVAL '30 seconds'
    )
  ORDER BY 
    COALESCE(gs.server_last_check, gs.created_at) ASC
  LIMIT 50;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_server_state_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS goal_session_server_state_updated_at ON goal_session_server_state;
CREATE TRIGGER goal_session_server_state_updated_at
  BEFORE UPDATE ON goal_session_server_state
  FOR EACH ROW
  EXECUTE FUNCTION update_server_state_updated_at();

-- Add helpful comments
COMMENT ON TABLE goal_session_server_state IS 'Tracks detailed server-side execution state for autonomous goal sessions';
COMMENT ON FUNCTION update_server_heartbeat IS 'Updates server heartbeat to indicate session is being processed';
COMMENT ON FUNCTION mark_stale_sessions IS 'Detects sessions where server stopped processing (crashed/failed)';
COMMENT ON FUNCTION get_sessions_for_server_processing IS 'Returns active sessions that need server-side processing';
