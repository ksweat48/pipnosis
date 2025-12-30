/*
  # Dual Take Profit System for Goal Sessions

  1. New Fields Added to `goal_sessions`:
    - `tp1_target` (numeric): Conservative "safe zone" target that Alpha believes has higher probability
    - `tp2_target` (numeric): Realistic market target that Alpha thinks the market will actually give
    - `tp1_hit` (boolean): Whether TP1 has been reached
    - `tp1_hit_at` (timestamp): When TP1 was achieved
    - `tp1_learning_awarded` (boolean): Whether Alpha received +0.5 learning points for TP1
    - `tp2_hit` (boolean): Whether TP2 has been reached (original goal)
    - `tp2_hit_at` (timestamp): When TP2 was achieved

  2. Purpose:
    - TP1 is an advisory milestone showing user they've hit a high-probability safe zone
    - Trade continues after TP1 - user can choose to close or continue to TP2
    - Alpha gets +0.5 points when TP1 is hit (for learning)
    - Alpha gets +0.5 more points when TP2 is hit (total 1.0 for full success)
    - Session continues to TP2 unless user manually closes

  3. Example:
    - User goal: $200
    - Alpha calculates: TP1 = $90 (safe zone, high probability)
                       TP2 = $160 (what market is likely to give)
    - When progress hits $90: TP1 marked, Alpha gets 0.5 points, trade continues
    - When progress hits $160: TP2 marked, Alpha gets 0.5 more points, session can complete

  4. Security:
    - All fields have sensible defaults
    - Learning awards are tracked to prevent double-counting
*/

-- Add TP1 and TP2 fields to goal_sessions table
DO $$
BEGIN
  -- TP1 Target (Conservative Safe Zone)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'tp1_target'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN tp1_target numeric DEFAULT NULL;
    COMMENT ON COLUMN goal_sessions.tp1_target IS 'Conservative target with higher probability of success - advisory milestone';
  END IF;

  -- TP2 Target (Realistic Market Target)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'tp2_target'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN tp2_target numeric DEFAULT NULL;
    COMMENT ON COLUMN goal_sessions.tp2_target IS 'Realistic target that Alpha believes market will give';
  END IF;

  -- TP1 Hit Status
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'tp1_hit'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN tp1_hit boolean DEFAULT false;
    COMMENT ON COLUMN goal_sessions.tp1_hit IS 'Whether TP1 (conservative target) has been reached';
  END IF;

  -- TP1 Hit Timestamp
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'tp1_hit_at'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN tp1_hit_at timestamptz DEFAULT NULL;
    COMMENT ON COLUMN goal_sessions.tp1_hit_at IS 'Timestamp when TP1 was achieved';
  END IF;

  -- TP1 Learning Awarded
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'tp1_learning_awarded'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN tp1_learning_awarded boolean DEFAULT false;
    COMMENT ON COLUMN goal_sessions.tp1_learning_awarded IS 'Whether Alpha received +0.5 learning credit for TP1';
  END IF;

  -- TP2 Hit Status
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'tp2_hit'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN tp2_hit boolean DEFAULT false;
    COMMENT ON COLUMN goal_sessions.tp2_hit IS 'Whether TP2 (realistic target) has been reached';
  END IF;

  -- TP2 Hit Timestamp
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'tp2_hit_at'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN tp2_hit_at timestamptz DEFAULT NULL;
    COMMENT ON COLUMN goal_sessions.tp2_hit_at IS 'Timestamp when TP2 was achieved';
  END IF;
END $$;

-- Create function to check and award TP milestones
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
  WHERE session_id = NEW.id;

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
        0.5, -- Half point for TP1
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
      0.5, -- Another half point for TP2
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

-- Create trigger to check TP milestones on session updates
DROP TRIGGER IF EXISTS check_tp_milestones_trigger ON goal_sessions;
CREATE TRIGGER check_tp_milestones_trigger
  BEFORE UPDATE ON goal_sessions
  FOR EACH ROW
  WHEN (OLD.current_progress IS DISTINCT FROM NEW.current_progress)
  EXECUTE FUNCTION check_and_award_tp_milestones();

-- Create index for faster TP queries
CREATE INDEX IF NOT EXISTS idx_goal_sessions_tp_status
  ON goal_sessions(tp1_hit, tp2_hit, status)
  WHERE status IN ('scanning', 'awaiting_entry', 'in_trade');

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION check_and_award_tp_milestones() TO authenticated;