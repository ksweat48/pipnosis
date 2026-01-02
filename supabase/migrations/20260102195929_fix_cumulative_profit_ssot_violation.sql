/*
  # Fix SSOT Violation: Use current_progress Instead of cumulative_profit

  ## Problem
  Recent migration introduced `cumulative_profit` column references, but:
  1. The column doesn't exist in the database schema
  2. `current_progress` is the established SSOT for profit tracking (85+ references)
  3. This creates confusion and potential bugs

  ## Solution
  Fix the trigger functions to use `current_progress` instead of `cumulative_profit`:
  1. Update trigger_goal_achievement() function
  2. Update check_and_close_positions_on_price_update() function

  ## Changes
  - Modified trigger_goal_achievement() to write to current_progress
  - Modified check_and_close_positions_on_price_update() to write to current_progress
  - Added documentation clarifying current_progress is the SSOT

  ## Important
  - current_progress = dollar amount of realized profit (SSOT)
  - progress_percentage = derived percentage (calculated from current_progress / target_value * 100)
  - This maintains architectural stability with 85+ existing references
*/

-- 1. Fix trigger_goal_achievement() to use current_progress (SSOT)
CREATE OR REPLACE FUNCTION trigger_goal_achievement(
  p_session_id UUID,
  p_user_id UUID,
  p_trade_id UUID,
  p_final_pnl NUMERIC,
  p_target_amount NUMERIC,
  p_current_price NUMERIC,
  p_symbol TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_achievement UUID;
  v_achievement_id UUID;
BEGIN
  -- Check if achievement already exists
  SELECT id INTO v_existing_achievement
  FROM goal_achievements
  WHERE goal_session_id = p_session_id;

  IF v_existing_achievement IS NOT NULL THEN
    RETURN FALSE; -- Already achieved
  END IF;

  -- Create achievement record
  INSERT INTO goal_achievements (
    user_id,
    goal_session_id,
    achieved_at,
    achieved_pnl,
    target_amount,
    final_pnl
  ) VALUES (
    p_user_id,
    p_session_id,
    NOW(),
    p_final_pnl,
    p_target_amount,
    p_final_pnl
  )
  RETURNING id INTO v_achievement_id;

  -- Update session status to goal_achieved
  -- CRITICAL: Use current_progress (SSOT) not cumulative_profit
  UPDATE goal_sessions
  SET
    status = 'goal_achieved',
    goal_achieved_at = NOW(),
    current_progress = p_final_pnl,  -- SSOT: dollar amount of profit
    progress_percentage = (p_final_pnl / p_target_amount) * 100,  -- Derived value
    completed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_session_id;

  -- Mark trade with goal achievement info
  UPDATE goal_session_trades
  SET
    goal_met_at = NOW(),
    goal_met_price = p_current_price,
    unrealized_goal_achievement = TRUE,
    updated_at = NOW()
  WHERE id = p_trade_id;

  -- Create persistent modal for goal achievement screen
  INSERT INTO persistent_modals (
    user_id,
    modal_type,
    priority,
    metadata,
    expires_at
  ) VALUES (
    p_user_id,
    'goal_achieved',
    100,
    jsonb_build_object(
      'session_id', p_session_id,
      'achievement_id', v_achievement_id,
      'final_pnl', p_final_pnl,
      'target_amount', p_target_amount,
      'progress_percent', (p_final_pnl / p_target_amount) * 100,
      'symbol', p_symbol,
      'triggered_by', 'database_trigger',
      'triggered_at', NOW()
    ),
    NOW() + INTERVAL '24 hours'
  );

  -- Create notification
  INSERT INTO goal_notifications (
    goal_session_id,
    user_id,
    type,
    priority,
    title,
    message,
    metadata,
    channels
  ) VALUES (
    p_session_id,
    p_user_id,
    'goal_achieved',
    'urgent',
    'Goal Achieved!',
    format('Congratulations! You reached your $%s goal with $%s profit!',
      ROUND(p_target_amount, 2), ROUND(p_final_pnl, 2)),
    jsonb_build_object(
      'session_id', p_session_id,
      'achievement_id', v_achievement_id,
      'final_pnl', p_final_pnl,
      'target_amount', p_target_amount,
      'triggered_by', 'database_trigger'
    ),
    ARRAY['in_app', 'push']
  );

  RAISE NOTICE '[GOAL ACHIEVED] Session % achieved $% target with $% profit',
    p_session_id, p_target_amount, p_final_pnl;

  RETURN TRUE;
END;
$$;

-- 2. Fix check_and_close_positions_on_price_update() to use current_progress (SSOT)
CREATE OR REPLACE FUNCTION check_and_close_positions_on_price_update()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_position RECORD;
  v_session RECORD;
  v_current_price NUMERIC;
  v_calculated_pnl NUMERIC;
  v_should_close_at_sl BOOLEAN;
  v_should_close_at_tp BOOLEAN;
  v_close_reason TEXT;
  v_close_price NUMERIC;
  v_error_message TEXT;
  v_total_session_pnl NUMERIC;
  v_goal_target NUMERIC;
  v_closed_trades_pnl NUMERIC;
  v_goal_achieved BOOLEAN;
BEGIN
  -- Only process INSERT operations
  IF TG_OP != 'INSERT' THEN
    RETURN NEW;
  END IF;

  -- Find all open positions for this symbol
  FOR v_position IN
    SELECT *
    FROM goal_session_trades
    WHERE symbol = NEW.symbol
      AND status = 'open'
      AND stop_loss IS NOT NULL
      AND take_profit IS NOT NULL
  LOOP
    BEGIN
      -- Determine current price based on direction
      IF v_position.direction = 'buy' THEN
        v_current_price := NEW.bid::numeric;
      ELSE
        v_current_price := NEW.ask::numeric;
      END IF;

      -- Calculate current P&L using SSOT formula
      v_calculated_pnl := calculate_position_pnl(
        v_position.symbol,
        v_position.direction,
        v_position.entry_price,
        v_current_price,
        COALESCE(v_position.lot_size, v_position.position_size, 0.01)
      );

      -- Update position with current price and P&L (keeps UI in sync)
      UPDATE goal_session_trades
      SET
        current_price = v_current_price,
        current_pnl = v_calculated_pnl,
        updated_at = NOW()
      WHERE id = v_position.id;

      -- Get session info for goal checking
      IF v_position.goal_session_id IS NOT NULL THEN
        SELECT
          gs.*,
          CASE
            WHEN jsonb_typeof(goal_amount::jsonb) = 'object'
            THEN (goal_amount::jsonb->>'amount')::numeric
            ELSE goal_amount::numeric
          END as target_value
        INTO v_session
        FROM goal_sessions gs
        WHERE id = v_position.goal_session_id
          AND status NOT IN ('goal_achieved', 'completed', 'expired', 'failed');

        IF v_session IS NOT NULL THEN
          v_goal_target := v_session.target_value;

          -- Calculate total session P&L (closed trades + current unrealized)
          SELECT COALESCE(SUM(profit_loss), 0) INTO v_closed_trades_pnl
          FROM goal_session_trades
          WHERE goal_session_id = v_position.goal_session_id
            AND status = 'closed';

          v_total_session_pnl := v_closed_trades_pnl + v_calculated_pnl;

          -- CRITICAL: Update current_progress (SSOT) with closed trades P&L
          -- progress_percentage is derived from current_progress
          UPDATE goal_sessions
          SET
            current_progress = v_closed_trades_pnl,  -- SSOT: realized profit only
            progress_percentage = (v_total_session_pnl / v_goal_target) * 100,  -- Derived: includes unrealized
            updated_at = NOW()
          WHERE id = v_position.goal_session_id;

          -- CRITICAL: Check if goal is achieved (including unrealized P&L)
          IF v_total_session_pnl >= v_goal_target AND v_session.goal_achieved_at IS NULL THEN
            RAISE NOTICE '[GOAL CHECK] Session % total P&L $% >= target $%',
              v_position.goal_session_id, v_total_session_pnl, v_goal_target;

            -- Trigger goal achievement
            v_goal_achieved := trigger_goal_achievement(
              v_position.goal_session_id,
              v_position.user_id,
              v_position.id,
              v_total_session_pnl,
              v_goal_target,
              v_current_price,
              v_position.symbol
            );

            IF v_goal_achieved THEN
              -- Close the trade at goal achievement
              v_close_reason := 'goal_achieved';
              v_close_price := v_current_price;

              PERFORM close_goal_session_trade(
                v_position.id,
                v_close_price,
                v_close_reason,
                v_position.goal_session_id
              );

              -- Skip SL/TP check since we closed for goal
              CONTINUE;
            END IF;
          END IF;
        END IF;
      END IF;

      -- Check if SL or TP should trigger
      IF v_position.direction = 'buy' THEN
        v_should_close_at_sl := v_current_price <= v_position.stop_loss;
        v_should_close_at_tp := v_current_price >= v_position.take_profit;
      ELSE
        v_should_close_at_sl := v_current_price >= v_position.stop_loss;
        v_should_close_at_tp := v_current_price <= v_position.take_profit;
      END IF;

      -- Close position if SL or TP triggered
      IF v_should_close_at_sl THEN
        v_close_reason := 'stop_loss';
        v_close_price := v_position.stop_loss;

        RAISE NOTICE '[DB TRIGGER] Closing position % at SL: % (current: %, symbol: %)',
          v_position.id, v_close_price, v_current_price, v_position.symbol;

        PERFORM close_goal_session_trade(
          v_position.id,
          v_close_price,
          v_close_reason,
          v_position.goal_session_id
        );

        INSERT INTO goal_notifications (
          goal_session_id, user_id, type, priority, title, message, metadata, channels
        ) VALUES (
          v_position.goal_session_id,
          v_position.user_id,
          'trade_closed',
          'urgent',
          'Stop Loss Hit',
          format('Database trigger closed %s at stop loss. Price: %s', v_position.symbol, v_close_price),
          jsonb_build_object(
            'trade_id', v_position.id,
            'symbol', v_position.symbol,
            'close_price', v_close_price,
            'current_price', v_current_price,
            'closed_by', 'database_trigger',
            'trigger_time', NOW()
          ),
          ARRAY['in_app', 'push']
        );

      ELSIF v_should_close_at_tp THEN
        v_close_reason := 'take_profit';
        v_close_price := v_position.take_profit;

        RAISE NOTICE '[DB TRIGGER] Closing position % at TP: % (current: %, symbol: %)',
          v_position.id, v_close_price, v_current_price, v_position.symbol;

        PERFORM close_goal_session_trade(
          v_position.id,
          v_close_price,
          v_close_reason,
          v_position.goal_session_id
        );

        INSERT INTO goal_notifications (
          goal_session_id, user_id, type, priority, title, message, metadata, channels
        ) VALUES (
          v_position.goal_session_id,
          v_position.user_id,
          'trade_closed',
          'high',
          'Take Profit Hit!',
          format('Database trigger closed %s at take profit. Price: %s', v_position.symbol, v_close_price),
          jsonb_build_object(
            'trade_id', v_position.id,
            'symbol', v_position.symbol,
            'close_price', v_close_price,
            'current_price', v_current_price,
            'closed_by', 'database_trigger',
            'trigger_time', NOW()
          ),
          ARRAY['in_app', 'push']
        );
      END IF;

    EXCEPTION
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;

        RAISE WARNING '[DB TRIGGER] Failed to process position %: %', v_position.id, v_error_message;

        INSERT INTO goal_notifications (
          goal_session_id, user_id, type, priority, title, message, metadata, channels
        ) VALUES (
          v_position.goal_session_id,
          v_position.user_id,
          'system_alert',
          'urgent',
          'Position Processing Error',
          format('Failed to process %s: %s', v_position.symbol, v_error_message),
          jsonb_build_object(
            'trade_id', v_position.id,
            'symbol', v_position.symbol,
            'error', v_error_message,
            'current_price', v_current_price
          ),
          ARRAY['in_app']
        );
    END;
  END LOOP;

  RETURN NEW;
END;
$$;

-- Add documentation comments
COMMENT ON FUNCTION trigger_goal_achievement(UUID, UUID, UUID, NUMERIC, NUMERIC, NUMERIC, TEXT) IS
  'Handles goal achievement flow using current_progress as SSOT. Updates session status, creates achievement record, persistent modal, and sends notifications. IMPORTANT: current_progress stores the dollar amount of realized profit.';

COMMENT ON FUNCTION check_and_close_positions_on_price_update() IS
  'Enhanced trigger that handles SL/TP closures AND goal achievement detection. Updates position P&L and current_progress (SSOT) on every price tick. Triggers goal achievement when total session progress >= target. IMPORTANT: current_progress = realized profit, progress_percentage = (realized + unrealized) / target * 100.';

COMMENT ON COLUMN goal_sessions.current_progress IS
  'SINGLE SOURCE OF TRUTH for realized profit in dollars. This is the authoritative field for tracking profit progress. Use this field for all profit calculations and queries. progress_percentage is derived from this value.';

COMMENT ON COLUMN goal_sessions.progress_percentage IS
  'Derived percentage value calculated as (current_progress / target_value * 100). This is NOT a source of truth - it is calculated from current_progress. Always update current_progress and let the system recalculate this value.';