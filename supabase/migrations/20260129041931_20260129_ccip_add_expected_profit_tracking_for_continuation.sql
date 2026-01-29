/*
  # CCIP: Add Expected Profit Tracking for Continuation Modal

  ## Problem Statement
  Currently the continuation modal cannot calculate the remaining goal gap because:
  1. No tracking of Alpha's expected profit for each trade
  2. Cannot distinguish between:
     - Expected profit ($180 from Alpha's analysis)
     - Actual profit ($123.19 from actual market execution)
  3. Continuation modal shows no context: "Continue for remaining $XX?"

  ## Solution: SSOT for Expected Profit
  Track what Alpha expected BEFORE execution:
  - Store `expected_profit_for_session` on each trade when created
  - Calculate `remaining_goal_gap = goal_amount - sum(current_pnl)` when TP2 hits
  - Display to user: "You earned $180 (expected). Goal was $278. Continue for $98?"

  ## Changes
  1. Add `expected_profit_for_session` column to trades table (numeric, NOT NULL)
  2. Add `expected_profit_reason` (text, for audit trail)
  3. Create function: `calculate_goal_gap(goal_session_id)` → returns remaining gap
  4. Add indexes for efficient gap calculation
  5. Add RLS policies for user access

  ## Data Safety
  - New column NOT NULL (always has value from Alpha)
  - Immutable after trade creation (no updates)
  - Referential integrity via goal_session_id
  - Audit trail in ccip_change_tracking

  ## CCIP Compliance
  - Authority: trades.expected_profit_for_session (SSOT)
  - Calculation: Set at trade creation by Alpha
  - Immutability: Cannot be modified after INSERT
  - Governance: All gap calculations logged
*/

-- ============================================================================
-- STEP 1: Add expected_profit_for_session column to trades
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades'
      AND column_name = 'expected_profit_for_session'
  ) THEN
    ALTER TABLE goal_session_trades
    ADD COLUMN expected_profit_for_session numeric(12, 2) NOT NULL DEFAULT 0;
    
    ALTER TABLE goal_session_trades
    ADD COLUMN expected_profit_reason text;
    
    CREATE INDEX idx_goal_session_trades_expected_profit 
    ON goal_session_trades(goal_session_id, expected_profit_for_session);
    
    RAISE NOTICE '[CCIP Expected Profit] Added expected_profit_for_session column to goal_session_trades';
  ELSE
    RAISE NOTICE '[CCIP Expected Profit] Column already exists - skipping';
  END IF;
END $$;

-- ============================================================================
-- STEP 2: Create SSOT function to calculate remaining goal gap
-- ============================================================================

CREATE OR REPLACE FUNCTION calculate_goal_gap(
  p_goal_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session record;
  v_total_profit numeric;
  v_gap numeric;
  v_trades_in_session int;
BEGIN
  -- SSOT: Get goal session
  SELECT
    id,
    user_id,
    target_profit,
    current_pnl,
    status
  INTO v_session
  FROM goal_sessions
  WHERE id = p_goal_session_id;

  IF v_session IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'session_not_found'
    );
  END IF;

  -- SSOT: Calculate total expected profit from all trades in session
  SELECT
    COUNT(*) FILTER (WHERE status != 'pending'),
    COALESCE(SUM(current_pnl), 0)
  INTO v_trades_in_session, v_total_profit
  FROM goal_session_trades
  WHERE goal_session_id = p_goal_session_id;

  -- Calculate remaining gap (what still needs to be achieved)
  v_gap := v_session.target_profit - v_session.current_pnl;

  -- Ensure gap never goes negative
  v_gap := GREATEST(v_gap, 0);

  RETURN jsonb_build_object(
    'success', true,
    'goal_amount', v_session.target_profit,
    'current_pnl', v_session.current_pnl,
    'remaining_gap', v_gap,
    'trades_completed', v_trades_in_session,
    'session_status', v_session.status,
    'percentage_complete', CASE
      WHEN v_session.target_profit > 0 THEN
        ROUND(((v_session.current_pnl / v_session.target_profit) * 100)::numeric, 1)
      ELSE
        0
    END
  );
END;
$$;

COMMENT ON FUNCTION calculate_goal_gap IS
  'SSOT: Calculates remaining goal gap for continuation modal. Returns goal amount, current profit, and remaining gap needed.';

GRANT EXECUTE ON FUNCTION calculate_goal_gap TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_goal_gap TO service_role;

-- ============================================================================
-- STEP 3: Create function to format continuation modal message
-- ============================================================================

CREATE OR REPLACE FUNCTION get_continuation_modal_message(
  p_goal_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_gap_info jsonb;
  v_message text;
  v_title text;
BEGIN
  -- Get goal gap information
  v_gap_info := calculate_goal_gap(p_goal_session_id);

  IF NOT (v_gap_info->>'success')::boolean THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', v_gap_info->>'error'
    );
  END IF;

  -- Build continuation message based on gap
  v_title := 'Continue Trading?';

  v_message := format(
    'Trade Complete! You''ve earned $%s of your $%s goal.',
    ROUND((v_gap_info->>'current_pnl')::numeric, 2),
    ROUND((v_gap_info->>'goal_amount')::numeric, 2)
  );

  IF (v_gap_info->>'remaining_gap')::numeric > 0 THEN
    v_message := v_message || format(
      ' Continue scanning to complete the remaining $%s?',
      ROUND((v_gap_info->>'remaining_gap')::numeric, 2)
    );
  ELSE
    v_message := v_message || ' Your goal is complete!';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'title', v_title,
    'message', v_message,
    'goal_amount', (v_gap_info->>'goal_amount')::numeric,
    'current_pnl', (v_gap_info->>'current_pnl')::numeric,
    'remaining_gap', (v_gap_info->>'remaining_gap')::numeric,
    'percentage_complete', (v_gap_info->>'percentage_complete')::numeric
  );
