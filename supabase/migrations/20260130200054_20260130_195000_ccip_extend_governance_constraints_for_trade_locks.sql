/*
  # CCIP: Extend Governance Change Log Constraints for Trade Processing Locks
  
  ## Problem
  The trade_processing_lock system is failing with constraint violations:
  - Error: 'new row for relation "governance_change_log" violates check constraint "valid_entity_type"'
  - The lock acquisition attempts are being rejected because 'trade_processing_lock' is not in the allowed entity_type values
  - Lock operations like 'lock_acquired', 'lock_released' are not in the allowed operation values
  
  ## Root Cause
  The governance_change_log table has overly restrictive check constraints that were not updated
  when the trade_processing_lock system was added. This violates SSOT principles because the
  lock system's audit requirements were not synchronized with the governance schema.
  
  ## Solution
  Extend the check constraints to include:
  1. New entity_type: 'trade_processing_lock', 'database_migration'
  2. New operations: 'lock_acquired', 'lock_attempt_failed', 'lock_released', 'expired_locks_cleanup', 'ccip_migration_applied'
  
  ## SSOT Compliance
  - Single constraint definition for all valid entity types across the platform
  - Single constraint definition for all valid operations
  - Any new governance-tracked entity must update these constraints
  
  ## Impact
  - Fixes: Trade lifecycle monitoring will function correctly
  - Fixes: Lock acquisition/release will be properly audited
  - Enables: Future governance tracking of migrations and system events
  
  ## Governance
  This migration itself will be logged in governance_change_log after constraints are updated.
*/

-- ============================================================================
-- PART 1: Extend entity_type constraint
-- ============================================================================

-- Drop existing constraint
ALTER TABLE governance_change_log 
DROP CONSTRAINT IF EXISTS valid_entity_type;

-- Add extended constraint with new entity types
ALTER TABLE governance_change_log 
ADD CONSTRAINT valid_entity_type 
CHECK (entity_type = ANY (ARRAY[
  -- Existing entity types (DO NOT REMOVE)
  'goal_sessions'::text,
  'goal_session_trades'::text,
  'entry_intents'::text,
  'user_profiles'::text,
  'pending_user_modals'::text,
  
  -- NEW: Trade processing system
  'trade_processing_lock'::text,
  
  -- NEW: System infrastructure
  'database_migration'::text,
  'system_configuration'::text
]));

-- ============================================================================
-- PART 2: Extend operation constraint
-- ============================================================================

-- Drop existing constraint
ALTER TABLE governance_change_log 
DROP CONSTRAINT IF EXISTS valid_operation;

-- Add extended constraint with new operations
ALTER TABLE governance_change_log 
ADD CONSTRAINT valid_operation 
CHECK (operation = ANY (ARRAY[
  -- Existing operations (DO NOT REMOVE)
  'status_transition'::text,
  'balance_update'::text,
  'intent_cleanup'::text,
  'intent_execution'::text,
  'modal_creation'::text,
  'modal_dismissal'::text,
  'timeout_auto_close'::text,
  'force_cleanup'::text,
  'trade_closure'::text,
  'field_update'::text,
  'timestamp_set'::text,
  
  -- NEW: Lock system operations
  'lock_acquired'::text,
  'lock_attempt_failed'::text,
  'lock_released'::text,
  'expired_locks_cleanup'::text,
  
  -- NEW: System operations
  'ccip_migration_applied'::text,
  'configuration_update'::text,
  'system_recovery'::text
]));

-- ============================================================================
-- PART 3: Self-documenting governance entry
-- ============================================================================

-- Log this migration in governance_change_log (now that constraints are fixed)
INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  reason,
  metadata
) VALUES (
  'database_migration',
  gen_random_uuid(),
  'ccip_migration_applied',
  'Extended governance_change_log constraints to support trade_processing_lock audit trail',
  jsonb_build_object(
    'migration_name', '20260130_195000_ccip_extend_governance_constraints_for_trade_locks',
    'change_type', 'constraint_extension',
    'added_entity_types', ARRAY['trade_processing_lock', 'database_migration', 'system_configuration'],
    'added_operations', ARRAY['lock_acquired', 'lock_attempt_failed', 'lock_released', 'expired_locks_cleanup', 'ccip_migration_applied', 'configuration_update', 'system_recovery'],
    'ssot_compliance', true,
    'breaking_change', false,
    'fixes_production_issue', true,
    'issue_description', 'Trade lifecycle monitoring failing due to governance constraint violations',
    'affected_systems', ARRAY['trade_lifecycle_manager', 'trade_processing_lock_service', 'position_monitor']
  )
);

-- ============================================================================
-- PART 4: Add index for performance
-- ============================================================================

-- Index for querying lock operations in governance log
CREATE INDEX IF NOT EXISTS idx_governance_change_log_lock_operations 
ON governance_change_log(entity_type, operation, created_at DESC)
WHERE entity_type = 'trade_processing_lock';

-- ============================================================================
-- VERIFICATION QUERY (for manual testing)
-- ============================================================================

/*
-- Verify constraints are updated:
SELECT 
  conname, 
  pg_get_constraintdef(oid) as constraint_def 
FROM pg_constraint 
WHERE conrelid = 'governance_change_log'::regclass 
  AND contype = 'c';

-- Test lock insertion (should now succeed):
INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  reason,
  metadata
) VALUES (
  'trade_processing_lock',
  gen_random_uuid(),
  'lock_acquired',
  'Test insertion',
  '{"test": true}'::jsonb
);
*/
