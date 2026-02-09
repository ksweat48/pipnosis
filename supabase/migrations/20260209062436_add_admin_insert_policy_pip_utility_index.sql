/*
  # Add Admin Insert Policy for PIP Utility Index History

  1. Purpose
    - Allow admin users to insert new index computations from the frontend
    - The "Compute First Index" button in AdminClubPanel calls
      pipUtilityIndexEngine.computeDailyIndex() which inserts into
      pip_utility_index_history and updates pip_utility_index_state
    - Without this policy, the INSERT is blocked by RLS

  2. Security
    - Only admin users (is_admin = true in user_profiles) can insert
    - Maintains existing SELECT policy for all authenticated users
    - Service role ALL policy remains for server-side operations

  3. SSOT Compliance
    - pip_utility_index_engine remains the sole authority for index computation
    - This policy only enables database-level write access for admins
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'pip_utility_index_history'
    AND policyname = 'Admins can insert index history entries'
  ) THEN
    CREATE POLICY "Admins can insert index history entries"
      ON pip_utility_index_history
      FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM user_profiles
          WHERE user_profiles.id = auth.uid()
          AND user_profiles.is_admin = true
        )
      );
  END IF;
END $$;
