/*
  # CCIP Fix: Make trade_id Nullable in confidence_calculation_audit

  **CCIP Phase:** Emergency Schema Correction
  **Governance:** SSOT Lifecycle Compliance
  **Impact:** Critical - Restores audit trail visibility

  ## Problem Statement
  
  The confidence_calculation_audit table requires trade_id (NOT NULL), but confidence 
  calculations occur at multiple lifecycle stages:
  
  1. **Pre-execution decision** - No trade exists yet (trade_id = NULL)
  2. **Revision/repair** - Alpha revises decision before execution (trade_id = NULL)
  3. **Rejection** - Trade blocked by validation (trade_id = NULL)
  4. **Post-execution** - Trade created and executed (trade_id = UUID)
  
  Current NOT NULL constraint forces audit failures at stages 1-3, creating blind spots.
  
  ## Solution
  
  Make trade_id nullable to support full confidence calculation lifecycle.
  
  ### Lifecycle States
  
  | Stage | trade_id | session_id | Purpose |
  |-------|----------|------------|---------|
  | Decision | NULL | UUID | Pre-trade confidence calculation |
  | Revision | NULL | UUID | Alpha repairs/revises before execution |
  | Rejection | NULL | UUID | Validation blocked trade |
  | Execution | UUID | UUID | Trade finalized and executed |
  
  ## Data Integrity
  
  - NULL trade_id is **semantically correct** for pre-execution calculations
  - Prevents fake referential integrity via placeholder UUIDs
  - Maintains forensic clarity in analytics queries
  - RLS policies already handle NULL correctly (user_id-based filtering)
  
  ## SSOT Compliance
  
  - Single authority: confidence_calculation_audit owns confidence calculation history
  - No duplicate logging in other tables
  - Trade lifecycle properly represented
  
  ## Governance Notes
  
  - Non-breaking change (adds nullability, doesn't remove data)
  - Existing records with trade_id remain valid
  - Future records can have NULL trade_id during pre-execution phases
  - Analytics queries should filter by lifecycle stage as needed
*/

DO $$
BEGIN
  -- Make trade_id nullable to support full confidence calculation lifecycle
  ALTER TABLE confidence_calculation_audit
    ALTER COLUMN trade_id DROP NOT NULL;
  
  -- Add helpful comment documenting lifecycle states
  COMMENT ON COLUMN confidence_calculation_audit.trade_id IS 
    'Trade UUID. NULL during pre-execution stages (decision, revision, rejection). Set during execution stage.';
  
  -- Create index to support queries filtering by lifecycle stage
  CREATE INDEX IF NOT EXISTS idx_confidence_audit_lifecycle 
    ON confidence_calculation_audit(trade_id, calculation_timestamp)
    WHERE trade_id IS NOT NULL;
  
  -- Create index for pre-execution audit queries
  CREATE INDEX IF NOT EXISTS idx_confidence_audit_pre_execution
    ON confidence_calculation_audit(session_id, calculation_timestamp)
    WHERE trade_id IS NULL;
  
  -- Log CCIP change
  INSERT INTO confidence_refactor_ccip_events (
    event_type,
    phase,
    component,
    description,
    previous_value,
    new_value,
    impact_severity,
    actor,
    reason
  ) VALUES (
    'logic_change',
    'staged_deployment',
    'confidence_calculation_audit',
    'Made trade_id nullable to support full confidence calculation lifecycle',
    jsonb_build_object('trade_id', 'NOT NULL'),
    jsonb_build_object('trade_id', 'nullable', 'reason', 'confidence calculations occur before trade creation'),
    'high',
    'system',
    'Fix 400 Bad Request errors during pre-execution confidence logging'
  );
  
  RAISE NOTICE '✅ trade_id is now nullable in confidence_calculation_audit';
  RAISE NOTICE '✅ Lifecycle indexes created for optimized queries';
  RAISE NOTICE '✅ CCIP change logged to governance system';
  
END $$;
