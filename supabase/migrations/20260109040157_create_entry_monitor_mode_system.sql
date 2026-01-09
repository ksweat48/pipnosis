/*
  # Entry Monitor Mode System - Zero LLM Execution Waiting

  This migration implements a two-mode lifecycle for trading:
  1. DISCOVERY_SCANNING - Multi-symbol evaluation with LLM allowed
  2. ENTRY_MONITOR - Single-symbol execution waiting with ZERO LLM

  ## 1. New Fields on goal_sessions
    - `entry_monitor_state` (enum) - Explicit state machine tracking
    - `locked_symbol` - Symbol being monitored (when in ENTRY_MONITOR)
    - `locked_direction` - Direction being monitored (BUY/SELL)
    - `entry_monitor_started_at` - When monitoring began
    - `last_llm_call_at` - For debugging LLM call patterns

  ## 2. Enhanced entry_intents Table
    - `abandon_zone_low` - Price below which BUY intent is abandoned
    - `abandon_zone_high` - Price above which SELL intent is abandoned
    - `consecutive_checks_outside_zone` - Counter for runaway detection
    - `last_price_check_at` - Timestamp of most recent price check
    - `entry_quality_score` - Latest EQS calculation
    - `eqs_breakdown` - Detailed EQS component scores

  ## 3. New entry_monitor_logs Table
    - Tracks every 2-5 second check during ENTRY_MONITOR mode
    - Records price, zone status, EQS, and decisions

  ## 4. State Machine Constraints
    - goal_sessions.entry_monitor_state: enforced enum values
    - Proper state transitions logged

  ## Security
    - RLS enabled on new table
    - Policies for authenticated users
*/

-- Create entry monitor state enum type
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'entry_monitor_state_enum') THEN
    CREATE TYPE entry_monitor_state_enum AS ENUM (
      'DISCOVERY_SCANNING',
      'ENTRY_INTENT_CREATED',
      'ENTRY_MONITOR_ACTIVE',
      'EXECUTE_PENDING',
      'TRADE_ACTIVE',
      'ABANDONED_RESCAN_REQUESTED'
    );
  END IF;
END $$;

-- Add entry monitor fields to goal_sessions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'entry_monitor_state'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN entry_monitor_state text DEFAULT 'DISCOVERY_SCANNING';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'locked_symbol'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN locked_symbol text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'locked_direction'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN locked_direction text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'entry_monitor_started_at'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN entry_monitor_started_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'last_llm_call_at'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN last_llm_call_at timestamptz;
  END IF;
END $$;

-- Add check constraint for valid entry_monitor_state values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'valid_entry_monitor_state'
  ) THEN
    ALTER TABLE goal_sessions ADD CONSTRAINT valid_entry_monitor_state
    CHECK (entry_monitor_state IN (
      'DISCOVERY_SCANNING',
      'ENTRY_INTENT_CREATED', 
      'ENTRY_MONITOR_ACTIVE',
      'EXECUTE_PENDING',
      'TRADE_ACTIVE',
      'ABANDONED_RESCAN_REQUESTED'
    ));
  END IF;
END $$;

-- Add abandon zone fields to entry_intents
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'abandon_zone_low'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN abandon_zone_low numeric;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'abandon_zone_high'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN abandon_zone_high numeric;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'consecutive_checks_outside_zone'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN consecutive_checks_outside_zone integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'last_price_check_at'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN last_price_check_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'entry_quality_score'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN entry_quality_score integer;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'eqs_breakdown'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN eqs_breakdown jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'atr_at_creation'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN atr_at_creation numeric;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'style'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN style text DEFAULT 'MICRO_INTRADAY';
  END IF;
END $$;

