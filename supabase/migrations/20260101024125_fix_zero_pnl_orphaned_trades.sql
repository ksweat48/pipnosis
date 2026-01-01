/*
  # Fix Zero P&L and Orphaned Trades Issue

  ## Problem
  Admin dashboard shows users with:
  - Open trades displaying $0.00 P&L for extended periods
  - Trades marked as "active" when they should be closed
  - Inconsistent data between session status and trade status

  ## Root Causes Identified
  1. **Missing Price Data**: No realtime_prices entries for symbols → P&L can't calculate
  2. **Orphaned Trades**: Trades with status='open' but belong to completed/stopped sessions
  3. **Stale Trades**: Trades open for >24 hours without updates
  4. **Session-Trade Mismatch**: Trades not closing when sessions complete

  ## Solution
  This migration creates:
  1. Diagnostic functions to identify problematic trades
  2. Admin function to close orphaned/stuck trades
  3. Automated cleanup trigger
  4. Monitoring views for admin dashboard

  ## Safety
  - Only closes trades that are clearly orphaned or stuck
  - Preserves trade history and audit trail
  - Requires admin privileges to execute
*/

-- ============================================================================
-- PART 1: Diagnostic Functions
-- ============================================================================

-- Function to find orphaned trades (trades with completed/stopped sessions)
CREATE OR REPLACE FUNCTION admin_find_orphaned_trades()
RETURNS TABLE (
  trade_id uuid,
  user_id uuid,
  user_email text,
  symbol text,
  direction text,
  entry_price numeric,
  position_size numeric,
  opened_at timestamptz,
  hours_open numeric,
  session_id uuid,
  session_status text,
  issue_type text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  calling_user_id uuid;
BEGIN
  -- Security check
  calling_user_id := auth.uid();

  IF NOT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = calling_user_id AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    gst.id as trade_id,
    gst.user_id,
    up.email as user_email,
    gst.symbol,
    gst.direction,
    gst.entry_price,
    gst.position_size,
    gst.opened_at,
    EXTRACT(EPOCH FROM (NOW() - gst.opened_at)) / 3600 as hours_open,
    gst.goal_session_id as session_id,
    COALESCE(gs.status, 'NO_SESSION') as session_status,
    CASE
      WHEN gst.goal_session_id IS NULL THEN 'NO_SESSION_REFERENCE'
      WHEN gs.id IS NULL THEN 'SESSION_DELETED'
      WHEN gs.status IN ('completed', 'stopped') THEN 'SESSION_ENDED'
      WHEN EXTRACT(EPOCH FROM (NOW() - gst.opened_at)) / 3600 > 24 THEN 'STALE_TRADE'
      ELSE 'UNKNOWN'
    END as issue_type
  FROM goal_session_trades gst
  INNER JOIN user_profiles up ON up.id = gst.user_id
  LEFT JOIN goal_sessions gs ON gs.id = gst.goal_session_id
  WHERE gst.status = 'open'
    AND (
      -- No session reference
      gst.goal_session_id IS NULL
      -- Session doesn't exist
      OR gs.id IS NULL
      -- Session is completed/stopped
      OR gs.status IN ('completed', 'stopped')
      -- Trade has been open for more than 24 hours
      OR EXTRACT(EPOCH FROM (NOW() - gst.opened_at)) / 3600 > 24
    )
  ORDER BY gst.opened_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_find_orphaned_trades() TO authenticated;

COMMENT ON FUNCTION admin_find_orphaned_trades IS
  'Finds all orphaned or stuck trades that should be closed but remain open.
   Returns comprehensive diagnostics including session status and duration.';

-- Function to check price data availability
CREATE OR REPLACE FUNCTION admin_check_price_data_coverage()
RETURNS TABLE (
  symbol text,
  active_trades_count bigint,
  latest_price_timestamp timestamptz,
  minutes_since_last_price numeric,
  has_recent_price boolean,
  issue text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  calling_user_id uuid;
BEGIN
  -- Security check
  calling_user_id := auth.uid();

  IF NOT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = calling_user_id AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    gst.symbol,
    COUNT(DISTINCT gst.id) as active_trades_count,
    MAX(rp.created_at) as latest_price_timestamp,
    EXTRACT(EPOCH FROM (NOW() - MAX(rp.created_at))) / 60 as minutes_since_last_price,
    (MAX(rp.created_at) > NOW() - INTERVAL '5 minutes') as has_recent_price,
    CASE
      WHEN MAX(rp.created_at) IS NULL THEN 'NO_PRICE_DATA'
      WHEN MAX(rp.created_at) < NOW() - INTERVAL '10 minutes' THEN 'STALE_PRICES'
      ELSE 'OK'
    END as issue
  FROM goal_session_trades gst
  LEFT JOIN realtime_prices rp ON rp.symbol = gst.symbol
  WHERE gst.status = 'open'
  GROUP BY gst.symbol
  ORDER BY active_trades_count DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_check_price_data_coverage() TO authenticated;

COMMENT ON FUNCTION admin_check_price_data_coverage IS
  'Checks realtime_prices table coverage for all actively traded symbols.
   Identifies missing or stale price data that would cause $0 P&L.';

-- ============================================================================
-- PART 2: Cleanup and Fix Functions
-- ============================================================================

-- Function to force close orphaned trades
CREATE OR REPLACE FUNCTION admin_close_orphaned_trades(
  dry_run boolean DEFAULT true
)
RETURNS TABLE (
  trade_id uuid,
  user_id uuid,
  user_email text,
  symbol text,
  entry_price numeric,
  exit_price numeric,
  pnl numeric,
  reason text,
  action text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  calling_user_id uuid;
  trade_record RECORD;
  latest_price_bid numeric;
  latest_price_ask numeric;
  calculated_exit_price numeric;
  calculated_pnl numeric;
  trades_closed integer := 0;
BEGIN
  -- Security check
  calling_user_id := auth.uid();

  IF NOT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = calling_user_id AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Log the operation
  RAISE NOTICE 'Starting orphaned trades cleanup (dry_run: %)', dry_run;

  -- Process each orphaned trade
  FOR trade_record IN
    SELECT
      gst.id,
      gst.user_id,
      up.email,
      gst.symbol,
      gst.direction,
      gst.entry_price,
      gst.position_size,
      gst.goal_session_id,
      COALESCE(gs.status, 'NO_SESSION') as session_status,
      CASE
        WHEN gst.goal_session_id IS NULL THEN 'No session reference'
        WHEN gs.id IS NULL THEN 'Session deleted'
        WHEN gs.status IN ('completed', 'stopped') THEN 'Session ended'
        WHEN EXTRACT(EPOCH FROM (NOW() - gst.opened_at)) / 3600 > 24 THEN 'Stale trade (>24h)'
        ELSE 'Unknown issue'
      END as close_reason
    FROM goal_session_trades gst
    INNER JOIN user_profiles up ON up.id = gst.user_id
    LEFT JOIN goal_sessions gs ON gs.id = gst.goal_session_id
    WHERE gst.status = 'open'
      AND (
        gst.goal_session_id IS NULL
        OR gs.id IS NULL
        OR gs.status IN ('completed', 'stopped')
        OR EXTRACT(EPOCH FROM (NOW() - gst.opened_at)) / 3600 > 24
      )
  LOOP
    -- Get latest price for this symbol
    SELECT rp.bid, rp.ask INTO latest_price_bid, latest_price_ask
    FROM realtime_prices rp
    WHERE rp.symbol = trade_record.symbol
    ORDER BY rp.created_at DESC
    LIMIT 1;

    -- Calculate exit price (use entry price if no price data available)
    IF trade_record.direction = 'buy' THEN
      calculated_exit_price := COALESCE(latest_price_bid, trade_record.entry_price);
    ELSE
      calculated_exit_price := COALESCE(latest_price_ask, trade_record.entry_price);
    END IF;

    -- Calculate P&L using universal calculator
    calculated_pnl := calculate_pnl_universal(
      trade_record.symbol,
      trade_record.direction,
      trade_record.entry_price,
      calculated_exit_price,
      COALESCE(trade_record.position_size, 0.01)
    );

    -- Return the record
    trade_id := trade_record.id;
    user_id := trade_record.user_id;
    user_email := trade_record.email;
    symbol := trade_record.symbol;
    entry_price := trade_record.entry_price;
    exit_price := calculated_exit_price;
    pnl := calculated_pnl;
    reason := trade_record.close_reason;
    action := CASE WHEN dry_run THEN 'WOULD_CLOSE' ELSE 'CLOSED' END;

    RETURN NEXT;

    -- If not dry run, actually close the trade
    IF NOT dry_run THEN
      UPDATE goal_session_trades
      SET
        status = 'closed',
        exit_price = calculated_exit_price,
        profit_loss = calculated_pnl,
        current_pnl = calculated_pnl,
        closed_at = NOW(),
        close_reason = 'admin_orphan_cleanup',
        close_reason_detail = trade_record.close_reason
      WHERE id = trade_record.id;

      trades_closed := trades_closed + 1;
    END IF;
  END LOOP;

  IF NOT dry_run THEN
    RAISE NOTICE 'Closed % orphaned trades', trades_closed;
  ELSE
    RAISE NOTICE 'Dry run complete - would have closed % trades', trades_closed;
  END IF;

END;
$$;

GRANT EXECUTE ON FUNCTION admin_close_orphaned_trades(boolean) TO authenticated;

COMMENT ON FUNCTION admin_close_orphaned_trades IS
  'Closes orphaned and stuck trades with proper P&L calculation.
   Set dry_run=false to actually close trades.
   IMPORTANT: Always run with dry_run=true first to preview changes!';

-- ============================================================================
-- PART 3: Automated Prevention System
-- ============================================================================

-- Function to auto-close trades when session completes
CREATE OR REPLACE FUNCTION auto_close_trades_on_session_end()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  open_trades_count integer;
  trade_record RECORD;
  latest_price_bid numeric;
  latest_price_ask numeric;
  calculated_exit_price numeric;
  calculated_pnl numeric;
BEGIN
  -- Only process when session status changes to completed or stopped
  IF NEW.status NOT IN ('completed', 'stopped') OR OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Count open trades for this session
  SELECT COUNT(*) INTO open_trades_count
  FROM goal_session_trades
  WHERE goal_session_id = NEW.id
    AND status = 'open';

  IF open_trades_count = 0 THEN
    RETURN NEW;
  END IF;

  RAISE NOTICE 'Session % ended with % open trades - auto-closing', NEW.id, open_trades_count;

  -- Close each open trade
  FOR trade_record IN
    SELECT *
    FROM goal_session_trades
    WHERE goal_session_id = NEW.id
      AND status = 'open'
  LOOP
    -- Get latest price
    SELECT rp.bid, rp.ask INTO latest_price_bid, latest_price_ask
    FROM realtime_prices rp
    WHERE rp.symbol = trade_record.symbol
    ORDER BY rp.created_at DESC
    LIMIT 1;

    -- Calculate exit price
    IF trade_record.direction = 'buy' THEN
      calculated_exit_price := COALESCE(latest_price_bid, trade_record.entry_price);
    ELSE
      calculated_exit_price := COALESCE(latest_price_ask, trade_record.entry_price);
    END IF;

    -- Calculate P&L
    calculated_pnl := calculate_pnl_universal(
      trade_record.symbol,
      trade_record.direction,
      trade_record.entry_price,
      calculated_exit_price,
      COALESCE(trade_record.position_size, 0.01)
    );

    -- Close the trade
    UPDATE goal_session_trades
    SET
      status = 'closed',
      exit_price = calculated_exit_price,
      profit_loss = calculated_pnl,
      current_pnl = calculated_pnl,
      closed_at = NOW(),
      close_reason = 'session_ended',
      close_reason_detail = 'Auto-closed when session status changed to ' || NEW.status
    WHERE id = trade_record.id;

    RAISE NOTICE 'Auto-closed trade % with P&L $%', trade_record.id, calculated_pnl;
  END LOOP;

  RETURN NEW;
END;
$$;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS auto_close_trades_on_session_end_trigger ON goal_sessions;

-- Create trigger
CREATE TRIGGER auto_close_trades_on_session_end_trigger
  AFTER UPDATE OF status ON goal_sessions
  FOR EACH ROW
  EXECUTE FUNCTION auto_close_trades_on_session_end();

COMMENT ON TRIGGER auto_close_trades_on_session_end_trigger ON goal_sessions IS
  'Automatically closes all open trades when a session is completed or stopped.
   Prevents orphaned trades from being created.';

-- ============================================================================
-- PART 4: Monitoring View for Admin Dashboard
-- ============================================================================

-- Create a view for quick orphan detection
CREATE OR REPLACE VIEW admin_orphaned_trades_summary AS
SELECT
  COUNT(*) as total_orphaned_trades,
  COUNT(DISTINCT gst.user_id) as affected_users,
  COUNT(*) FILTER (WHERE gs.id IS NULL) as trades_with_deleted_sessions,
  COUNT(*) FILTER (WHERE gs.status = 'completed') as trades_with_completed_sessions,
  COUNT(*) FILTER (WHERE gs.status = 'stopped') as trades_with_stopped_sessions,
  COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (NOW() - gst.opened_at)) / 3600 > 24) as stale_trades_over_24h,
  MIN(gst.opened_at) as oldest_open_trade,
  EXTRACT(EPOCH FROM (NOW() - MIN(gst.opened_at))) / 3600 as oldest_trade_hours
FROM goal_session_trades gst
LEFT JOIN goal_sessions gs ON gs.id = gst.goal_session_id
WHERE gst.status = 'open'
  AND (
    gst.goal_session_id IS NULL
    OR gs.id IS NULL
    OR gs.status IN ('completed', 'stopped')
    OR EXTRACT(EPOCH FROM (NOW() - gst.opened_at)) / 3600 > 24
  );

GRANT SELECT ON admin_orphaned_trades_summary TO authenticated;

COMMENT ON VIEW admin_orphaned_trades_summary IS
  'Quick summary view of orphaned trades for admin monitoring.
   Shows counts by issue type and oldest open trade.';

-- ============================================================================
-- PART 5: Add Missing Columns if Needed
-- ============================================================================

-- Ensure close_reason_detail column exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades'
      AND column_name = 'close_reason_detail'
  ) THEN
    ALTER TABLE goal_session_trades
    ADD COLUMN close_reason_detail text;

    COMMENT ON COLUMN goal_session_trades.close_reason_detail IS
      'Additional details about why the trade was closed.';
  END IF;
END $$;
