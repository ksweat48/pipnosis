/*
  # Create Entry Edge Loss Modal System

  1. New Tables
    - `entry_edge_loss_modals`
      - Tracks edge loss modal state for entry intents
      - Records user responses and timeouts
      - Similar to continuation modal tracking

  2. New Columns on `entry_intents`
    - `edge_loss_modal_triggered_at` - When modal was shown
    - `edge_loss_modal_response` - User's choice ('continue' | 'close' | null)
    - `edge_loss_modal_response_at` - When user responded

  3. New Functions
    - `get_entry_time_thresholds` - SSOT for time windows by trade style
    - `trigger_entry_edge_loss_modal` - Create modal when max wait exceeded
    - `handle_entry_edge_loss_response` - Process user's decision
    - `check_edge_loss_modal_timeout` - Auto-close after 1 minute

  4. Security
    - RLS policies for authenticated users
    - Service role access for autonomous functions
*/

-- Create edge loss modal tracking table
CREATE TABLE IF NOT EXISTS entry_edge_loss_modals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  intent_id uuid NOT NULL,
  session_id uuid REFERENCES goal_sessions(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  timeout_at timestamptz NOT NULL DEFAULT (now() + interval '1 minute'),
  responded_at timestamptz,
  response_action text CHECK (response_action IN ('continue', 'close')),
  auto_closed boolean DEFAULT false
);

