/*
  # Fix Club Access Check -- Use Total Tokens Instead of Available (SSOT/CCIP)

  ## Problem
  1. The `can_user_access_club` RPC only returns `available_tokens` (total - locked),
     which shows 0 for members whose tokens are fully locked as membership collateral.
     This causes the gate page to display "Your PIP Balance: 0.00" even for Founder members.
  2. The sufficiency check compares `available_tokens >= tokens_locked`, which is always
     false when all tokens are locked for the membership itself. This would lock out
     valid members if the token gate is ever enabled.

  ## Fix
  1. Add `tokens_total` to the return columns so the UI can display the user's actual holdings.
  2. Change the sufficiency check to `total_tokens >= tokens_locked` -- the locked tokens
     ARE the collateral, so the correct question is "does the user have enough total tokens
     to cover the lock requirement?"

  ## SSOT Governance
  - `can_user_access_club` is the single source of truth for Club access decisions
  - `club_token_balances.available_tokens` is a computed column (total - locked), unchanged
  - No new tables or columns created
  - Only the RPC logic is corrected

  ## Security
  - Function remains SECURITY DEFINER with search_path restricted
  - No RLS changes
*/

DROP FUNCTION IF EXISTS can_user_access_club(uuid);

CREATE OR REPLACE FUNCTION can_user_access_club(p_user_id uuid)
RETURNS TABLE (
  has_membership boolean,
  membership_active boolean,
  has_sufficient_tokens boolean,
  can_access boolean,
  tokens_required numeric,
  tokens_available numeric,
  tokens_total numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_membership_record club_memberships%ROWTYPE;
  v_token_balance club_token_balances%ROWTYPE;
BEGIN
  SELECT * INTO v_membership_record
  FROM club_memberships
  WHERE user_id = p_user_id;

  SELECT * INTO v_token_balance
  FROM club_token_balances
  WHERE user_id = p_user_id;

  RETURN QUERY
  SELECT
    v_membership_record.id IS NOT NULL AS has_membership,
    v_membership_record.status = 'active' AS membership_active,
    COALESCE(v_token_balance.total_tokens, 0) >= COALESCE(v_membership_record.tokens_locked, 0) AS has_sufficient_tokens,
    (v_membership_record.status = 'active' AND
     COALESCE(v_token_balance.total_tokens, 0) >= COALESCE(v_membership_record.tokens_locked, 0)) AS can_access,
    COALESCE(v_membership_record.tokens_locked, 0) AS tokens_required,
    COALESCE(v_token_balance.available_tokens, 0) AS tokens_available,
    COALESCE(v_token_balance.total_tokens, 0) AS tokens_total;
END;
$$;