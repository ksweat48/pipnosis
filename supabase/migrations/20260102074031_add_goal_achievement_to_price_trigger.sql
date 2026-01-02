/*
  # Add Goal Achievement Detection to Price Trigger

  ## Problem
  Goal achievement only triggers when trades are closed, but users expect:
  1. Goal achievement dialog when unrealized profit exceeds target
  2. Auto-close at user's goal target even if TP is higher

  ## Solution
  Enhance the realtime_prices INSERT trigger to:
  1. Update current_pnl for all open positions (keeps UI in sync)
  2. Check if cumulative_profit + unrealized_pnl >= goal target
  3. If goal achieved, trigger achievement flow and optionally close trade

  ## Changes
  1. New function: calculate_position_pnl() - calculates P&L using SSOT formula
  2. Update: check_and_close_positions_on_price_update() - adds goal achievement logic
  3. New function: trigger_goal_achievement() - handles achievement flow

  ## Important
  - Goal achievement triggers on UNREALIZED profit (total progress >= target)
  - Creates persistent modal for achievement screen
  - Auto-closes trade at goal target price if user profit exceeds goal
*/

-- 1. Create helper function to calculate position P&L (matches SSOT formula)
CREATE OR REPLACE FUNCTION calculate_position_pnl(
  p_symbol TEXT,
  p_direction TEXT,
  p_entry_price NUMERIC,
  p_current_price NUMERIC,
  p_lot_size NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_price_diff NUMERIC;
  v_pip_value NUMERIC;
  v_pnl NUMERIC;
BEGIN
  v_price_diff := p_current_price - p_entry_price;

  -- Calculate P&L based on instrument type (SSOT formula)
  IF p_symbol LIKE '%JPY%' THEN
    -- JPY pairs: 0.01 = 1 pip, $1000 per 1.0 lot
    v_pip_value := (v_price_diff / 0.01) * (p_lot_size * 1000);
  ELSIF p_symbol IN ('US30', 'NAS100', 'SPX500', 'DJI', 'NDX') 
    OR p_symbol LIKE 'US30%' 
    OR p_symbol LIKE 'NAS100%' 
    OR p_symbol LIKE 'SPX500%' THEN
    -- Indices: 1 point = 1 pip, $1 per 1.0 lot
    v_pip_value := v_price_diff * p_lot_size;
  ELSIF p_symbol LIKE '%XAU%' OR p_symbol LIKE '%GOLD%' THEN
    -- Gold: 0.01 = 1 pip, $100 per 1.0 lot
    v_pip_value := (v_price_diff / 0.01) * (p_lot_size * 100);
  ELSIF p_symbol LIKE '%BTC%' OR p_symbol LIKE '%ETH%' OR p_symbol LIKE '%CRYPTO%' THEN
    -- Crypto: Direct price difference, $1 per 1.0 contract
    v_pip_value := v_price_diff * p_lot_size;
  ELSE
    -- Standard Forex: 0.0001 = 1 pip, $10 per 1.0 lot
    v_pip_value := (v_price_diff / 0.0001) * (p_lot_size * 10);
  END IF;

  -- Apply direction
  IF p_direction = 'buy' THEN
    v_pnl := v_pip_value;
  ELSE
    v_pnl := -v_pip_value;
  END IF;

  RETURN ROUND(v_pnl, 2);
END;
$$;

-- 2. Create function to handle goal achievement
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
  UPDATE goal_sessions
  SET 
    status = 'goal_achieved',
    goal_achieved_at = NOW(),
    cumulative_profit = p_final_pnl,
    progress_percentage = (p_final_pnl / p_target_amount) * 100,
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

-- 3. Enhanced price trigger with goal achievement detection
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

          -- Update session progress
          UPDATE goal_sessions
          SET 
            cumulative_profit = v_closed_trades_pnl,
            progress_percentage = (v_total_session_pnl / v_goal_target) * 100,
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

COMMENT ON FUNCTION check_and_close_positions_on_price_update() IS
  'Enhanced trigger that handles SL/TP closures AND goal achievement detection. Updates position P&L on every price tick and triggers goal achievement when total session progress >= target.';

COMMENT ON FUNCTION trigger_goal_achievement(UUID, UUID, UUID, NUMERIC, NUMERIC, NUMERIC, TEXT) IS
  'Handles goal achievement flow: creates achievement record, updates session status, creates persistent modal, and sends notifications.';

COMMENT ON FUNCTION calculate_position_pnl(TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC) IS
  'Single source of truth for P&L calculation. Matches the formula used in close_goal_session_trade.';
