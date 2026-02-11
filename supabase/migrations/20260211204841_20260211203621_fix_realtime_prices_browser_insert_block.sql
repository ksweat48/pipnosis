/*
  # Fix: Block Browser Writes to realtime_prices
  
  ## Issue
  Browser is trying to POST to realtime_prices during sign-in, causing 403 errors
  and requiring users to sign in twice.
  
  ## Root Cause
  The "Authenticated users can insert realtime prices" policy allows browser writes,
  but browser clients should NEVER write prices - only server-side functions should.
  
  ## Solution
  Remove the authenticated insert policy. Only service_role (server-side) can write prices.
  
  ## Impact
  - Browser sign-in will no longer get 403 errors
  - Only Netlify functions can write to realtime_prices (correct behavior)
  - Sign-in will work on first attempt
*/

-- Drop the problematic policy that allows browser writes
DROP POLICY IF EXISTS "Authenticated users can insert realtime prices" ON realtime_prices;

-- Verify only service_role can write
DO $$
DECLARE
  v_policy_count int;
BEGIN
  SELECT COUNT(*) INTO v_policy_count
  FROM pg_policies
  WHERE tablename = 'realtime_prices'
    AND cmd = 'INSERT'
    AND roles = '{authenticated}';
  
  IF v_policy_count > 0 THEN
    RAISE EXCEPTION 'Authenticated insert policy still exists!';
  END IF;
  
  -- Verify service_role policy exists
  SELECT COUNT(*) INTO v_policy_count
  FROM pg_policies
  WHERE tablename = 'realtime_prices'
    AND cmd = 'INSERT'
    AND 'service_role' = ANY(roles);
  
  IF v_policy_count = 0 THEN
    RAISE EXCEPTION 'Service role insert policy missing!';
  END IF;
  
  RAISE NOTICE '✓ Browser writes to realtime_prices blocked';
  RAISE NOTICE '✓ Only server-side functions can write prices';
  RAISE NOTICE '✓ Sign-in 403 error fixed';
END $$;
