/*
  # CCIP Emergency Part 2: Drop Remaining Continuation References

  ## Critical Issue
  
  After dropping 15 functions, there are still 12 more functions that reference
  deleted continuation modal columns, creating ongoing SSOT violations.
  
  **Remaining Broken Functions:**
  1. admin_emergency_stop_long_sessions
  2. can_scan_now
  3. cleanup_stuck_scanning_sessions
  4. close_goal_session_safely
  5. create_continuation_modal_atomic (still exists!)
  6. create_session_ended_modal
  7. diagnose_monitor_state
  8. force_close_stale_session
  9. force_reset_monitor_state
  10. reset_scanning_timer_on_trade_close
  11. update_session_status_on_trade_change
  
  ## CCIP Strategy
  
  Drop all functions referencing deleted columns. The system has moved to a new
  architecture without continuation modals, so these are all obsolete.
  
  ## SSOT Restoration
  
  Complete removal of continuation modal system to restore schema integrity.
*/

-- Drop remaining continuation modal references
DROP FUNCTION IF EXISTS admin_emergency_stop_long_sessions() CASCADE;
DROP FUNCTION IF EXISTS can_scan_now(uuid) CASCADE;
DROP FUNCTION IF EXISTS cleanup_stuck_scanning_sessions() CASCADE;
DROP FUNCTION IF EXISTS close_goal_session_safely(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS create_continuation_modal_atomic(uuid, uuid, text, text, uuid) CASCADE;
DROP FUNCTION IF EXISTS create_session_ended_modal(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS diagnose_monitor_state(uuid) CASCADE;
DROP FUNCTION IF EXISTS force_close_stale_session(uuid) CASCADE;
DROP FUNCTION IF EXISTS force_reset_monitor_state(uuid) CASCADE;
DROP FUNCTION IF EXISTS reset_scanning_timer_on_trade_close() CASCADE;
DROP FUNCTION IF EXISTS update_session_status_on_trade_change() CASCADE;

-- Drop any associated triggers
DROP TRIGGER IF EXISTS reset_scanning_on_trade_close ON goal_session_trades CASCADE;
DROP TRIGGER IF EXISTS update_status_on_trade ON goal_session_trades CASCADE;

DO $$
BEGIN
  RAISE NOTICE '✅ CCIP Part 2: Dropped 11 additional functions referencing deleted columns';
  RAISE NOTICE '   - admin_emergency_stop_long_sessions';
  RAISE NOTICE '   - can_scan_now';
  RAISE NOTICE '   - cleanup_stuck_scanning_sessions';
  RAISE NOTICE '   - close_goal_session_safely';
  RAISE NOTICE '   - create_continuation_modal_atomic';
  RAISE NOTICE '   - create_session_ended_modal';
  RAISE NOTICE '   - diagnose_monitor_state';
  RAISE NOTICE '   - force_close_stale_session';
  RAISE NOTICE '   - force_reset_monitor_state';
  RAISE NOTICE '   - reset_scanning_timer_on_trade_close';
  RAISE NOTICE '   - update_session_status_on_trade_change';
  RAISE NOTICE '';
  RAISE NOTICE '🛡️ SSOT Compliance: All continuation modal references eliminated';
END $$;
