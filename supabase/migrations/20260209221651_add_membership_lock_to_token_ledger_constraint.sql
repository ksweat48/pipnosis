/*
  # Add membership_lock to club_token_ledger Transaction Type Constraint

  1. Problem
    - The `grant_club_membership()` RPC inserts a ledger entry with
      transaction_type = 'membership_lock' (step 8 of atomic membership grant)
    - The CHECK constraint on `club_token_ledger.transaction_type` does NOT
      include 'membership_lock' in its allowed values
    - This causes every membership purchase to fail AFTER Stripe payment succeeds,
      meaning users get charged but never receive their membership

  2. Fix
    - Drop the existing CHECK constraint
    - Recreate it with 'membership_lock' added to the allowed values
    - All existing values are preserved

  3. Impact
    - Unblocks the entire membership purchase flow
    - No data changes -- constraint-only modification
*/

ALTER TABLE club_token_ledger
  DROP CONSTRAINT IF EXISTS club_token_ledger_transaction_type_check;

ALTER TABLE club_token_ledger
  ADD CONSTRAINT club_token_ledger_transaction_type_check
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
    'staking_unlock'
  ));
