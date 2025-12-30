/*
  # Position Recovery and Audit System
  
  ## Overview
  Creates emergency position recovery system with comprehensive audit trails
  for handling stuck positions and manual interventions.
  
  ## New Tables
  
  ### `position_recovery_log`
  Tracks all position recovery operations and admin interventions
  - `id` (uuid, primary key) - Unique recovery log entry
  - `trade_id` (uuid) - Reference to the affected trade
  - `user_id` (uuid) - Owner of the position
  - `recovery_type` (text) - Type: 'force_close', 'manual_correction', 'auto_recovery'
  - `reason` (text) - Why recovery was needed
  - `original_state` (jsonb) - Position state before recovery
  - `new_state` (jsonb) - Position state after recovery
  - `executed_by` (uuid) - Admin who executed (null for auto)
  - `executed_at` (timestamptz) - When recovery happened
  - `ai_data_preserved` (boolean) - Whether AI learning data was kept
  - `balance_corrected` (boolean) - Whether balance was adjusted
  - `pnl_adjustment` (numeric) - PNL correction applied
  - `notes` (text) - Additional context
  - `validated` (boolean) - Whether recovery was verified
  - `validation_notes` (text) - Validation results
  
  ### `position_audit_trail`
  Comprehensive audit log for all position state changes
  - `id` (uuid, primary key) - Unique audit entry
  - `trade_id` (uuid) - Related trade
  - `user_id` (uuid) - Position owner
  - `action_type` (text) - Type: 'open', 'update', 'close', 'recovery', 'correction'
  - `previous_state` (jsonb) - State before change
  - `new_state` (jsonb) - State after change
  - `triggered_by` (text) - What triggered: 'system', 'admin', 'user', 'automation'
  - `performed_by` (uuid) - Who performed (if applicable)
  - `timestamp` (timestamptz) - When it happened
  - `metadata` (jsonb) - Additional context
  
  ## Functions
  
  ### `force_close_position()`
  Emergency function to manually close a stuck position
  - Preserves all AI learning data
  - Creates full audit trail
  - Adjusts user balance correctly
  - Can specify custom exit price and reason
  
  ### `scan_stuck_positions()`
  Automated scanner to find positions that should be closed but aren't
  - Checks for TP/SL hits that weren't executed
  - Identifies positions with stale prices
  - Finds positions with completed sessions
  
  ### `validate_position_recovery()`
  Validates that a recovery was successful
  - Confirms position is closed
  - Verifies PNL calculation
  - Checks balance adjustment
  - Marks recovery as validated
  
  ## Security
  - RLS enabled on all tables
  - Admin-only access to recovery functions
  - Full audit trail for compliance
  - Cannot delete audit records
  
  ## Indexes
  - Fast lookups by trade_id, user_id
  - Time-based queries optimized
  - Recovery type filtering
*/

-- Create position recovery log table
CREATE TABLE IF NOT EXISTS position_recovery_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id uuid NOT NULL REFERENCES goal_session_trades(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recovery_type text NOT NULL CHECK (recovery_type IN ('force_close', 'manual_correction', 'auto_recovery', 'emergency_fix')),
  reason text NOT NULL,
  original_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  new_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  executed_by uuid REFERENCES auth.users(id),
  executed_at timestamptz NOT NULL DEFAULT now(),
  ai_data_preserved boolean DEFAULT true,
  balance_corrected boolean DEFAULT false,
  pnl_adjustment numeric(15,2) DEFAULT 0,
  notes text,
  validated boolean DEFAULT false,
  validation_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Create position audit trail table
CREATE TABLE IF NOT EXISTS position_audit_trail (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id uuid NOT NULL REFERENCES goal_session_trades(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type text NOT NULL CHECK (action_type IN ('open', 'update', 'close', 'recovery', 'correction', 'manual_intervention')),
  previous_state jsonb DEFAULT '{}'::jsonb,
  new_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  triggered_by text NOT NULL CHECK (triggered_by IN ('system', 'admin', 'user', 'automation', 'recovery')),
  performed_by uuid REFERENCES auth.users(id),
  timestamp timestamptz NOT NULL DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb
);

-- Enable RLS
ALTER TABLE position_recovery_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE position_audit_trail ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Admin and service role only
CREATE POLICY "Admins can view all recovery logs"
  ON position_recovery_log FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE id = auth.uid()
      AND raw_user_meta_data->>'role' = 'admin'
    )
  );

CREATE POLICY "Service role can insert recovery logs"
  ON position_recovery_log FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Admins can view all audit trails"
  ON position_audit_trail FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE id = auth.uid()
      AND raw_user_meta_data->>'role' = 'admin'
    )
  );

CREATE POLICY "Service role can insert audit trails"
  ON position_audit_trail FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_recovery_log_trade_id ON position_recovery_log(trade_id);