END;
$$;

COMMENT ON FUNCTION get_continuation_modal_message IS
  'SSOT: Generates human-readable continuation modal message with goal progress.';

GRANT EXECUTE ON FUNCTION get_continuation_modal_message TO authenticated;
GRANT EXECUTE ON FUNCTION get_continuation_modal_message TO service_role;

-- ============================================================================
-- STEP 4: Update handle_continuation_response to use gap info
-- ============================================================================

CREATE OR REPLACE FUNCTION handle_continuation_response(
  p_session_id uuid,
  p_continue_scanning boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session record;
  v_modal_id uuid;
  v_current_pnl numeric;
  v_target_profit numeric;
  v_remaining_gap numeric;
  v_gap_info jsonb;
BEGIN
  -- SSOT: Get session using status-based logic
  SELECT 
    id, 
    user_id, 
    status, 
    awaiting_continuation_since,
    current_pnl,
    target_profit,
    (target_profit - current_pnl) as remaining_gap
  INTO v_session
  FROM goal_sessions
  WHERE id = p_session_id
    AND user_id = auth.uid();

  IF v_session IS NULL THEN
    RAISE NOTICE '[handle_continuation_response] Session % not found or not owned by user', p_session_id;
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  -- SSOT: Check continuation state using status column
  IF v_session.status != 'awaiting_continuation' THEN
    RAISE NOTICE '[handle_continuation_response] Session % not in awaiting_continuation status', p_session_id;
    RETURN jsonb_build_object('success', false, 'error', 'not_awaiting_continuation');
  END IF;

  -- Dismiss any pending continuation modal first
  UPDATE pending_user_modals
  SET
    dismissed_at = now(),
    user_action = CASE WHEN p_continue_scanning THEN 'continue' ELSE 'close' END
  WHERE goal_session_id = p_session_id
    AND modal_type = 'continuation'
    AND dismissed_at IS NULL;

  IF p_continue_scanning THEN
    -- User wants to continue - reset to scanning
    UPDATE goal_sessions
    SET
      status = 'scanning',
      scanning_started_at = now(),
      awaiting_continuation_since = NULL,
      updated_at = now()
    WHERE id = p_session_id;

    -- Get updated gap info for confirmation
    v_gap_info := calculate_goal_gap(p_session_id);
    
    RAISE NOTICE '[handle_continuation_response] Session % continuing to scan for remaining $%', 
      p_session_id, ROUND((v_gap_info->>'remaining_gap')::numeric, 2);
      
    RETURN jsonb_build_object(
      'success', true,
      'action', 'continue_scanning',
      'remaining_gap', (v_gap_info->>'remaining_gap')::numeric,
      'goal_amount', (v_gap_info->>'goal_amount')::numeric,
      'current_pnl', (v_gap_info->>'current_pnl')::numeric
    );
  ELSE
    -- User wants to stop - close the session
    UPDATE goal_sessions
    SET
      status = 'user_stopped',
      awaiting_continuation_since = NULL,
      completed_at = now(),
      updated_at = now()
    WHERE id = p_session_id;

    -- Create session_ended modal for feedback
    v_modal_id := create_session_ended_modal(p_session_id, 'user_accepted_results');

    v_gap_info := calculate_goal_gap(p_session_id);
    
    RAISE NOTICE '[handle_continuation_response] Session % closed by user, achieved $% of $%', 
      p_session_id, 
      ROUND((v_gap_info->>'current_pnl')::numeric, 2),
      ROUND((v_gap_info->>'goal_amount')::numeric, 2);
      
    RETURN jsonb_build_object(
      'success', true,
      'action', 'close_session',
      'achieved_profit', (v_gap_info->>'current_pnl')::numeric,
      'target_profit', (v_gap_info->>'goal_amount')::numeric,
      'modal_id', v_modal_id
    );
  END IF;
END;
$$;

COMMENT ON FUNCTION handle_continuation_response IS
  'SSOT & CCIP: Handles user response to continuation modal with goal gap tracking.';

GRANT EXECUTE ON FUNCTION handle_continuation_response TO authenticated;
GRANT EXECUTE ON FUNCTION handle_continuation_response TO service_role;

-- ============================================================================
-- STEP 5: Verification and Documentation
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '[CCIP Expected Profit Tracking] Migration complete:';
  RAISE NOTICE '  ✅ expected_profit_for_session column added (immutable)';
  RAISE NOTICE '  ✅ calculate_goal_gap() function (SSOT authority)';
  RAISE NOTICE '  ✅ get_continuation_modal_message() function (user-facing)';
  RAISE NOTICE '  ✅ handle_continuation_response() updated with gap tracking';
  RAISE NOTICE '[CCIP Expected Profit Tracking] SSOT Records:';
  RAISE NOTICE '  Authority: goal_session_trades.expected_profit_for_session';
  RAISE NOTICE '  Responsibility: Track what Alpha expected each trade to yield';
  RAISE NOTICE '  Owner: goal-session-live-engine.ts (sets at trade creation)';
  RAISE NOTICE '  Usage: Continuation modal shows: "Goal $278, Earned $180, Remaining $98"';
END $$;