-- Create entry_monitor_logs table for detailed monitoring history
CREATE TABLE IF NOT EXISTS entry_monitor_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id uuid REFERENCES entry_intents(id) ON DELETE CASCADE,
  session_id uuid REFERENCES goal_sessions(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  
  timestamp timestamptz DEFAULT now(),
  current_price numeric NOT NULL,
  
  in_entry_zone boolean NOT NULL,
  distance_to_zone_pips numeric,
  
  in_abandon_zone boolean DEFAULT false,
  abandon_zone_check_result text,
  
  entry_quality_score integer,
  eqs_breakdown jsonb,
  
  consecutive_outside_count integer DEFAULT 0,
  
  decision text NOT NULL,
  decision_reason text,
  
  llm_called boolean DEFAULT false,
  
  created_at timestamptz DEFAULT now()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_entry_monitor_logs_intent_id ON entry_monitor_logs(intent_id);
CREATE INDEX IF NOT EXISTS idx_entry_monitor_logs_session_id ON entry_monitor_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_entry_monitor_logs_timestamp ON entry_monitor_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_goal_sessions_entry_monitor_state ON goal_sessions(entry_monitor_state) WHERE entry_monitor_state != 'DISCOVERY_SCANNING';
CREATE INDEX IF NOT EXISTS idx_entry_intents_status_session ON entry_intents(session_id, status) WHERE status = 'monitoring';

-- Enable RLS on entry_monitor_logs
ALTER TABLE entry_monitor_logs ENABLE ROW LEVEL SECURITY;

-- RLS policies for entry_monitor_logs
DROP POLICY IF EXISTS "Users can view own monitor logs" ON entry_monitor_logs;
CREATE POLICY "Users can view own monitor logs"
  ON entry_monitor_logs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own monitor logs" ON entry_monitor_logs;
CREATE POLICY "Users can insert own monitor logs"
  ON entry_monitor_logs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Function to transition entry monitor state with logging
CREATE OR REPLACE FUNCTION transition_entry_monitor_state(
  p_session_id uuid,
  p_new_state text,
  p_locked_symbol text DEFAULT NULL,
  p_locked_direction text DEFAULT NULL
) RETURNS void AS $$
DECLARE
  v_old_state text;
BEGIN
  SELECT entry_monitor_state INTO v_old_state
  FROM goal_sessions
  WHERE id = p_session_id;

  UPDATE goal_sessions
  SET 
    entry_monitor_state = p_new_state,
    locked_symbol = COALESCE(p_locked_symbol, 
      CASE WHEN p_new_state = 'DISCOVERY_SCANNING' THEN NULL ELSE locked_symbol END),
    locked_direction = COALESCE(p_locked_direction,
      CASE WHEN p_new_state = 'DISCOVERY_SCANNING' THEN NULL ELSE locked_direction END),
    entry_monitor_started_at = CASE 
      WHEN p_new_state = 'ENTRY_MONITOR_ACTIVE' THEN now()
      WHEN p_new_state = 'DISCOVERY_SCANNING' THEN NULL
      ELSE entry_monitor_started_at
    END,
    updated_at = now()
  WHERE id = p_session_id;

  RAISE NOTICE '[STATE_TRANSITION] Session % transitioned from % to % (symbol: %, direction: %)',
    p_session_id, v_old_state, p_new_state, p_locked_symbol, p_locked_direction;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get current entry monitor state for a session
CREATE OR REPLACE FUNCTION get_entry_monitor_state(p_session_id uuid)
RETURNS TABLE (
  state text,
  locked_symbol text,
  locked_direction text,
  monitor_started_at timestamptz,
  active_intent_id uuid,
  seconds_in_monitor integer
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    gs.entry_monitor_state as state,
    gs.locked_symbol,
    gs.locked_direction,
    gs.entry_monitor_started_at as monitor_started_at,
    ei.id as active_intent_id,
    EXTRACT(EPOCH FROM (now() - gs.entry_monitor_started_at))::integer as seconds_in_monitor
  FROM goal_sessions gs
  LEFT JOIN entry_intents ei ON ei.session_id = gs.id AND ei.status = 'monitoring'
  WHERE gs.id = p_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if LLM calls are allowed (for guard enforcement)
CREATE OR REPLACE FUNCTION is_llm_allowed_for_session(p_session_id uuid)
RETURNS boolean AS $$
DECLARE
  v_state text;
BEGIN
  SELECT entry_monitor_state INTO v_state
  FROM goal_sessions
  WHERE id = p_session_id;

  RETURN v_state IN ('DISCOVERY_SCANNING', 'ABANDONED_RESCAN_REQUESTED') OR v_state IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to record LLM call (for tracking/debugging)
CREATE OR REPLACE FUNCTION record_llm_call(p_session_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE goal_sessions
  SET last_llm_call_at = now()
  WHERE id = p_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION transition_entry_monitor_state TO authenticated;
GRANT EXECUTE ON FUNCTION get_entry_monitor_state TO authenticated;
GRANT EXECUTE ON FUNCTION is_llm_allowed_for_session TO authenticated;
GRANT EXECUTE ON FUNCTION record_llm_call TO authenticated;

-- Add realtime support for entry monitor state changes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND tablename = 'entry_monitor_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE entry_monitor_logs;
  END IF;
END $$;
