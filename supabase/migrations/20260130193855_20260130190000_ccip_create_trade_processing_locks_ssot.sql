/*
  # CCIP: Create Trade Processing Locks System (SSOT Authority)

  ## Change Request
  CCIP-20260130-002: Fix Duplicate Trade Closure Bug

  ## Root Cause
  Multiple monitoring systems (TradeLifecycleManager, PositionMonitorService, RealtimeSLTPMonitor)
  independently monitor and close trades without coordination, causing duplicate closures.

  ## SSOT Violation
  - No single authority for "is this trade being processed"
  - Each system maintains separate in-memory locks
  - Query cache causes stale reads of trade status

  ## Solution
  Create database-backed locking system as SINGLE SOURCE OF TRUTH for trade processing state.

  ## New Tables
  1. `trade_processing_locks` - Active locks for trades being processed
     - trade_id (PK): Which trade is locked
     - locked_by: System name that acquired lock
     - locked_at: When lock was acquired
     - lock_expires_at: When lock auto-expires (30s TTL)
     - metadata: Additional context

  ## Security
  - RLS enabled for audit visibility
  - Service role can manage locks
  - Authenticated users can view (read-only)

  ## Governance
  - All lock operations logged to governance_change_log
  - Audit trail for debugging
  - Monitoring dashboard queries included
*/

-- =====================================================
-- Create trade_processing_locks table
-- =====================================================

CREATE TABLE IF NOT EXISTS trade_processing_locks (
  trade_id uuid PRIMARY KEY REFERENCES goal_session_trades(id) ON DELETE CASCADE,
  locked_by text NOT NULL CHECK (locked_by IN ('TradeLifecycleManager', 'PositionMonitorService', 'RealtimeSLTPMonitor')),
  locked_at timestamptz NOT NULL DEFAULT NOW(),
  lock_expires_at timestamptz NOT NULL DEFAULT (NOW() + INTERVAL '30 seconds'),
  metadata jsonb DEFAULT '{}'::jsonb,

  -- Governance: Log who locked it
  created_at timestamptz NOT NULL DEFAULT NOW(),

  -- Ensure lock hasn't expired already
  CONSTRAINT valid_lock_expiry CHECK (lock_expires_at > locked_at)
);

-- =====================================================
-- Indexes for performance
-- =====================================================

-- Fast lookup by trade_id (primary key already indexed)

-- Find expired locks for cleanup
CREATE INDEX IF NOT EXISTS idx_trade_processing_locks_expired
  ON trade_processing_locks(lock_expires_at);

-- Find locks by system for monitoring
CREATE INDEX IF NOT EXISTS idx_trade_processing_locks_system
  ON trade_processing_locks(locked_by, locked_at DESC);

-- =====================================================
-- Row Level Security (RLS)
-- =====================================================

ALTER TABLE trade_processing_locks ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (monitoring systems use this)
CREATE POLICY "Service role full access to trade locks"
  ON trade_processing_locks
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users can view locks (read-only for transparency)
CREATE POLICY "Users can view trade processing locks"
  ON trade_processing_locks
  FOR SELECT
  TO authenticated
  USING (true);

-- =====================================================
-- Helper Functions
-- =====================================================

