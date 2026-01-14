/*
  ═══════════════════════════════════════════════════════════════════════════
  EMERGENCY: RECALCULATE ALL USER BALANCES FROM SSOT
  ═══════════════════════════════════════════════════════════════════════════

  ## Critical Issue
  User balances are massively corrupted due to the 10,000x US30 pip bug:
  - ksweat48@gmail.com: Balance shows -$268,583 (should be ~$5,947)
  - Many other users likely affected
  
  ## SSOT Definition
  User balance = Starting balance + SUM(all closed trade profit_loss)
  - Starting balance: $10,000 (standard for all users)
  - profit_loss column is AUTHORITATIVE for closed trades
  - Open trades don't affect balance until closed

  ## Solution
  Recalculate ALL user balances from scratch using profit_loss as SSOT.
  This is the ONLY way to restore data integrity.

  ═══════════════════════════════════════════════════════════════════════════
*/

-- Create function to recalculate a single user's balance
CREATE OR REPLACE FUNCTION recalculate_user_balance(p_user_id uuid)
RETURNS TABLE(
  user_id uuid,
  old_balance numeric,
  new_balance numeric,
  difference numeric,
  total_trades bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_old_balance numeric;
  v_total_pnl numeric;
  v_new_balance numeric;
  v_trade_count bigint;
  v_starting_balance numeric := 10000;
BEGIN
  -- Get current balance
  SELECT up.account_balance INTO v_old_balance
  FROM user_profiles up
  WHERE up.id = p_user_id;

  -- Calculate total realized P&L from closed trades
  SELECT 
    COALESCE(SUM(gst.profit_loss), 0),
    COUNT(*)
  INTO v_total_pnl, v_trade_count
  FROM goal_session_trades gst
  WHERE gst.user_id = p_user_id
    AND gst.status = 'closed';

  -- Calculate correct balance
  v_new_balance := v_starting_balance + v_total_pnl;

  -- Update user balance
  UPDATE user_profiles up
  SET 
    account_balance = v_new_balance,
    updated_at = NOW()
  WHERE up.id = p_user_id;

  -- Return results
  RETURN QUERY
  SELECT 
    p_user_id,
    v_old_balance,
    v_new_balance,
    v_new_balance - v_old_balance,
    v_trade_count;
END;
$$;

GRANT EXECUTE ON FUNCTION recalculate_user_balance(uuid) TO authenticated, service_role;

-- Recalculate ALL user balances
DO $$
DECLARE
  v_rec record;
  v_count integer := 0;
  v_total_corrected numeric := 0;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE 'RECALCULATING ALL USER BALANCES FROM SSOT';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE '';

  FOR v_rec IN 
    SELECT u.id, u.email
    FROM auth.users u
    JOIN user_profiles up ON up.id = u.id
    WHERE EXISTS (
      SELECT 1 FROM goal_session_trades t 
      WHERE t.user_id = u.id AND t.status = 'closed'
    )
    ORDER BY u.email
  LOOP
    DECLARE
      v_result record;
    BEGIN
      SELECT * INTO v_result
      FROM recalculate_user_balance(v_rec.id);
      
      -- Only log if there was a significant change
      IF ABS(v_result.difference) > 1 THEN
        v_count := v_count + 1;
        v_total_corrected := v_total_corrected + v_result.difference;
        
        RAISE NOTICE '[%] % | $% → $% (corrected $%)',
          v_count,
          v_rec.email,
          ROUND(v_result.old_balance, 2),
          ROUND(v_result.new_balance, 2),
          ROUND(v_result.difference, 2);
      END IF;
    END;
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ Recalculated % user balances', v_count;
  RAISE NOTICE '✅ Total correction: $%', ROUND(v_total_corrected, 2);
  RAISE NOTICE '✅ SSOT compliance restored';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE '';
END $$;

-- Add comment documenting SSOT
COMMENT ON FUNCTION recalculate_user_balance IS
'SSOT function to recalculate user balance from scratch.
Formula: balance = $10,000 + SUM(closed_trades.profit_loss)
Use this to fix corrupted balances.
Created: 2026-01-14 after US30 pip bug corruption.';
