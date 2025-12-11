/*
  # Fix goal_reward_history RLS Policy

  ## Problem
  Users are getting 403 Forbidden errors when trying to insert records into goal_reward_history
  because there's no INSERT policy for authenticated users.

  ## Solution
  Add an INSERT policy that allows users to insert their own reward history records.
*/

-- Add INSERT policy for goal_reward_history
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'goal_reward_history'
    AND policyname = 'Users can insert own goal reward history'
  ) THEN
    CREATE POLICY "Users can insert own goal reward history"
      ON goal_reward_history FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

COMMENT ON POLICY "Users can insert own goal reward history" ON goal_reward_history IS
  'Allows authenticated users to insert their own reward history records when goals are achieved';
