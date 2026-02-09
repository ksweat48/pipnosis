/*
  # Fix can_user_access_club() Return Type Mismatch

  1. Problem
    - The `can_user_access_club()` RPC function declares `tokens_required` and
      `tokens_available` as INTEGER in its return type
    - The underlying columns `club_memberships.tokens_locked` and
      `club_token_balances.available_tokens` were migrated to NUMERIC(12,2)
      in the canonical tokenomics migration
    - PostgreSQL error 42804: "Returned type numeric does not match expected
      type integer in column 5"

  2. Fix
    - Drop and recreate the function with NUMERIC return types for columns 5 and 6
    - Function body remains identical -- only the declared return signature changes

  3. Impact
    - Fixes the 400 Bad Request error on POST /rpc/can_user_access_club
    - No frontend changes required (JavaScript handles numeric values natively)
*/

DROP FUNCTION IF EXISTS can_user_access_club(uuid);

CREATE OR REPLACE FUNCTION can_user_access_club(p_user_id uuid)
RETURNS TABLE (
  has_membership boolean,
  membership_active boolean,
  has_sufficient_tokens boolean,
  can_access boolean,
  tokens_required numeric,
  tokens_available numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
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
    COALESCE(v_token_balance.available_tokens, 0) >= COALESCE(v_membership_record.tokens_locked, 0) AS has_sufficient_tokens,
    (v_membership_record.status = 'active' AND
     COALESCE(v_token_balance.available_tokens, 0) >= COALESCE(v_membership_record.tokens_locked, 0)) AS can_access,
    COALESCE(v_membership_record.tokens_locked, 0) AS tokens_required,
    COALESCE(v_token_balance.available_tokens, 0) AS tokens_available;
END;
$$;