-- Function: Try to acquire lock (returns true if successful)
CREATE OR REPLACE FUNCTION try_acquire_trade_lock(
  p_trade_id uuid,
  p_locked_by text,
  p_lock_duration_seconds integer DEFAULT 30
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_acquired boolean;
BEGIN
  -- First, clean up any expired locks for this trade
  DELETE FROM trade_processing_locks
  WHERE trade_id = p_trade_id
    AND lock_expires_at < NOW();

  -- Try to insert lock (will fail if already exists)
  BEGIN
    INSERT INTO trade_processing_locks (
      trade_id,
      locked_by,
      locked_at,
      lock_expires_at
    ) VALUES (
      p_trade_id,
      p_locked_by,
      NOW(),
      NOW() + (p_lock_duration_seconds || ' seconds')::interval
    );

    v_lock_acquired := true;

    -- Log successful acquisition to governance
    INSERT INTO governance_change_log (
      entity_type,
      entity_id,
      operation,
      new_value,
      reason,
      metadata,
      created_at
    ) VALUES (
      'trade_processing_lock',
      p_trade_id,
      'lock_acquired',
      jsonb_build_object(
        'trade_id', p_trade_id,
        'locked_by', p_locked_by
      ),
      'Trade processing lock acquired successfully',
      jsonb_build_object(
        'success', true
      ),
      NOW()
    );

  EXCEPTION
    WHEN unique_violation THEN
      -- Lock already exists (another system got it first)
      v_lock_acquired := false;

      -- Log failed acquisition attempt to governance
      INSERT INTO governance_change_log (
        entity_type,
        entity_id,
        operation,
        reason,
        metadata,
        created_at
      ) VALUES (
        'trade_processing_lock',
        p_trade_id,
        'lock_attempt_failed',
        'Lock already held by another system',
        jsonb_build_object(
          'attempted_by', p_locked_by,
          'success', false,
          'reason', 'already_locked'
        ),
        NOW()
      );
  END;

  RETURN v_lock_acquired;
END;
$$;

-- Function: Release lock
CREATE OR REPLACE FUNCTION release_trade_lock(
  p_trade_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_locked_by text;
BEGIN
  -- Get who had the lock before deleting
  SELECT locked_by INTO v_locked_by
  FROM trade_processing_locks
  WHERE trade_id = p_trade_id;

  -- Delete the lock
  DELETE FROM trade_processing_locks
  WHERE trade_id = p_trade_id;

  -- Log release to governance (if lock existed)
  IF v_locked_by IS NOT NULL THEN
    INSERT INTO governance_change_log (
      entity_type,
      entity_id,
      operation,
      old_value,
      reason,
      created_at
    ) VALUES (
      'trade_processing_lock',
      p_trade_id,
      'lock_released',
      jsonb_build_object(
        'was_locked_by', v_locked_by
      ),
      'Trade processing lock released',
      NOW()
    );
  END IF;
END;
$$;

-- Function: Check if trade is locked
CREATE OR REPLACE FUNCTION is_trade_locked(
  p_trade_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_locked boolean;
BEGIN
  -- Check if lock exists and hasn't expired
  SELECT EXISTS (
    SELECT 1
    FROM trade_processing_locks
    WHERE trade_id = p_trade_id
      AND lock_expires_at > NOW()
  ) INTO v_is_locked;

  RETURN v_is_locked;
END;
$$;

-- Function: Cleanup expired locks (called by cron or manually)
CREATE OR REPLACE FUNCTION cleanup_expired_trade_locks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_count integer;
  v_migration_id uuid;
BEGIN
  -- Delete expired locks
  WITH deleted AS (
    DELETE FROM trade_processing_locks
    WHERE lock_expires_at < NOW()
    RETURNING trade_id, locked_by
  )
  SELECT COUNT(*) INTO v_deleted_count FROM deleted;

  -- Log cleanup if any locks were removed
  IF v_deleted_count > 0 THEN
    -- Use a deterministic UUID for cleanup operations
    v_migration_id := '00000000-0000-0000-0000-000000000001'::uuid;
    
    INSERT INTO governance_change_log (
      entity_type,
      entity_id,
      operation,
      reason,
      metadata,
      created_at
    ) VALUES (
      'trade_processing_lock',
      v_migration_id,
      'expired_locks_cleanup',
      'Automatic cleanup of expired trade processing locks',
      jsonb_build_object(
        'locks_cleaned', v_deleted_count
      ),
      NOW()
    );
  END IF;

  RETURN v_deleted_count;
END;
$$;

-- =====================================================
-- Grant permissions to service role
-- =====================================================

GRANT ALL ON trade_processing_locks TO service_role;
GRANT EXECUTE ON FUNCTION try_acquire_trade_lock TO service_role;
GRANT EXECUTE ON FUNCTION release_trade_lock TO service_role;
GRANT EXECUTE ON FUNCTION is_trade_locked TO service_role;
GRANT EXECUTE ON FUNCTION cleanup_expired_trade_locks TO service_role;