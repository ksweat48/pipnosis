/*
  # EMERGENCY FIX: Session ID Column Name Bug

  ## Critical Issue
  The `check_and_award_tp_milestones()` function uses the wrong column name `session_id`
  instead of `goal_session_id`, causing ALL trades to fail closing when stop loss is hit.

  ## Impact
  - Stop losses don't execute (positions stay open)
  - Take profits don't execute
  - AI learning data is corrupted because trades don't close properly
  - Users lose money because protective stops fail

  ## Root Cause
  Migration 20251230021939 created a trigger function with `WHERE session_id = NEW.id`
  but the goal_session_trades table has a column named `goal_session_id`, NOT `session_id`.

  ## Fix
  Recreate the function with the correct column name: `goal_session_id`

  ## Database Flow That Was Broken
  1. Stop loss is hit → close_goal_session_trade() is called
  2. close_goal_session_trade() updates goal_session_trades status='closed'
  3. update_progress_on_trade_close trigger updates goal_sessions table
  4. check_and_award_tp_milestones trigger runs on goal_sessions UPDATE
  5. ❌ Function queries "WHERE session_id = NEW.id" → column doesn't exist
  6. ❌ Transaction ROLLBACK → trade never closes!
*/

-- Drop and recreate the function with correct column name
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
  -- CRITICAL FIX: Changed session_id to goal_session_id
  SELECT COALESCE(SUM(
    CASE
      WHEN status = 'closed' THEN profit_loss
      ELSE 0
    END
  ), 0)
  INTO current_pnl
  FROM goal_session_trades
  WHERE goal_session_id = NEW.id;  -- ✅ FIXED: was session_id, now goal_session_id

  -- Check TP1 milestone
  IF NEW.tp1_target IS NOT NULL
     AND NOT NEW.tp1_hit
     AND current_pnl >= NEW.tp1_target THEN

    NEW.tp1_hit := true;
    NEW.tp1_hit_at := NOW();

    -- Award Alpha +0.5 learning points for TP1
    IF NOT NEW.tp1_learning_awarded THEN
      INSERT INTO ai_learning_insights (
        user_id,
        insight_type,
        content,
        confidence_score,
        validation_status,
        metadata
      ) VALUES (
        NEW.user_id,
        'tp1_milestone_achieved',
        format('TP1 milestone achieved! Conservative target of $%.2f reached. Full learning credit awarded.', NEW.tp1_target),
        0.5,
        'validated',
        jsonb_build_object(
          'session_id', NEW.id,
          'tp1_target', NEW.tp1_target,
          'tp2_target', NEW.tp2_target,
          'actual_pnl', current_pnl,
          'learning_points', 0.5
        )
      );

      NEW.tp1_learning_awarded := true;
    END IF;
  END IF;

  -- Check TP2 milestone
  IF NEW.tp2_target IS NOT NULL
     AND NOT NEW.tp2_hit
     AND current_pnl >= NEW.tp2_target THEN

    NEW.tp2_hit := true;
    NEW.tp2_hit_at := NOW();

    -- Award Alpha +0.5 more learning points for TP2 (total 1.0)
    INSERT INTO ai_learning_insights (
      user_id,
      insight_type,
      content,
      confidence_score,
      validation_status,
      metadata
    ) VALUES (
      NEW.user_id,
      'tp2_milestone_achieved',
      format('TP2 milestone achieved! Realistic target of $%.2f reached. Additional learning credit awarded.', NEW.tp2_target),
      0.5,
      'validated',
      jsonb_build_object(
        'session_id', NEW.id,
        'tp1_target', NEW.tp1_target,
        'tp2_target', NEW.tp2_target,
        'actual_pnl', current_pnl,
        'learning_points', 0.5,
        'total_learning_points', 1.0
      )
    );
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
  'Awards learning points for TP1/TP2 milestones. FIXED: Uses goal_session_id not session_id';