-- Add columns to entry_intents
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'edge_loss_modal_triggered_at'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN edge_loss_modal_triggered_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'edge_loss_modal_response'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN edge_loss_modal_response text CHECK (edge_loss_modal_response IN ('continue', 'close'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'edge_loss_modal_response_at'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN edge_loss_modal_response_at timestamptz;
  END IF;
END $$;

-- Enable RLS
ALTER TABLE entry_edge_loss_modals ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own edge loss modals"
  ON entry_edge_loss_modals FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert edge loss modals"
  ON entry_edge_loss_modals FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Users can update own modal responses"
  ON entry_edge_loss_modals FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_edge_loss_modals_user_id ON entry_edge_loss_modals(user_id);
CREATE INDEX IF NOT EXISTS idx_edge_loss_modals_intent_id ON entry_edge_loss_modals(intent_id);
CREATE INDEX IF NOT EXISTS idx_edge_loss_modals_timeout ON entry_edge_loss_modals(timeout_at) WHERE responded_at IS NULL;

-- Function: Get entry time thresholds by trade style (SSOT)
CREATE OR REPLACE FUNCTION get_entry_time_thresholds(p_trade_style text)
RETURNS TABLE (
  optimal_wait_min integer,
  acceptable_wait_min integer,
  max_wait_min integer,
  eqs_phase2_min integer,
  eqs_phase3_min integer,
  eqs_threshold_phase1 integer,
  eqs_threshold_phase2 integer,
  eqs_threshold_phase3 integer,
  zone_tolerance_phase1 integer,
  zone_tolerance_phase2 integer,
  zone_tolerance_phase3 integer
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    CASE p_trade_style
      WHEN 'SCALP' THEN 3
      WHEN 'MICRO_INTRADAY' THEN 15
      WHEN 'INTRADAY' THEN 45
      ELSE 15
    END AS optimal_wait_min,
    CASE p_trade_style
      WHEN 'SCALP' THEN 7
      WHEN 'MICRO_INTRADAY' THEN 30
      WHEN 'INTRADAY' THEN 90
      ELSE 30
    END AS acceptable_wait_min,
    CASE p_trade_style
      WHEN 'SCALP' THEN 10
      WHEN 'MICRO_INTRADAY' THEN 45
      WHEN 'INTRADAY' THEN 120
      ELSE 45
    END AS max_wait_min,
    CASE p_trade_style
      WHEN 'SCALP' THEN 3
      WHEN 'MICRO_INTRADAY' THEN 15
      WHEN 'INTRADAY' THEN 45
      ELSE 15
    END AS eqs_phase2_min,
    CASE p_trade_style
      WHEN 'SCALP' THEN 7
      WHEN 'MICRO_INTRADAY' THEN 30
      WHEN 'INTRADAY' THEN 90
      ELSE 30
    END AS eqs_phase3_min,
    CASE p_trade_style
      WHEN 'SCALP' THEN 70
      WHEN 'MICRO_INTRADAY' THEN 65
      WHEN 'INTRADAY' THEN 60
      ELSE 65
    END AS eqs_threshold_phase1,
    CASE p_trade_style
      WHEN 'SCALP' THEN 60
      WHEN 'MICRO_INTRADAY' THEN 55
      WHEN 'INTRADAY' THEN 50
      ELSE 55
    END AS eqs_threshold_phase2,
    CASE p_trade_style
      WHEN 'SCALP' THEN 50
      WHEN 'MICRO_INTRADAY' THEN 45
      WHEN 'INTRADAY' THEN 40
      ELSE 45
    END AS eqs_threshold_phase3,
    CASE p_trade_style
      WHEN 'SCALP' THEN 0
      WHEN 'MICRO_INTRADAY' THEN 0
      WHEN 'INTRADAY' THEN 0
      ELSE 0
    END AS zone_tolerance_phase1,
    CASE p_trade_style
      WHEN 'SCALP' THEN 20
      WHEN 'MICRO_INTRADAY' THEN 30
      WHEN 'INTRADAY' THEN 40
      ELSE 30
    END AS zone_tolerance_phase2,
    CASE p_trade_style
      WHEN 'SCALP' THEN 50
      WHEN 'MICRO_INTRADAY' THEN 60
      WHEN 'INTRADAY' THEN 70
      ELSE 60
    END AS zone_tolerance_phase3;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Trigger edge loss modal
CREATE OR REPLACE FUNCTION trigger_entry_edge_loss_modal(
  p_intent_id uuid,
  p_user_id uuid,
  p_session_id uuid
)
RETURNS uuid AS $$
DECLARE
  v_modal_id uuid;
  v_intent_data jsonb;
BEGIN
  -- Get intent details
  SELECT jsonb_build_object(
    'symbol', symbol,
    'direction', direction,
    'style', style,
    'entry_zone_min', entry_zone_min,
    'entry_zone_max', entry_zone_max,
    'created_at', created_at,
    'timeout_minutes', timeout_minutes
  ) INTO v_intent_data
  FROM entry_intents
  WHERE id = p_intent_id;

  -- Create edge loss modal
  INSERT INTO entry_edge_loss_modals (
    user_id,
    intent_id,
    session_id
  ) VALUES (
    p_user_id,
    p_intent_id,
    p_session_id
  ) RETURNING id INTO v_modal_id;

  -- Create pending modal for UI
  INSERT INTO pending_user_modals (
    user_id,
    goal_session_id,
    modal_type,
    modal_data
  ) VALUES (
    p_user_id,
    p_session_id,
    'entry_edge_loss',
    v_intent_data || jsonb_build_object('modal_id', v_modal_id)
  );

  -- Update intent to mark modal triggered
  UPDATE entry_intents
  SET edge_loss_modal_triggered_at = now()
  WHERE id = p_intent_id;

  RETURN v_modal_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Handle edge loss response
CREATE OR REPLACE FUNCTION handle_entry_edge_loss_response(
  p_modal_id uuid,
  p_response text
)
RETURNS jsonb AS $$
DECLARE
  v_intent_id uuid;
  v_session_id uuid;
  v_user_id uuid;
BEGIN
  -- Validate response
  IF p_response NOT IN ('continue', 'close') THEN
    RAISE EXCEPTION 'Invalid response: must be continue or close';
  END IF;

  -- Get modal details
  SELECT intent_id, session_id, user_id
  INTO v_intent_id, v_session_id, v_user_id
  FROM entry_edge_loss_modals
  WHERE id = p_modal_id;

  IF v_intent_id IS NULL THEN
    RAISE EXCEPTION 'Edge loss modal not found';
  END IF;

  -- Update modal
  UPDATE entry_edge_loss_modals
  SET 
    responded_at = now(),
    response_action = p_response
  WHERE id = p_modal_id;

  -- Update intent
  UPDATE entry_intents
  SET 
    edge_loss_modal_response = p_response,
    edge_loss_modal_response_at = now()
  WHERE id = v_intent_id;

  -- Handle response action
  IF p_response = 'close' THEN
    -- Close session gracefully
    UPDATE goal_sessions
    SET 
      status = 'completed',
      completed_at = now()
    WHERE id = v_session_id AND status = 'active';

    -- Cancel any pending intents
    UPDATE entry_intents
    SET 
      status = 'canceled',
      canceled_at = now(),
      canceled_reason = 'User chose to close session due to edge decay'
    WHERE goal_session_id = v_session_id AND status IN ('pending', 'monitoring');
  ELSE
    -- Continue: Reset intent for fresh monitoring
    UPDATE entry_intents
    SET 
      edge_loss_modal_triggered_at = NULL,
      edge_loss_modal_response = NULL,
      edge_loss_modal_response_at = NULL,
      created_at = now()  -- Reset timer
    WHERE id = v_intent_id;
  END IF;

  -- Dismiss pending modal
  UPDATE pending_user_modals
  SET 
    dismissed_at = now(),
    user_action = p_response
  WHERE user_id = v_user_id
    AND modal_type = 'entry_edge_loss'
    AND dismissed_at IS NULL;

  RETURN jsonb_build_object(
    'success', true,
    'action', p_response,
    'intent_id', v_intent_id,
    'session_id', v_session_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Check for timed out edge loss modals (for autonomous monitor)
CREATE OR REPLACE FUNCTION check_edge_loss_modal_timeout()
RETURNS TABLE (
  modal_id uuid,
  intent_id uuid,
  session_id uuid,
  user_id uuid
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    elm.id,
    elm.intent_id,
    elm.session_id,
    elm.user_id
  FROM entry_edge_loss_modals elm
  WHERE elm.responded_at IS NULL
    AND elm.timeout_at < now()
    AND elm.auto_closed = false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Auto-close timed out modals
CREATE OR REPLACE FUNCTION auto_close_timed_out_edge_loss_modals()
RETURNS integer AS $$
DECLARE
  v_closed_count integer := 0;
  v_modal record;
BEGIN
  FOR v_modal IN 
    SELECT * FROM check_edge_loss_modal_timeout()
  LOOP
    -- Mark modal as auto-closed
    UPDATE entry_edge_loss_modals
    SET 
      auto_closed = true,
      responded_at = now(),
      response_action = 'close'
    WHERE id = v_modal.modal_id;

    -- Close session
    UPDATE goal_sessions
    SET 
      status = 'completed',
      completed_at = now()
    WHERE id = v_modal.session_id AND status = 'active';

    -- Cancel intent
    UPDATE entry_intents
    SET 
      status = 'timeout',
      canceled_at = now(),
      canceled_reason = 'Edge loss modal timed out after 1 minute'
    WHERE id = v_modal.intent_id;

    v_closed_count := v_closed_count + 1;
  END LOOP;

  RETURN v_closed_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_entry_time_thresholds TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION trigger_entry_edge_loss_modal TO service_role;
GRANT EXECUTE ON FUNCTION handle_entry_edge_loss_response TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION check_edge_loss_modal_timeout TO service_role;
GRANT EXECUTE ON FUNCTION auto_close_timed_out_edge_loss_modals TO service_role;
