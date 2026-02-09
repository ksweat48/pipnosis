/*
  # Fix Staking Ledger Transaction Type Constraint

  1. Problem
    - Phase 3A staking RPCs (`stake_tokens`, `execute_unstake`, `claim_staking_rewards`)
      write `'stake'`, `'unstake'`, and `'reward_claim'` to `club_token_ledger.transaction_type`
    - These values are NOT in the current CHECK constraint, causing runtime failures
    - All staking operations fail silently at the database level

  2. Fix
    - Add `'stake'`, `'unstake'`, and `'reward_claim'` to the allowed transaction_type values
    - This is additive-only (no data loss, no column changes)

  3. Security
    - No RLS changes
    - No new tables
*/

DO $$
BEGIN
  ALTER TABLE club_token_ledger DROP CONSTRAINT IF EXISTS club_token_ledger_transaction_type_check;
  ALTER TABLE club_token_ledger DROP CONSTRAINT IF EXISTS valid_transaction_type;

  ALTER TABLE club_token_ledger ADD CONSTRAINT valid_transaction_type
    CHECK (transaction_type IN (
      'membership_purchase',
      'membership_lock',
      'referral_reward',
      'staking_reward',
      'admin_grant',
      'admin_deduct',
      'cashout_deduction',
      'promotion_bonus',
      'migration_adjustment',
      'discount_burn',
      'staking_lock',
      'staking_unlock',
      'stake',
      'unstake',
      'reward_claim'
    ));
END $$;