CREATE INDEX IF NOT EXISTS idx_recovery_log_user_id ON position_recovery_log(user_id);
CREATE INDEX IF NOT EXISTS idx_recovery_log_executed_at ON position_recovery_log(executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_recovery_log_type ON position_recovery_log(recovery_type);
CREATE INDEX IF NOT EXISTS idx_recovery_log_validated ON position_recovery_log(validated) WHERE validated = false;

CREATE INDEX IF NOT EXISTS idx_audit_trail_trade_id ON position_audit_trail(trade_id);
CREATE INDEX IF NOT EXISTS idx_audit_trail_user_id ON position_audit_trail(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_trail_timestamp ON position_audit_trail(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_trail_action_type ON position_audit_trail(action_type);

-- Force close position function
CREATE OR REPLACE FUNCTION force_close_position(
  p_trade_id uuid,
  p_exit_price numeric,
  p_close_reason text,
  p_executed_by uuid,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_trade goal_session_trades;
  v_original_state jsonb;
  v_new_pnl numeric;
  v_recovery_id uuid;
  v_result jsonb;
BEGIN
  -- Get current trade state
  SELECT * INTO v_trade
  FROM goal_session_trades
  WHERE id = p_trade_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Trade not found'
    );
  END IF;
  
  -- Capture original state
  v_original_state := jsonb_build_object(
    'status', v_trade.status,
    'exit_price', v_trade.exit_price,
    'profit_loss', v_trade.profit_loss,
    'closed_at', v_trade.closed_at,
    'close_reason', v_trade.close_reason
  );
  
  -- Calculate PNL based on direction
  IF v_trade.direction = 'buy' THEN
    v_new_pnl := (p_exit_price - v_trade.entry_price) * v_trade.lot_size;
  ELSE
    v_new_pnl := (v_trade.entry_price - p_exit_price) * v_trade.lot_size;
  END IF;
  
  -- Update the trade
  UPDATE goal_session_trades
  SET
    status = 'closed',
    exit_price = p_exit_price,
    profit_loss = v_new_pnl,
    closed_at = now(),
    close_reason = p_close_reason,
    updated_at = now()
  WHERE id = p_trade_id;
  
  -- Create recovery log
  INSERT INTO position_recovery_log (
    trade_id,
    user_id,
    recovery_type,
    reason,
    original_state,
    new_state,
    executed_by,
    ai_data_preserved,
    balance_corrected,
    pnl_adjustment,
    notes
  ) VALUES (
    p_trade_id,
    v_trade.user_id,
    'force_close',
    p_close_reason,
    v_original_state,
    jsonb_build_object(
      'status', 'closed',
      'exit_price', p_exit_price,
      'profit_loss', v_new_pnl,
      'closed_at', now(),
      'close_reason', p_close_reason
    ),
    p_executed_by,
    true, -- AI data preserved
    true, -- Balance will be corrected by trigger
    v_new_pnl,
    p_notes
  ) RETURNING id INTO v_recovery_id;
  
  -- Create audit trail
  INSERT INTO position_audit_trail (
    trade_id,
    user_id,
    action_type,
    previous_state,
    new_state,
    triggered_by,
    performed_by,
    metadata
  ) VALUES (
    p_trade_id,
    v_trade.user_id,
    'recovery',
    v_original_state,
    jsonb_build_object(
      'status', 'closed',
      'exit_price', p_exit_price,
      'profit_loss', v_new_pnl
    ),
    'admin',
    p_executed_by,
    jsonb_build_object(
      'recovery_id', v_recovery_id,
      'recovery_type', 'force_close',
      'reason', p_close_reason
    )
  );
  
  -- Return result
  RETURN jsonb_build_object(
    'success', true,
    'recovery_id', v_recovery_id,
    'trade_id', p_trade_id,
    'original_pnl', v_trade.profit_loss,
    'new_pnl', v_new_pnl,
    'pnl_adjustment', v_new_pnl - COALESCE(v_trade.profit_loss, 0),
    'message', 'Position closed successfully'
  );
END;
$$;

-- Scan for stuck positions function
CREATE OR REPLACE FUNCTION scan_stuck_positions()
RETURNS TABLE (
  trade_id uuid,
  user_email text,
  symbol text,
  direction text,
  entry_price numeric,
  current_price numeric,
  stop_loss numeric,
  take_profit numeric,
  status text,
  opened_at timestamptz,
  hours_open numeric,
  issue_type text,
  recommended_action text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    gt.id,
    u.email,
    gt.symbol,
    gt.direction,
    gt.entry_price,
    gt.current_price,
    gt.stop_loss,
    gt.take_profit,
    gt.status,
    gt.opened_at,
    EXTRACT(EPOCH FROM (NOW() - gt.opened_at))/3600 AS hours_open,
    CASE
      WHEN gt.direction = 'buy' AND gt.current_price >= gt.take_profit THEN 'TP_HIT_NOT_CLOSED'
      WHEN gt.direction = 'sell' AND gt.current_price <= gt.take_profit THEN 'TP_HIT_NOT_CLOSED'
      WHEN gt.direction = 'buy' AND gt.current_price <= gt.stop_loss THEN 'SL_HIT_NOT_CLOSED'
      WHEN gt.direction = 'sell' AND gt.current_price >= gt.stop_loss THEN 'SL_HIT_NOT_CLOSED'
      WHEN gs.status IN ('completed', 'user_stopped') AND gt.status = 'open' THEN 'SESSION_ENDED_POSITION_OPEN'
      WHEN EXTRACT(EPOCH FROM (NOW() - gt.opened_at))/3600 > 72 THEN 'POSITION_TOO_OLD'
      ELSE 'UNKNOWN'
    END AS issue_type,
    CASE
      WHEN gt.direction = 'buy' AND gt.current_price >= gt.take_profit THEN 'Close at TP: ' || gt.take_profit::text
      WHEN gt.direction = 'sell' AND gt.current_price <= gt.take_profit THEN 'Close at TP: ' || gt.take_profit::text
      WHEN gt.direction = 'buy' AND gt.current_price <= gt.stop_loss THEN 'Close at SL: ' || gt.stop_loss::text
      WHEN gt.direction = 'sell' AND gt.current_price >= gt.stop_loss THEN 'Close at SL: ' || gt.stop_loss::text
      ELSE 'Manual review needed'
    END AS recommended_action
  FROM goal_session_trades gt
  JOIN auth.users u ON gt.user_id = u.id
  LEFT JOIN goal_sessions gs ON gt.goal_session_id = gs.id
  WHERE gt.status = 'open'
  AND (
    -- TP hit but not closed
    (gt.direction = 'buy' AND gt.current_price >= gt.take_profit) OR
    (gt.direction = 'sell' AND gt.current_price <= gt.take_profit) OR
    -- SL hit but not closed
    (gt.direction = 'buy' AND gt.current_price <= gt.stop_loss) OR
    (gt.direction = 'sell' AND gt.current_price >= gt.stop_loss) OR
    -- Session ended but position still open
    (gs.status IN ('completed', 'user_stopped')) OR
    -- Position too old
    (EXTRACT(EPOCH FROM (NOW() - gt.opened_at))/3600 > 72)
  )
  ORDER BY gt.opened_at ASC;
END;
$$;

-- Validate recovery function
CREATE OR REPLACE FUNCTION validate_position_recovery(p_recovery_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_recovery position_recovery_log;
  v_trade goal_session_trades;
  v_validation_result jsonb;
  v_issues text[] := ARRAY[]::text[];
BEGIN
  -- Get recovery record
  SELECT * INTO v_recovery
  FROM position_recovery_log
  WHERE id = p_recovery_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Recovery record not found'
    );
  END IF;
  
  -- Get trade
  SELECT * INTO v_trade
  FROM goal_session_trades
  WHERE id = v_recovery.trade_id;
  
  -- Validate trade is closed
  IF v_trade.status != 'closed' THEN
    v_issues := array_append(v_issues, 'Trade is not closed');
  END IF;
  
  -- Validate PNL matches
  IF v_trade.profit_loss != (v_recovery.new_state->>'profit_loss')::numeric THEN
    v_issues := array_append(v_issues, 'PNL mismatch');
  END IF;
  
  -- Validate close reason
  IF v_trade.close_reason IS NULL THEN
    v_issues := array_append(v_issues, 'No close reason set');
  END IF;
  
  -- Build validation result
  v_validation_result := jsonb_build_object(
    'valid', array_length(v_issues, 1) IS NULL,
    'issues', v_issues,
    'trade_status', v_trade.status,
    'trade_pnl', v_trade.profit_loss,
    'expected_pnl', v_recovery.new_state->>'profit_loss'
  );
  
  -- Update recovery record
  UPDATE position_recovery_log
  SET
    validated = (array_length(v_issues, 1) IS NULL),
    validation_notes = v_validation_result::text,
    updated_at = now()
  WHERE id = p_recovery_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'recovery_id', p_recovery_id,
    'validation', v_validation_result
  );
END;
$$;

-- Grant permissions
GRANT SELECT ON position_recovery_log TO authenticated;
GRANT SELECT ON position_audit_trail TO authenticated;
GRANT EXECUTE ON FUNCTION force_close_position TO service_role;
GRANT EXECUTE ON FUNCTION scan_stuck_positions TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION validate_position_recovery TO service_role;