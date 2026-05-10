/*
  # CCIP-2026-0510I — Allow authenticated browser inserts into wall_calibration_events

  1. Problem
     wall-calibration-engine.ts runs in the browser and fires a non-blocking INSERT
     against wall_calibration_events. The table had only service_role and admin
     policies, so every insert returned 400 from PostgREST. Combined with the
     'micro' vs 'MICRO_INTRADAY' style mismatch fixed in the same CCIP bundle,
     this blocked all calibration audit rows from ever being written.

  2. Change
     Add an INSERT policy for authenticated users that requires the row's user_id
     to match auth.uid(), OR (for anonymous-session fire-and-forget paths) user_id
     to be NULL. Keeps service_role path intact.

  3. Safety
     - Read policies untouched.
     - Write policy is ownership-scoped: user_id must be null or match auth.uid().
     - Idempotent: DROP IF EXISTS + CREATE.
*/

DROP POLICY IF EXISTS "Authenticated users can insert own calibration events" ON wall_calibration_events;

CREATE POLICY "Authenticated users can insert own calibration events"
  ON wall_calibration_events
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());
