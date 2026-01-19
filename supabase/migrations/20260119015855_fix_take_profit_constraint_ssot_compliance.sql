/*
  # Fix Take Profit Constraint - SSOT Compliance
  
  ## Problem
  The existing `check_tp_ordering` constraint blocks valid single-TP executions:
  - Current: Forces BOTH tp1 and tp2 OR NEITHER
  - Reality: tp1 is ADVISORY (optional), tp2 is final exit
  - Impact: 100% execution failure rate when tp1 is NULL
  
  ## Business Rule (SSOT Authority Model)
  - `take_profit` (NOT NULL) = Authoritative final exit price - PRIMARY SSOT
  - `take_profit_1` (NULLABLE) = Optional advisory level for partial profit guidance
  - `take_profit_2` (NULLABLE) = Optional tracking field (typically mirrors take_profit)
  
  ## Changes
  1. Drop invalid `check_tp_ordering` constraint
  2. Add production-safe validation that allows:
     - Single TP: tp1=NULL, tp2=set (most common)
     - Dual TP: tp1=set, tp2=set (when Alpha provides guidance)
     - Neither: tp1=NULL, tp2=NULL (legacy trades)
  3. Add schema documentation
  
  ## Safety
  - ALL 161 existing trades have tp1=NULL and tp2=NULL (will remain valid)
  - New constraint is LESS restrictive (unblocks execution)
  - No data migration needed
  - Rollback safe (can re-add old constraint if needed)
*/

-- Step 1: Drop the blocking constraint
ALTER TABLE goal_session_trades 
DROP CONSTRAINT IF EXISTS check_tp_ordering;

-- Step 2: Add production-safe validation
-- This allows:
-- - tp1=NULL, tp2=any (single TP mode - MOST COMMON)
-- - tp1=set, tp2=set (dual TP mode with advisory level)
-- - tp1=NULL, tp2=NULL (legacy/no-TP state)
-- 
-- This PREVENTS:
-- - tp1=set, tp2=NULL (illogical - can't have partial without final)
-- - tp1 and tp2 being equal when both set (no point in advisory if same as final)
ALTER TABLE goal_session_trades
ADD CONSTRAINT check_tp_structure CHECK (
  -- Allow any state where tp1 is NULL (single TP or no TP)
  (take_profit_1 IS NULL) OR
  -- If tp1 is set, tp2 must also be set and different
  (take_profit_1 IS NOT NULL AND take_profit_2 IS NOT NULL AND take_profit_1 <> take_profit_2)
);

-- Step 3: Add schema documentation
COMMENT ON COLUMN goal_session_trades.take_profit IS 
  'PRIMARY SSOT: Authoritative final exit price (NOT NULL). This is the single source of truth for trade closure.';

COMMENT ON COLUMN goal_session_trades.take_profit_1 IS 
  'ADVISORY ONLY: Optional partial profit guidance level. Alpha may suggest closing portion of position here. NULL when no partial guidance provided.';

COMMENT ON COLUMN goal_session_trades.take_profit_2 IS 
  'TRACKING: Optional field that typically mirrors take_profit for dual-TP tracking. Used when Alpha provides both partial (tp1) and final (tp2) levels.';

-- Step 4: Verify constraint logic
-- This query should return 0 violations in production
DO $$
DECLARE
  violation_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO violation_count
  FROM goal_session_trades
  WHERE NOT (
    -- Valid states
    (take_profit_1 IS NULL) OR
    (take_profit_1 IS NOT NULL AND take_profit_2 IS NOT NULL AND take_profit_1 <> take_profit_2)
  );
  
  IF violation_count > 0 THEN
    RAISE WARNING 'Found % trades that violate new constraint - manual review needed', violation_count;
  ELSE
    RAISE NOTICE 'Constraint validation passed - all existing trades comply with new rules';
  END IF;
END $$;
