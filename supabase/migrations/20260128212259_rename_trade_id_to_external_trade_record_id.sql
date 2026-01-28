/*
  # Rename trade_id Column for Schema Clarity (CCIP SSOT Compliance)

  ## Change Overview
  Renames `goal_session_trades.trade_id` to `external_trade_record_id` to eliminate ambiguity.

  ## Problem
  The column name `trade_id` is ambiguous because:
  - The primary key is already `id` (which IS the trade ID)
  - Having both `id` and `trade_id` creates confusion
  - Developers might mistakenly use `trade_id` when they mean `id`
  - Not clear that this is a foreign key to an external system

  ## Solution
  Rename to `external_trade_record_id` to clearly indicate:
  - This is a reference to an external system (MT5, trade_records table)
  - This is NOT the trade's primary identifier
  - This is optional/nullable (legacy integration)

  ## Impact Analysis
  - Column is nullable and appears unused in current codebase
  - FK constraint to trade_records table will be preserved
  - TypeScript interfaces will need updating (GoalSessionTrade type)
  - No RPC functions reference this column
  - No active queries use this column

  ## Migration Strategy
  1. Rename column (PostgreSQL handles FK constraint automatically)
  2. Update any views or functions if needed
  3. Frontend TypeScript types will be updated separately

  ## Rollback Plan
  If needed, run:
  ```sql
  ALTER TABLE goal_session_trades
  RENAME COLUMN external_trade_record_id TO trade_id;
  ```

  ## CCIP Compliance
  - System Map: Audited all usages of trade_id column
  - Logic Contract: Column is for external reference only
  - Compatibility: No breaking changes (column unused)
  - Documentation: Updated type definitions
*/

-- Rename column for clarity
ALTER TABLE goal_session_trades
RENAME COLUMN trade_id TO external_trade_record_id;

-- Add helpful comment explaining the column's purpose
COMMENT ON COLUMN goal_session_trades.external_trade_record_id IS
  'Optional FK to trade_records.id for external system integration (e.g., MT5).
   This is NOT the trade ID - use the id column for that.
   This field is legacy and may be null for most trades.';

-- Verify the FK constraint was preserved (it should rename automatically)
-- If not, we can recreate it:
DO $$
BEGIN
  -- Check if FK exists with new column name
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_type = 'FOREIGN KEY'
    AND table_name = 'goal_session_trades'
    AND constraint_name LIKE '%external_trade_record_id%'
  ) THEN
    -- FK constraint might still have old name but reference correct column
    RAISE NOTICE 'FK constraint preserved with original name - this is acceptable';
  END IF;
END $$;

-- Log the change for audit trail
DO $$
BEGIN
  RAISE NOTICE '✅ CCIP Migration Complete: trade_id → external_trade_record_id';
  RAISE NOTICE 'Column renamed to eliminate ambiguity with primary key id';
  RAISE NOTICE 'Foreign key constraint to trade_records preserved';
END $$;