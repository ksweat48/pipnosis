/*
  # Universal P&L Calculator - Single Source of Truth
  
  CRITICAL FIX: USDJPY was using 100x multiplier → now correctly uses 10x
  This fixes the bug where $190 profit showed as $21,161.82
*/

-- Drop ALL existing functions
DROP FUNCTION IF EXISTS calculate_pip_distance(text, numeric, numeric) CASCADE;
DROP FUNCTION IF EXISTS calculate_dollar_per_pip(text, numeric) CASCADE;
DROP FUNCTION IF EXISTS calculate_pnl_universal(text, text, numeric, numeric, numeric) CASCADE;
DROP FUNCTION IF EXISTS audit_and_fix_all_pnl_values() CASCADE;
DROP FUNCTION IF EXISTS close_goal_session_trade(uuid, numeric, text, uuid) CASCADE;

-- Pip Distance Calculator
CREATE FUNCTION calculate_pip_distance(p_symbol text, p_price1 numeric, p_price2 numeric)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_sym text := UPPER(p_symbol);
  v_pip numeric;
BEGIN
  IF v_sym LIKE '%JPY%' OR v_sym IN ('XAUUSD', 'XAGUSD') THEN v_pip := 0.01;
  ELSIF v_sym IN ('US30', 'NAS100', 'SPX500', 'GER40', 'UK100', 'DJI30') OR v_sym LIKE 'BTC%' OR v_sym LIKE 'ETH%' THEN v_pip := 1.0;
  ELSE v_pip := 0.0001;
  END IF;
  RETURN ABS(p_price2 - p_price1) / v_pip;
END;
$$;

-- Dollar Per Pip Calculator
CREATE FUNCTION calculate_dollar_per_pip(p_symbol text, p_lot_size numeric)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_sym text := UPPER(p_symbol);
  v_mult numeric;
BEGIN
  IF p_lot_size <= 0 THEN RAISE EXCEPTION 'Invalid lot size'; END IF;
  IF v_sym LIKE '%JPY%' THEN v_mult := 10;  -- CRITICAL FIX: 10x not 1000x!
  ELSIF v_sym IN ('XAUUSD', 'XAGUSD', 'US30', 'NAS100', 'SPX500', 'GER40', 'UK100', 'DJI30') THEN v_mult := 100;
  ELSIF v_sym LIKE 'BTC%' OR v_sym LIKE 'ETH%' THEN v_mult := 1;
  ELSE v_mult := 10;
  END IF;
  RETURN p_lot_size * v_mult;
END;
$$;

-- Universal P&L Calculator (SINGLE SOURCE OF TRUTH)
CREATE FUNCTION calculate_pnl_universal(p_symbol text, p_direction text, p_entry_price numeric, p_exit_price numeric, p_lot_size numeric)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_pips numeric;
  v_dpp numeric;
  v_diff numeric;
BEGIN
  v_pips := calculate_pip_distance(p_symbol, p_entry_price, p_exit_price);
  v_dpp := calculate_dollar_per_pip(p_symbol, p_lot_size);
  v_diff := CASE WHEN p_direction = 'buy' THEN p_exit_price - p_entry_price ELSE p_entry_price - p_exit_price END;
  RETURN ROUND(CASE WHEN v_diff >= 0 THEN v_pips * v_dpp ELSE -v_pips * v_dpp END, 2);
END;
$$;

