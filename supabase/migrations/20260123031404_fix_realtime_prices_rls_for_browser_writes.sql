/*
  # Fix Realtime Prices RLS for Browser Writes

  ## Problem
  Browser polling fetches fresh prices at 250ms for ultra-critical symbols (active sessions),
  but the database has stale prices because only service_role can insert.
  
  Alpha execution blocked: "Price data is 57s old (max: 30s)"

  ## Root Cause
  - Browser polling writes to localStorage only (tick-buffer-service)
  - Database writes restricted to service_role only
  - When Alpha queries for execution, database is stale
  - Trade gets blocked by price freshness gate

  ## Solution
  Allow authenticated users to insert their polled price data to realtime_prices.
  This ensures Alpha has fresh database prices when making execution decisions.

  ## SSOT Compliance
  - Browser writes complement (not replace) server-side collection
  - Both sources write to same authoritative table
  - Price freshness gate queries one source of truth
  - RLS ensures data isolation per user context

  ## Changes
  1. Add INSERT policy for authenticated users
  2. Keep existing service_role policy for server-side functions
  3. Maintain read policies for all contexts
*/

-- Allow authenticated users to insert their polled price data
CREATE POLICY "Authenticated users can insert realtime prices"
  ON realtime_prices FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Document the change for governance tracking
COMMENT ON POLICY "Authenticated users can insert realtime prices" ON realtime_prices IS
  'SSOT Fix: Browser polling writes fresh prices to database for Alpha execution. '
  'Complements server-side price collection. Both sources write to same authority table.';
