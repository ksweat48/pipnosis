/*
  # CCIP Fix: Session lifecycle trigger incorrectly blocks closure when tp2_target is NULL

  ## Root Cause
  enforce_tp1_tp2_session_lifecycle blocks session closure when:
    tp1_hit = true AND tp2_hit = false
  But does NOT check whether tp2_target IS NULL.
  When there is no TP2 target, TP1 is the final milestone — blocking closure is wrong.

  ## Fix
  Add tp2_target IS NOT NULL guard to the block condition.
  If tp2_target is NULL, allow the session to close normally.

  ## Second Fix: Direct session stop for the stuck ksweat48 session
  Session ab19015d is stuck in 'scanning' with 0 open trades and current_progress=$282
  (above tp1_target=$197, tp2_target=NULL). Force it to system_stopped now.
*/

-- Fix the lifecycle trigger to respect NULL tp2_target
CREATE OR REPLACE FUNCTION enforce_tp1_tp2_session_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_open_trades_count INTEGER;
  v_violation_reason TEXT;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status
  AND NEW.status IN ('completed', 'system_stopped', 'user_stopped', 'goal_achieved', 'expired')
  THEN
    -- Only block if BOTH conditions are true:
    --   1. TP1 was hit
    --   2. TP2 was NOT hit
    --   3. A TP2 target actually EXISTS (if tp2_target IS NULL, TP1 was the only target)
    IF NEW.tp1_hit = true AND NEW.tp2_hit = false AND NEW.tp2_target IS NOT NULL THEN

      SELECT COUNT(*) INTO v_open_trades_count
      FROM goal_session_trades
      WHERE goal_session_id = NEW.id AND status = 'open';

      IF NEW.status NOT IN ('user_stopped', 'goal_achieved') THEN

        v_violation_reason := format(
          'TP1 Advisory Violation: Session %s closing with TP1 hit but TP2 not reached. ' ||
          'Progress: $%s, TP1: $%s (done), TP2: $%s (pending). Session must continue.',
          NEW.id,
          ROUND(NEW.current_progress, 2),
          ROUND(NEW.tp1_target, 2),
          ROUND(NEW.tp2_target, 2)
        );

        INSERT INTO ssot_violations (
          violation_type, severity, component, details, detected_at
        ) VALUES (
          'tp1_premature_closure', 'critical', 'session_lifecycle',
          jsonb_build_object(
            'session_id', NEW.id,
            'user_id', NEW.user_id,
            'attempted_status', NEW.status,
            'current_progress', NEW.current_progress,
            'tp1_target', NEW.tp1_target,
            'tp2_target', NEW.tp2_target,
            'tp1_hit', NEW.tp1_hit,
            'tp2_hit', NEW.tp2_hit,
            'open_trades', v_open_trades_count,
            'violation_reason', v_violation_reason
          ),
          NOW()
        );

        IF v_open_trades_count > 0 THEN
          NEW.status := 'in_trade';
        ELSE
          NEW.status := 'scanning';
        END IF;

        NEW.completed_at := NULL;

        INSERT INTO goal_notifications (
          goal_session_id, user_id, type, priority, title, message, metadata, channels
        ) VALUES (
          NEW.id, NEW.user_id, 'progress', 'critical', 'TP1 Advisory Milestone Hit',
          format('Safe zone reached at $%s! Continuing to TP2 target of $%s ($%s away).',
            ROUND(NEW.current_progress, 2),
            ROUND(NEW.tp2_target, 2),
            ROUND(NEW.tp2_target - NEW.current_progress, 2)
          ),
          jsonb_build_object(
            'session_id', NEW.id,
            'tp1_target', NEW.tp1_target,
            'tp2_target', NEW.tp2_target,
            'current_progress', NEW.current_progress,
            'advisory_only', true
          ),
          ARRAY['in_app', 'push']
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Force-close the stuck session: 0 open trades, tp2_target=NULL, current_progress > tp1_target
DO $$
BEGIN
  UPDATE goal_sessions
  SET
    status = 'system_stopped',
    completed_at = now(),
    updated_at = now(),
    closing_state = 'idle'
  WHERE id = 'ab19015d-f077-426d-976f-755a48792ec3'
  AND status NOT IN ('completed', 'user_stopped', 'system_stopped', 'goal_achieved', 'cancelled');

  IF FOUND THEN
    RAISE NOTICE '[FIX] Session ab19015d transitioned to system_stopped.';
  ELSE
    RAISE NOTICE '[FIX] Session ab19015d already in terminal state — no action needed.';
  END IF;
END $$;
