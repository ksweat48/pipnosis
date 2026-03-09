/*
  # CCIP: Live Trades Ticker — Platform-Wide Visibility RPC

  ## Summary
  Creates a SECURITY DEFINER RPC function that allows any authenticated user to
  read ALL open trades for the live trades ticker display, without weakening the
  existing RLS policies on goal_session_trades for any other purpose.

  ## Problem
  The existing SELECT RLS policy on goal_session_trades restricts regular users
  to seeing only their own trades. This means the LiveTradesTicker component only
  shows a user's own trades, defeating its purpose as a social-proof, platform-wide
  activity feed.

  ## Solution (SSOT / CCIP Compliant)
  - A single SECURITY DEFINER function is the sole authority for ticker data
  - No existing RLS policies are modified or weakened
  - The function returns only the fields needed for display (read-only, no mutations)
  - Emails are anonymised server-side in the RPC — raw emails never leave the DB
  - Only authenticated users can call this function
  - The function is the CCIP-governed boundary for cross-user trade visibility

  ## New Functions
  - `get_all_open_trades_for_ticker()` — returns up to 50 open trades platform-wide
    with anonymised emails, for display in the LiveTradesTicker component only.

  ## Security
  - SECURITY DEFINER: executes with owner privileges, bypassing RLS for this
    specific read-only, anonymised query only
  - Caller must be authenticated (auth.uid() IS NOT NULL guard)
  - Returns only non-sensitive fields: id, symbol, direction, entry_price,
    lot_size, current_pnl, anonymised_email
  - Raw user_id and raw email are never returned to the caller

  ## Governance
  - CCIP OWNER: LiveTradesTicker component (display only)
  - SSOT AUTHORITY: This function is the single source for ticker trade data
  - Any change to returned fields must be reflected in LiveTradesTicker.tsx
*/

CREATE OR REPLACE FUNCTION get_all_open_trades_for_ticker()
RETURNS TABLE (
  id          uuid,
  symbol      text,
  direction   text,
  entry_price numeric,
  lot_size    numeric,
  current_pnl numeric,
  anon_email  text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Guard: only authenticated users may call this function
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  RETURN QUERY
  SELECT
    t.id,
    t.symbol,
    t.direction,
    t.entry_price,
    t.lot_size,
    t.current_pnl,
    -- Anonymise email server-side: first 2 chars + *** + @ + first char of domain
    -- e.g. "johndoe@gmail.com" → "jo***@g"
    CASE
      WHEN p.email IS NULL OR p.email = '' OR position('@' IN p.email) = 0
        THEN '***'
      ELSE
        left(split_part(p.email, '@', 1), 2)
        || '***@'
        || left(split_part(p.email, '@', 2), 1)
    END AS anon_email
  FROM goal_session_trades t
  LEFT JOIN user_profiles p ON p.id = t.user_id
  WHERE t.status = 'open'
  ORDER BY t.opened_at DESC
  LIMIT 50;
END;
$$;

-- Grant execution only to authenticated role
REVOKE ALL ON FUNCTION get_all_open_trades_for_ticker() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_all_open_trades_for_ticker() TO authenticated;

COMMENT ON FUNCTION get_all_open_trades_for_ticker() IS
  'CCIP SSOT: Returns all open trades platform-wide with anonymised emails for LiveTradesTicker display only. SECURITY DEFINER — bypasses RLS for read-only, anonymised ticker data. Caller must be authenticated.';
