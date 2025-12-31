/*
  # Trade Closure Audit System
  
  ## Purpose
  Creates an audit trail for ALL trade closures to ensure accountability
  and detect any violations of the single-authority principle.
  
  ## New Tables
  - `trade_closure_audit` - Records every trade closure with full context
  
  ## New Triggers
  - Automatically logs when any trade status changes to 'closed'
  
  ## Benefits
  - Detects bypasses of the coordinator pattern
  - Provides forensic capability for accounting discrepancies
  - Enables monitoring for unauthorized direct DB updates
*/

-- ============================================================================
-- TABLE: Trade Closure Audit
-- ============================================================================

CREATE TABLE IF NOT EXISTS trade_closure_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id uuid NOT NULL,
  user_id uuid NOT NULL,
  goal_session_id uuid,
  
  -- State change tracking
  old_status text,
  new_status text NOT NULL,
  close_reason text,
  
  -- Financial tracking
  entry_price numeric,
  exit_price numeric,
  calculated_pnl numeric,
  lot_size numeric,
  symbol text,
  direction text,
  
  -- Audit metadata
  closure_source text, -- 'coordinator', 'rpc', 'direct', 'trigger', 'unknown'
  closure_method text, -- The specific function/path that closed it
  stack_hint text,     -- Any available context about call origin
  
  -- Timestamps
  created_at timestamptz DEFAULT now(),
  
  -- Constraints
  CONSTRAINT valid_closure_source CHECK (
    closure_source IN ('coordinator', 'rpc', 'direct', 'trigger', 'fallback', 'emergency', 'unknown')
  )
);

-- Enable RLS
ALTER TABLE trade_closure_audit ENABLE ROW LEVEL SECURITY;

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_trade_closure_audit_trade_id 
  ON trade_closure_audit(trade_id);
CREATE INDEX IF NOT EXISTS idx_trade_closure_audit_user_id 
  ON trade_closure_audit(user_id);
CREATE INDEX IF NOT EXISTS idx_trade_closure_audit_created_at 
  ON trade_closure_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_closure_audit_source 
  ON trade_closure_audit(closure_source);

-- RLS Policies
CREATE POLICY "Users can view their own closure audits"
  ON trade_closure_audit FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert closure audits"
  ON trade_closure_audit FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Authenticated can insert own closure audits"
  ON trade_closure_audit FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- FUNCTION: Log Trade Closure to Audit
-- ============================================================================

CREATE OR REPLACE FUNCTION log_trade_closure_audit()
RETURNS TRIGGER AS $$
BEGIN
  -- Only log when status changes TO 'closed'
  IF NEW.status = 'closed' AND (OLD.status IS NULL OR OLD.status != 'closed') THEN
    INSERT INTO trade_closure_audit (
      trade_id,
      user_id,
      goal_session_id,
      old_status,
      new_status,
      close_reason,
      entry_price,
      exit_price,
      calculated_pnl,
      lot_size,
      symbol,
      direction,
      closure_source,
      closure_method,
      stack_hint
    ) VALUES (
      NEW.id,
      NEW.user_id,
      NEW.goal_session_id,
      OLD.status,
      NEW.status,
      NEW.close_reason,
      NEW.entry_price,
      NEW.exit_price,
      NEW.profit_loss,
      COALESCE(NEW.lot_size, NEW.position_size),
      NEW.symbol,
      NEW.direction,
      'trigger',  -- Default to 'trigger' since this is auto-logged
      'db_trigger',
      current_query()
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS trg_audit_trade_closure ON goal_session_trades;

-- Create trigger on goal_session_trades
CREATE TRIGGER trg_audit_trade_closure
  AFTER UPDATE ON goal_session_trades
  FOR EACH ROW
  EXECUTE FUNCTION log_trade_closure_audit();

-- ============================================================================
-- FUNCTION: Explicit Audit Logging (for coordinator use)
-- ============================================================================

CREATE OR REPLACE FUNCTION log_coordinator_closure(
  p_trade_id uuid,
  p_user_id uuid,
  p_goal_session_id uuid,
  p_old_status text,
  p_close_reason text,
  p_entry_price numeric,
  p_exit_price numeric,
  p_calculated_pnl numeric,
  p_lot_size numeric,
  p_symbol text,
  p_direction text,
  p_closure_source text DEFAULT 'coordinator',
  p_closure_method text DEFAULT 'tradeClosureCoordinator.closeTrade'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_audit_id uuid;
BEGIN
  INSERT INTO trade_closure_audit (
    trade_id,
    user_id,
    goal_session_id,
    old_status,
    new_status,
    close_reason,
    entry_price,
    exit_price,
    calculated_pnl,
    lot_size,
    symbol,
    direction,
    closure_source,
    closure_method,
    stack_hint
  ) VALUES (
    p_trade_id,
    p_user_id,
    p_goal_session_id,
    p_old_status,
    'closed',
    p_close_reason,
    p_entry_price,
    p_exit_price,
    p_calculated_pnl,
    p_lot_size,
    p_symbol,
    p_direction,
    p_closure_source,
    p_closure_method,
    'Explicit coordinator logging'
  )
  RETURNING id INTO v_audit_id;
  
  RETURN v_audit_id;
END;
$$;

GRANT EXECUTE ON FUNCTION log_coordinator_closure(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, text, text, text, text) TO authenticated;

-- ============================================================================
-- FUNCTION: Get Recent Closure Audits (for admin/debugging)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_closure_audit_summary(
  p_user_id uuid DEFAULT NULL,
  p_hours_back int DEFAULT 24
)
RETURNS TABLE (
  closure_source text,
  closure_count bigint,
  avg_pnl numeric,
  total_pnl numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    tca.closure_source,
    COUNT(*)::bigint as closure_count,
    ROUND(AVG(tca.calculated_pnl), 2) as avg_pnl,
    ROUND(SUM(tca.calculated_pnl), 2) as total_pnl
  FROM trade_closure_audit tca
  WHERE 
    tca.created_at > NOW() - (p_hours_back || ' hours')::interval
    AND (p_user_id IS NULL OR tca.user_id = p_user_id)
  GROUP BY tca.closure_source
  ORDER BY closure_count DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_closure_audit_summary(uuid, int) TO authenticated;

-- ============================================================================
-- Success Message
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '╔═══════════════════════════════════════════════════════════════╗';
  RAISE NOTICE '║       TRADE CLOSURE AUDIT SYSTEM CREATED                      ║';
  RAISE NOTICE '╚═══════════════════════════════════════════════════════════════╝';
  RAISE NOTICE '';
  RAISE NOTICE 'Every trade closure is now audited with:';
  RAISE NOTICE '  - Source tracking (coordinator, rpc, direct, trigger)';
  RAISE NOTICE '  - Full financial context (entry, exit, P&L)';
  RAISE NOTICE '  - Timestamp and method tracking';
  RAISE NOTICE '';
  RAISE NOTICE 'Use get_closure_audit_summary() to detect anomalies.';
  RAISE NOTICE '';
END $$;
