/*
  # Fix club_referrals RLS - Add INSERT Policy for Authenticated Users

  1. Problem
    - POST to club_referrals returns 403 Forbidden
    - Table only has SELECT policy for authenticated users
    - No INSERT policy exists, blocking referral code creation and tracking

  2. Changes
    - Add INSERT policy: users can insert referrals where they are the referrer
    - Add UPDATE policy: users can update their own referral records (status changes)

  3. Security
    - INSERT restricted to rows where referrer_id matches auth.uid()
    - Users cannot create referrals on behalf of other users
    - UPDATE restricted to rows the user owns (as referrer)
    - Service role ALL policy retained for server-side operations

  4. SSOT Compliance
    - club-referral-service.ts remains the sole authority for referral logic
    - These policies only enable database-level write access with ownership checks
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'club_referrals'
    AND policyname = 'Users can create own referral codes'
  ) THEN
    CREATE POLICY "Users can create own referral codes"
      ON club_referrals
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = referrer_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'club_referrals'
    AND policyname = 'Users can update own referrals'
  ) THEN
    CREATE POLICY "Users can update own referrals"
      ON club_referrals
      FOR UPDATE
      TO authenticated
      USING (auth.uid() = referrer_id)
      WITH CHECK (auth.uid() = referrer_id);
  END IF;
END $$;
