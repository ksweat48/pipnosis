/*
  # Award Retroactive Cumulative Bonuses to Founder Member

  1. Purpose
    - Awards missing cumulative tier bonuses (Tiers 1-5) to existing Founder member (ksweat48@gmail.com)
    - Adds 6,850 PIP tokens as available balance (not locked)
    - Creates tier history records for audit trail
    - Updates token ledger with bonus award transactions

  2. Calculation
    - Tier 1 (Member): 100 tokens
    - Tier 2 (Starter): 250 tokens  
    - Tier 3 (Builder): 500 tokens
    - Tier 4 (Trader): 1,000 tokens
    - Tier 5 (Elite): 5,000 tokens
    - Total bonus: 6,850 tokens

  3. Changes
    - Inserts tier history records for Tiers 1-5
    - Creates token ledger entries for each bonus award
    - Does NOT modify locked balance (remains 10,000)
    - Adds 6,850 to available balance
    - Updates cumulative_tokens_awarded to 16,850

  4. Security
    - Admin-only operation
    - Idempotent (checks if bonuses already awarded)
    - Full audit trail via tier history and ledger
*/

DO $$
DECLARE
  v_user_id uuid;
  v_membership_id uuid;
  v_current_tier integer;
  v_tier_bonuses integer[] := ARRAY[100, 250, 500, 1000, 5000];
  v_tier_names text[] := ARRAY['Member', 'Starter', 'Builder', 'Trader', 'Elite'];
  v_tier integer;
  v_bonus_amount integer;
  v_tier_name text;
  v_running_balance numeric := 0;
BEGIN
  -- Get user ID for ksweat48@gmail.com
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = 'ksweat48@gmail.com';

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User ksweat48@gmail.com not found';
  END IF;

  -- Get active membership
  SELECT id, tier_level INTO v_membership_id, v_current_tier
  FROM club_memberships
  WHERE user_id = v_user_id
    AND status = 'active'
  LIMIT 1;

  IF v_membership_id IS NULL THEN
    RAISE EXCEPTION 'No active membership found for user';
  END IF;

  RAISE NOTICE 'Processing retroactive bonuses for user % (tier %)', v_user_id, v_current_tier;

  -- Get current ledger balance
  SELECT COALESCE(SUM(amount), 0) INTO v_running_balance
  FROM club_token_ledger
  WHERE user_id = v_user_id;

  -- Award bonuses for tiers 1-5 (all below Founder tier 6)
  FOR v_tier IN 1..5 LOOP
    v_bonus_amount := v_tier_bonuses[v_tier];
    v_tier_name := v_tier_names[v_tier];

    -- Check if tier history already exists (idempotency)
    IF NOT EXISTS (
      SELECT 1 FROM club_membership_tier_history
      WHERE membership_id = v_membership_id
        AND tier_level = v_tier
    ) THEN
      -- Insert tier history record
      INSERT INTO club_membership_tier_history (
        user_id,
        membership_id,
        tier_level,
        tier_name,
        tokens_awarded,
        awarded_at
      ) VALUES (
        v_user_id,
        v_membership_id,
        v_tier,
        v_tier_name,
        v_bonus_amount,
        NOW()
      );

      -- Update running balance
      v_running_balance := v_running_balance + v_bonus_amount;

      -- Create token ledger entry for retroactive bonus
      INSERT INTO club_token_ledger (
        user_id,
        transaction_type,
        amount,
        balance_after,
        description,
        reference_type,
        reference_id
      ) VALUES (
        v_user_id,
        'admin_grant',
        v_bonus_amount,
        v_running_balance,
        'Retroactive cumulative bonus for ' || v_tier_name || ' tier (Tier ' || v_tier || ')',
        'membership',
        v_membership_id
      );

      RAISE NOTICE 'Awarded % tokens for tier % (%). Running balance: %', v_bonus_amount, v_tier, v_tier_name, v_running_balance;
    ELSE
      RAISE NOTICE 'Tier % already awarded, skipping', v_tier;
    END IF;
  END LOOP;

  -- Update the cumulative_tokens_awarded in membership
  UPDATE club_memberships
  SET cumulative_tokens_awarded = 16850
  WHERE id = v_membership_id;

  RAISE NOTICE 'Retroactive bonus award complete. Total awarded: 6,850 tokens';
  RAISE NOTICE 'Updated cumulative_tokens_awarded to 16,850';
END $$;

-- Verify the results
DO $$
DECLARE
  v_user_id uuid;
  v_total_balance numeric;
  v_locked_balance numeric;
  v_available_balance numeric;
  v_cumulative_awarded numeric;
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = 'ksweat48@gmail.com';

  -- Calculate balances
  SELECT 
    COALESCE(SUM(amount), 0)
  INTO v_total_balance
  FROM club_token_ledger
  WHERE user_id = v_user_id;

  SELECT 
    tokens_locked,
    cumulative_tokens_awarded
  INTO v_locked_balance, v_cumulative_awarded
  FROM club_memberships
  WHERE user_id = v_user_id
    AND status = 'active'
  LIMIT 1;

  v_available_balance := v_total_balance - v_locked_balance;

  RAISE NOTICE '=== Verification Results ===';
  RAISE NOTICE 'Total tokens in ledger: %', v_total_balance;
  RAISE NOTICE 'Locked tokens: %', v_locked_balance;
  RAISE NOTICE 'Available tokens: %', v_available_balance;
  RAISE NOTICE 'Cumulative tokens awarded: %', v_cumulative_awarded;
  RAISE NOTICE '';
  RAISE NOTICE 'Expected available: 6,850';
  RAISE NOTICE 'Expected cumulative: 16,850';
  
  IF v_available_balance = 6850 AND v_cumulative_awarded = 16850 THEN
    RAISE NOTICE '';
    RAISE NOTICE 'SUCCESS: All balances match expected values!';
  ELSE
    RAISE WARNING 'MISMATCH: Check values above';
  END IF;
END $$;
