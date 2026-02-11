/*
  # Fix club_token_balance sync logic (CCIP-CLUB-TOKEN-SYNC-20260211-HOTFIX)

  ## Summary
  The previous sync function incorrectly summed ALL ledger entries including negative "membership_lock" entries.
  This caused total_tokens to be calculated as 6,850 instead of 16,850.

  ## Root Cause
  - membership_lock entries with negative amounts (-10,000) were being included in the sum
  - These entries represent a state change (liquid → locked), not a debit from total tokens
  - total_tokens should only include positive grant/reward entries

  ## Fix
  - Update sync function to only sum positive amounts (grants, rewards, purchases)
  - Exclude negative lock/unlock entries from total calculation
  - Preserve locked_tokens as separate state managed by membership system

  ## Expected Result
  - ksweat48: total_tokens = 16,850 (10,000 + 6,850 bonuses)
  - ksweat48: locked_tokens = 10,000 (unchanged)
  - ksweat48: available_tokens = 6,850 (auto-calculated)
*/

-- ============================================================================
-- Fix sync function to only sum positive transactions
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_club_token_balance_from_ledger(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ledger_total numeric;
  v_current_locked numeric;
BEGIN
  -- Calculate total from ledger (SSOT) - ONLY POSITIVE AMOUNTS
  -- Negative amounts are state changes (locks/unlocks), not debits from total
  SELECT COALESCE(SUM(amount), 0)
  INTO v_ledger_total
  FROM club_token_ledger
  WHERE user_id = p_user_id
    AND amount > 0; -- CRITICAL FIX: Only sum positive grant/reward entries

  -- Get current locked amount (preserve locking state)
  SELECT COALESCE(locked_tokens, 0)
  INTO v_current_locked
  FROM club_token_balances
  WHERE user_id = p_user_id;

  -- Update or insert balance
  INSERT INTO club_token_balances (
    user_id,
    total_tokens,
    locked_tokens,
    lifetime_earned,
    updated_at
  )
  VALUES (
    p_user_id,
    v_ledger_total,
    v_current_locked,
    v_ledger_total,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    total_tokens = v_ledger_total,
    lifetime_earned = GREATEST(club_token_balances.lifetime_earned, v_ledger_total),
    updated_at = now();

  RAISE NOTICE 'Synced balance for user %: ledger_total=% (positive entries only), locked=%', 
    p_user_id, v_ledger_total, v_current_locked;
END;
$$;

COMMENT ON FUNCTION sync_club_token_balance_from_ledger IS 
  'SSOT function to synchronize club_token_balances from club_token_ledger. Calculates total_tokens by summing POSITIVE ledger entries only (grants/rewards). Negative entries (locks/unlocks) represent state changes, not balance debits.';

-- ============================================================================
-- Re-sync all balances with corrected logic
-- ============================================================================

DO $$
DECLARE
  v_user_record record;
  v_users_updated integer := 0;
BEGIN
  RAISE NOTICE 'Re-synchronizing club_token_balances with corrected logic...';

  -- Re-sync all users who have ledger entries
  FOR v_user_record IN
    SELECT DISTINCT user_id
    FROM club_token_ledger
  LOOP
    PERFORM sync_club_token_balance_from_ledger(v_user_record.user_id);
    v_users_updated := v_users_updated + 1;
  END LOOP;

  RAISE NOTICE 'Completed: % users re-synchronized', v_users_updated;
END;
$$;

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
DECLARE
  v_drift_count integer;
  v_ksweat_balance numeric;
  v_ksweat_available numeric;
BEGIN
  -- Check for any remaining drift
  SELECT COUNT(*)
  INTO v_drift_count
  FROM (
    SELECT
      b.user_id,
      b.total_tokens as balance_total,
      COALESCE(SUM(l.amount), 0) as ledger_total
    FROM club_token_balances b
    LEFT JOIN club_token_ledger l ON l.user_id = b.user_id AND l.amount > 0
    GROUP BY b.user_id, b.total_tokens
    HAVING b.total_tokens != COALESCE(SUM(l.amount), 0)
  ) drift_check;

  IF v_drift_count > 0 THEN
    RAISE WARNING 'Drift detected: % users have mismatched balances', v_drift_count;
  ELSE
    RAISE NOTICE 'Success: All balances match ledger (0 drift)';
  END IF;

  -- Verify ksweat's balance
  SELECT b.total_tokens, b.available_tokens
  INTO v_ksweat_balance, v_ksweat_available
  FROM club_token_balances b
  JOIN auth.users u ON u.id = b.user_id
  WHERE u.email = 'ksweat48@gmail.com';

  RAISE NOTICE 'ksweat48 balance verification: total=%, available=%', 
    v_ksweat_balance, v_ksweat_available;

  IF v_ksweat_balance != 16850 THEN
    RAISE WARNING 'ksweat48 balance mismatch: expected 16850, got %', v_ksweat_balance;
  END IF;

  IF v_ksweat_available != 6850 THEN
    RAISE WARNING 'ksweat48 available mismatch: expected 6850, got %', v_ksweat_available;
  END IF;
END;
$$;

-- ============================================================================
-- Log corrected governance change
-- ============================================================================

DO $$
DECLARE
  v_ksweat_user_id uuid;
  v_new_balance numeric;
BEGIN
  -- Get ksweat's user_id
  SELECT id INTO v_ksweat_user_id
  FROM auth.users
  WHERE email = 'ksweat48@gmail.com';

  IF v_ksweat_user_id IS NOT NULL THEN
    -- Get new balance
    SELECT b.total_tokens
    INTO v_new_balance
    FROM club_token_balances b
    WHERE b.user_id = v_ksweat_user_id;

    -- Log the correction
    INSERT INTO governance_change_log (
      entity_type,
      entity_id,
      operation,
      old_value,
      new_value,
      reason,
      metadata
    )
    VALUES (
      'club_token_balances',
      v_ksweat_user_id,
      'balance_update',
      jsonb_build_object('total_tokens', 6850, 'calculation_method', 'sum_all_entries'),
      jsonb_build_object('total_tokens', v_new_balance, 'calculation_method', 'sum_positive_only'),
      'CCIP-CLUB-TOKEN-SYNC-20260211-HOTFIX: Corrected sync logic to exclude negative lock entries from total calculation.',
      jsonb_build_object(
        'ccip_id', 'CCIP-CLUB-TOKEN-SYNC-20260211-HOTFIX',
        'migration', '20260211_fix_club_token_sync_logic',
        'issue', 'negative_lock_entries_reducing_total',
        'fix', 'only_sum_positive_grant_entries',
        'expected_total', 16850,
        'expected_available', 6850
      )
    );

    RAISE NOTICE 'Hotfix governance change logged: 6850 → %', v_new_balance;
  END IF;
END;
$$;
