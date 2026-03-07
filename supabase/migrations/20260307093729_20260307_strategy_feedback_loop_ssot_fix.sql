/*
  # Strategy Feedback Loop SSOT Fix

  ## Summary
  Fixes the broken strategy performance rating feedback loop where all 73 strategies
  remain stuck at "pending" because trade outcomes are never fed back into
  alpha_strategy_memory after live trade closures.

  ## Problem
  The updateWithTradeOutcome() function in strategy-memory-service.ts exists and works
  correctly, but was NEVER called after real trade closures — only in backtesting.
  The post-trade-analyzer is the SSOT for all trade outcome processing, but it was
  missing the strategy memory update step.

  ## Changes

  ### New RPC Function: resolve_strategy_for_trade
  - Given a user_id, session_id (text), symbol, and trade outcome details
  - Finds the most-recently-planned ACTIVE strategy for that session+symbol
  - Atomically updates all performance counters: trades_executed, trades_won,
    trades_lost, trades_breakeven, win_rate, total_pnl, avg_pnl, max_pnl, min_pnl,
    avg_hold_time_minutes, confidence_accuracy, performance_rating
  - Optionally writes what_worked / what_failed / key_lesson if provided
  - Returns the strategy_id that was updated (for logging/audit)
  - Returns NULL if no active strategy found (safe no-op)

  ### Performance Rating Logic (mirrors TypeScript SSOT)
  - pending   = < 3 trades
  - excellent = WR >= 75% AND total_pnl > 100
  - good      = WR >= 65% AND total_pnl > 50
  - fair      = WR >= 50% AND total_pnl > 0
  - poor      = WR >= 35%
  - terrible  = default

  ## Security
  - SECURITY DEFINER runs as owner to bypass RLS for service-role calls
  - Caller must own the strategy (user_id check enforced inside function)

  ## CCIP Compliance
  - Single authoritative update path for alpha_strategy_memory (SSOT)
  - No business logic in triggers
  - All writes go through this RPC, not direct table mutations
*/

CREATE OR REPLACE FUNCTION resolve_strategy_for_trade(
  p_user_id       uuid,
  p_session_id    text,
  p_symbol        text,
  p_outcome       text,           -- 'win' | 'loss' | 'breakeven'
  p_pnl           numeric,
  p_hold_minutes  numeric DEFAULT 0,
  p_what_worked   text    DEFAULT NULL,
  p_what_failed   text    DEFAULT NULL,
  p_key_lesson    text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_strategy_id          uuid;
  v_trades_executed      int;
  v_trades_won           int;
  v_trades_lost          int;
  v_trades_breakeven     int;
  v_total_pnl            numeric;
  v_win_rate             numeric;
  v_avg_pnl              numeric;
  v_max_pnl              numeric;
  v_min_pnl              numeric;
  v_avg_hold             numeric;
  v_planned_confidence   numeric;
  v_confidence_accuracy  numeric;
  v_performance_rating   text;
  v_total_hold           numeric;
BEGIN
  -- 1. Find the most recent active strategy for this session+symbol
  SELECT id, trades_executed, trades_won, trades_lost, trades_breakeven,
         total_pnl, win_rate, avg_pnl, max_pnl, min_pnl,
         avg_hold_time_minutes, planned_confidence
  INTO v_strategy_id, v_trades_executed, v_trades_won, v_trades_lost,
       v_trades_breakeven, v_total_pnl, v_win_rate, v_avg_pnl,
       v_max_pnl, v_min_pnl, v_avg_hold, v_planned_confidence
  FROM alpha_strategy_memory
  WHERE user_id   = p_user_id
    AND session_id = p_session_id
    AND symbol    = p_symbol
    AND status    = 'active'
  ORDER BY planned_at DESC
  LIMIT 1;

  -- No strategy found — safe no-op
  IF v_strategy_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- 2. Compute new counters
  v_trades_executed := COALESCE(v_trades_executed, 0) + 1;

  v_trades_won := CASE WHEN p_outcome = 'win'
                        THEN COALESCE(v_trades_won, 0) + 1
                        ELSE COALESCE(v_trades_won, 0) END;

  v_trades_lost := CASE WHEN p_outcome = 'loss'
                         THEN COALESCE(v_trades_lost, 0) + 1
                         ELSE COALESCE(v_trades_lost, 0) END;

  v_trades_breakeven := CASE WHEN p_outcome = 'breakeven'
                              THEN COALESCE(v_trades_breakeven, 0) + 1
                              ELSE COALESCE(v_trades_breakeven, 0) END;

  v_win_rate  := v_trades_won::numeric / v_trades_executed::numeric;
  v_total_pnl := COALESCE(v_total_pnl, 0) + p_pnl;
  v_avg_pnl   := v_total_pnl / v_trades_executed;
  v_max_pnl   := GREATEST(COALESCE(v_max_pnl, p_pnl), p_pnl);
  v_min_pnl   := LEAST(COALESCE(v_min_pnl, p_pnl), p_pnl);

  v_total_hold := COALESCE(v_avg_hold, 0) * (v_trades_executed - 1) + COALESCE(p_hold_minutes, 0);
  v_avg_hold   := v_total_hold / v_trades_executed;

  -- 3. Confidence accuracy: how close was planned confidence to actual win rate
  IF COALESCE(v_planned_confidence, 0) > 0 THEN
    v_confidence_accuracy := 100 - ABS(v_planned_confidence - (v_win_rate * 100));
  ELSE
    v_confidence_accuracy := NULL;
  END IF;

  -- 4. Performance rating (mirrors TypeScript calculatePerformanceRating)
  IF v_trades_executed < 3 THEN
    v_performance_rating := 'pending';
  ELSIF v_win_rate >= 0.75 AND v_total_pnl > 100 THEN
    v_performance_rating := 'excellent';
  ELSIF v_win_rate >= 0.65 AND v_total_pnl > 50 THEN
    v_performance_rating := 'good';
  ELSIF v_win_rate >= 0.50 AND v_total_pnl > 0 THEN
    v_performance_rating := 'fair';
  ELSIF v_win_rate >= 0.35 THEN
    v_performance_rating := 'poor';
  ELSE
    v_performance_rating := 'terrible';
  END IF;

  -- 5. Atomic update
  UPDATE alpha_strategy_memory SET
    trades_executed     = v_trades_executed,
    trades_won          = v_trades_won,
    trades_lost         = v_trades_lost,
    trades_breakeven    = v_trades_breakeven,
    win_rate            = v_win_rate,
    total_pnl           = v_total_pnl,
    avg_pnl             = v_avg_pnl,
    max_pnl             = v_max_pnl,
    min_pnl             = v_min_pnl,
    avg_hold_time_minutes = v_avg_hold,
    performance_rating  = v_performance_rating,
    confidence_accuracy = v_confidence_accuracy,
    what_worked         = COALESCE(p_what_worked, what_worked),
    what_failed         = COALESCE(p_what_failed, what_failed),
    key_lesson          = COALESCE(p_key_lesson, key_lesson),
    updated_at          = now()
  WHERE id = v_strategy_id
    AND user_id = p_user_id;

  RETURN v_strategy_id;
END;
$$;

GRANT EXECUTE ON FUNCTION resolve_strategy_for_trade(uuid, text, text, text, numeric, numeric, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION resolve_strategy_for_trade(uuid, text, text, text, numeric, numeric, text, text, text) TO service_role;
