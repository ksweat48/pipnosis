/*
  # Grant Service Role Access to Timer Functions

  ## Problem
  - Autonomous monitor runs with service role but can't call timer RPC functions
  - Timer functions only granted to authenticated users
  - Server-side sessions bypass 15-minute protection

  ## Solution
  - Grant execute permissions to service_role for all timer functions
  - Enable server-side timer protection
  - Prevent indefinite scanning in autonomous mode
*/

-- Grant service role access to timer functions
GRANT EXECUTE ON FUNCTION get_scanning_elapsed_minutes TO service_role;
GRANT EXECUTE ON FUNCTION should_show_continuation_modal TO service_role;
GRANT EXECUTE ON FUNCTION trigger_continuation_modal TO service_role;
GRANT EXECUTE ON FUNCTION handle_continuation_response TO service_role;
GRANT EXECUTE ON FUNCTION check_continuation_modal_timeout TO service_role;