/*
  # EMERGENCY FIX: Position Can't Close - Trigger References Missing Table
  
  ## Critical Issue
  The `check_and_award_tp_milestones()` trigger tries to INSERT into
  `ai_learning_insights` table which doesn't exist anymore, causing ALL
  position closes to fail with transaction rollback.
  
  ## Impact
  - Users CANNOT close positions manually
  - Stop losses DON'T work
  - Take profits DON'T work
  - Balance never updates
  
  ## Root Cause
  The trigger function was created to track TP1/TP2 milestones and award AI
  learning points, but the `ai_learning_insights` table was deleted in a
  cleanup migration. The trigger still tries to INSERT into it.
  
  ## Fix
  Remove the INSERT statements from the trigger. We'll still track TP1/TP2
  hits in the goal_sessions table, but won't try to save AI learning data
  to the non-existent table.
  
  ## Verified
  Checked database schema - ai_learning_insights table does NOT exist.
*/

-- Drop and recreate the function WITHOUT the INSERT statements
DROP FUNCTION IF EXISTS check_and_award_tp_milestones() CASCADE;

CREATE OR REPLACE FUNCTION check_and_award_tp_milestones()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_pnl numeric;
BEGIN
  -- Calculate current PnL for this session
  SELECT COALESCE(SUM(
    CASE
      WHEN status = 'closed' THEN profit_loss
      ELSE 0
    END
  ), 0)
  INTO current_pnl
  FROM goal_session_trades
  WHERE goal_session_id = NEW.id;

  -- Check TP1 milestone (conservative target)
  IF NEW.tp1_target IS NOT NULL
     AND NOT NEW.tp1_hit
     AND current_pnl >= NEW.tp1_target THEN
    
    NEW.tp1_hit := true;
    NEW.tp1_hit_at := NOW();
    NEW.tp1_learning_awarded := true;
    
    -- AI learning points would be saved here if table existed
    -- For now, just mark the milestone as hit
  END IF;

  -- Check TP2 milestone (realistic target)
  IF NEW.tp2_target IS NOT NULL
     AND NOT NEW.tp2_hit
     AND current_pnl >= NEW.tp2_target THEN
    
    NEW.tp2_hit := true;
    NEW.tp2_hit_at := NOW();
    
    -- AI learning points would be saved here if table existed
    -- For now, just mark the milestone as hit
  END IF;

  RETURN NEW;
END;
$$;

-- Recreate trigger
DROP TRIGGER IF EXISTS check_tp_milestones_trigger ON goal_sessions;
CREATE TRIGGER check_tp_milestones_trigger
  BEFORE UPDATE ON goal_sessions
  FOR EACH ROW
  WHEN (OLD.current_progress IS DISTINCT FROM NEW.current_progress)
  EXECUTE FUNCTION check_and_award_tp_milestones();

-- Grant permissions
GRANT EXECUTE ON FUNCTION check_and_award_tp_milestones() TO authenticated;
GRANT EXECUTE ON FUNCTION check_and_award_tp_milestones() TO service_role;

COMMENT ON FUNCTION check_and_award_tp_milestones() IS
  'EMERGENCY FIX: Removed INSERT to non-existent ai_learning_insights table';