-- Close Trade Function
CREATE FUNCTION close_goal_session_trade(p_trade_id uuid, p_close_price numeric, p_close_reason text DEFAULT 'manual', p_goal_session_id uuid DEFAULT NULL)
RETURNS SETOF goal_session_trades SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
DECLARE v_trade goal_session_trades; v_pnl numeric; v_bal numeric;
BEGIN
  IF p_goal_session_id IS NOT NULL THEN
    SELECT * INTO v_trade FROM goal_session_trades WHERE id = p_trade_id AND goal_session_id = p_goal_session_id AND status IN ('open', 'pending', 'soft_closing');
  ELSE
    SELECT * INTO v_trade FROM goal_session_trades WHERE id = p_trade_id AND status IN ('open', 'pending', 'soft_closing');
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trade not found'; END IF;
  IF v_trade.user_id != auth.uid() AND (auth.jwt() ->> 'role') != 'service_role' THEN RAISE EXCEPTION 'Access denied'; END IF;

  v_pnl := calculate_pnl_universal(v_trade.symbol, v_trade.direction, v_trade.entry_price, p_close_price, COALESCE(v_trade.position_size, 0.01));

  UPDATE goal_session_trades SET status = 'closed', exit_price = p_close_price, closed_at = now(), close_reason = p_close_reason,
    current_price = p_close_price, profit_loss = v_pnl, current_pnl = v_pnl, updated_at = now() WHERE id = p_trade_id;

  SELECT account_balance INTO v_bal FROM user_profiles WHERE id = v_trade.user_id;
  UPDATE user_profiles SET account_balance = v_bal + v_pnl, updated_at = now() WHERE id = v_trade.user_id;

  RETURN QUERY SELECT * FROM goal_session_trades WHERE id = p_trade_id;
END;
$$;

-- Validation Trigger
CREATE OR REPLACE FUNCTION validate_and_fix_profit_loss() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE c_pnl numeric;
BEGIN
  IF NEW.status = 'closed' AND (NEW.profit_loss IS NULL OR NEW.profit_loss = 0 OR ABS(NEW.profit_loss) > 100000)
     AND NEW.entry_price IS NOT NULL AND NEW.exit_price IS NOT NULL AND NEW.entry_price != NEW.exit_price AND NEW.position_size > 0 THEN
    c_pnl := calculate_pnl_universal(NEW.symbol, NEW.direction, NEW.entry_price, NEW.exit_price, NEW.position_size);
    NEW.profit_loss := c_pnl;
    NEW.current_pnl := c_pnl;
  END IF;
  RETURN NEW;
END;
$$;

-- Audit Function
CREATE FUNCTION audit_and_fix_all_pnl_values()
RETURNS TABLE (t_id uuid, t_sym text, t_orig numeric, t_corr numeric, t_diff numeric) LANGUAGE plpgsql AS $$
DECLARE v_rec record; v_cor numeric; v_dif numeric;
BEGIN
  FOR v_rec IN
    SELECT gst.id, gst.symbol, gst.direction, gst.entry_price, gst.exit_price, gst.position_size, gst.profit_loss, gst.user_id
    FROM goal_session_trades gst
    WHERE gst.status = 'closed' AND gst.entry_price IS NOT NULL AND gst.exit_price IS NOT NULL
      AND gst.position_size > 0 AND gst.profit_loss IS NOT NULL AND gst.entry_price != gst.exit_price
  LOOP
    v_cor := calculate_pnl_universal(v_rec.symbol, v_rec.direction, v_rec.entry_price, v_rec.exit_price, v_rec.position_size);
    v_dif := v_cor - v_rec.profit_loss;

    IF ABS(v_dif) > 10 OR (v_rec.profit_loss != 0 AND ABS(v_dif / v_rec.profit_loss * 100) > 10) THEN
      UPDATE goal_session_trades SET profit_loss = v_cor, current_pnl = v_cor WHERE id = v_rec.id;
      UPDATE user_profiles SET account_balance = account_balance + v_dif WHERE id = v_rec.user_id;
      RETURN QUERY SELECT v_rec.id, v_rec.symbol, v_rec.profit_loss, v_cor, v_dif;
    END IF;
  END LOOP;
END;
$$;

-- Grants
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;

-- Run Audit NOW
DO $$
DECLARE v_r record; v_cnt integer := 0;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '  FIXING P&L CALCULATION BUG FOR ALL TRADES';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  FOR v_r IN SELECT * FROM audit_and_fix_all_pnl_values() LOOP
    v_cnt := v_cnt + 1;
    RAISE NOTICE '[%] % | $% → $% (adjusted $%)', v_cnt, v_r.t_sym, ROUND(v_r.t_orig, 2), ROUND(v_r.t_corr, 2), ROUND(v_r.t_diff, 2);
  END LOOP;
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '✓ COMPLETE: % trades corrected, balances updated', v_cnt;
  RAISE NOTICE '════════════════════════════════════════════════════════';
END $$;
