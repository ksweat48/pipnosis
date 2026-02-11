/*
  # Retroactive Pool Accounting - Debit 16,850 PIP from COMMUNITY_INCENTIVES

  ## Summary
  The existing 16,850 PIP in club_token_ledger was granted without debiting
  any pool. This migration retroactively corrects pool balances and creates
  proper pool event records.

  ## Transactions Being Reconciled
  1. membership_purchase: 10,000 PIP (Founder tier) -> COMMUNITY_INCENTIVES
  2. admin_grant: 5,000 PIP (Elite tier bonus) -> COMMUNITY_INCENTIVES
  3. admin_grant: 1,000 PIP (Trader tier bonus) -> COMMUNITY_INCENTIVES
  4. admin_grant: 500 PIP (Builder tier bonus) -> COMMUNITY_INCENTIVES
  5. admin_grant: 250 PIP (Starter tier bonus) -> COMMUNITY_INCENTIVES
  6. admin_grant: 100 PIP (Member tier bonus) -> COMMUNITY_INCENTIVES
  Total: 16,850 PIP

  ## Changes
  - Debit 16,850 PIP from COMMUNITY_INCENTIVES pool
  - Create 6 POOL_DEBIT events in token_pool_events (one per original transaction)
  - After: COMMUNITY_INCENTIVES = 29,983,150.0000 PIP (was 30,000,000.0000)

  ## SSOT Compliance
  - Pool balances now reflect reality
  - Event log has complete audit trail
  - Supply integrity: pools(99,983,150) + circulating(16,850) + burned(0) = 100,000,000
*/

-- Verify starting conditions
DO $$
DECLARE
  v_current_balance DECIMAL(18,4);
  v_ledger_total NUMERIC;
BEGIN
  SELECT current_balance_pip INTO v_current_balance
  FROM token_pools WHERE pool_id = 'COMMUNITY_INCENTIVES';

  SELECT COALESCE(SUM(amount), 0) INTO v_ledger_total
  FROM club_token_ledger WHERE amount > 0;

  IF v_current_balance < v_ledger_total THEN
    RAISE EXCEPTION 'Cannot debit: pool balance (%) < ledger total (%)',
      v_current_balance, v_ledger_total;
  END IF;
END $$;

-- Debit 10,000 PIP for membership_purchase
UPDATE token_pools
SET current_balance_pip = current_balance_pip - 10000.0000, updated_at = now()
WHERE pool_id = 'COMMUNITY_INCENTIVES';

INSERT INTO token_pool_events (pool_id, event_type, amount_pip, ref_type, metadata)
VALUES (
  'COMMUNITY_INCENTIVES',
  'POOL_DEBIT',
  10000.0000,
  'retroactive_reconciliation',
  jsonb_build_object(
    'note', 'Retroactive debit for Founder membership purchase',
    'original_transaction_type', 'membership_purchase',
    'original_amount', 10000,
    'reconciliation_date', now()::TEXT
  )
);

-- Debit 5,000 PIP for Elite tier bonus
UPDATE token_pools
SET current_balance_pip = current_balance_pip - 5000.0000, updated_at = now()
WHERE pool_id = 'COMMUNITY_INCENTIVES';

INSERT INTO token_pool_events (pool_id, event_type, amount_pip, ref_type, metadata)
VALUES (
  'COMMUNITY_INCENTIVES',
  'POOL_DEBIT',
  5000.0000,
  'retroactive_reconciliation',
  jsonb_build_object(
    'note', 'Retroactive debit for Elite tier (Tier 5) cumulative bonus',
    'original_transaction_type', 'admin_grant',
    'original_amount', 5000,
    'reconciliation_date', now()::TEXT
  )
);

-- Debit 1,000 PIP for Trader tier bonus
UPDATE token_pools
SET current_balance_pip = current_balance_pip - 1000.0000, updated_at = now()
WHERE pool_id = 'COMMUNITY_INCENTIVES';

INSERT INTO token_pool_events (pool_id, event_type, amount_pip, ref_type, metadata)
VALUES (
  'COMMUNITY_INCENTIVES',
  'POOL_DEBIT',
  1000.0000,
  'retroactive_reconciliation',
  jsonb_build_object(
    'note', 'Retroactive debit for Trader tier (Tier 4) cumulative bonus',
    'original_transaction_type', 'admin_grant',
    'original_amount', 1000,
    'reconciliation_date', now()::TEXT
  )
);

-- Debit 500 PIP for Builder tier bonus
UPDATE token_pools
SET current_balance_pip = current_balance_pip - 500.0000, updated_at = now()
WHERE pool_id = 'COMMUNITY_INCENTIVES';

INSERT INTO token_pool_events (pool_id, event_type, amount_pip, ref_type, metadata)
VALUES (
  'COMMUNITY_INCENTIVES',
  'POOL_DEBIT',
  500.0000,
  'retroactive_reconciliation',
  jsonb_build_object(
    'note', 'Retroactive debit for Builder tier (Tier 3) cumulative bonus',
    'original_transaction_type', 'admin_grant',
    'original_amount', 500,
    'reconciliation_date', now()::TEXT
  )
);

-- Debit 250 PIP for Starter tier bonus
UPDATE token_pools
SET current_balance_pip = current_balance_pip - 250.0000, updated_at = now()
WHERE pool_id = 'COMMUNITY_INCENTIVES';

INSERT INTO token_pool_events (pool_id, event_type, amount_pip, ref_type, metadata)
VALUES (
  'COMMUNITY_INCENTIVES',
  'POOL_DEBIT',
  250.0000,
  'retroactive_reconciliation',
  jsonb_build_object(
    'note', 'Retroactive debit for Starter tier (Tier 2) cumulative bonus',
    'original_transaction_type', 'admin_grant',
    'original_amount', 250,
    'reconciliation_date', now()::TEXT
  )
);

-- Debit 100 PIP for Member tier bonus
UPDATE token_pools
SET current_balance_pip = current_balance_pip - 100.0000, updated_at = now()
WHERE pool_id = 'COMMUNITY_INCENTIVES';

INSERT INTO token_pool_events (pool_id, event_type, amount_pip, ref_type, metadata)
VALUES (
  'COMMUNITY_INCENTIVES',
  'POOL_DEBIT',
  100.0000,
  'retroactive_reconciliation',
  jsonb_build_object(
    'note', 'Retroactive debit for Member tier (Tier 1) cumulative bonus',
    'original_transaction_type', 'admin_grant',
    'original_amount', 100,
    'reconciliation_date', now()::TEXT
  )
);

-- Verify final state
DO $$
DECLARE
  v_expected DECIMAL(18,4) := 30000000.0000 - 16850.0000;
  v_actual DECIMAL(18,4);
BEGIN
  SELECT current_balance_pip INTO v_actual
  FROM token_pools WHERE pool_id = 'COMMUNITY_INCENTIVES';

  IF ABS(v_actual - v_expected) > 0.01 THEN
    RAISE EXCEPTION 'Verification failed! Expected: %, Actual: %', v_expected, v_actual;
  END IF;
END $$;
