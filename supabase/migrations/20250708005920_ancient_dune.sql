/*
  # Fix Waitlist Policy Issue
  
  1. Changes
    - Safely drop the existing "Allow public inserts to waitlist" policy if it exists
    - Create a new policy with a unique name to avoid conflicts
    - Add verification to confirm the policy was created successfully
    
  2. Security
    - Maintains the same security model (public inserts to waitlist)
    - No changes to existing data or schema
    
  3. Approach
    - Uses DO blocks with exception handling for safety
    - Includes verification steps
*/

-- Safely drop the existing policy if it exists
DO $$
BEGIN
  -- Check if the policy exists before attempting to drop it
  IF EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'waitlist' AND policyname = 'Allow public inserts to waitlist'
  ) THEN
    DROP POLICY "Allow public inserts to waitlist" ON waitlist;
    RAISE NOTICE 'Dropped existing policy "Allow public inserts to waitlist"';
  ELSE
    RAISE NOTICE 'Policy "Allow public inserts to waitlist" does not exist, skipping drop';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error dropping policy: %', SQLERRM;
END
$$;

-- Create a new policy with a unique name
DO $$
BEGIN
  -- Create a new policy with a unique name
  CREATE POLICY "waitlist_anon_insert_policy" ON waitlist
    FOR INSERT
    TO anon
    WITH CHECK (true);
  
  RAISE NOTICE 'Created new policy "waitlist_anon_insert_policy" for waitlist table';
EXCEPTION
  WHEN duplicate_object THEN
    RAISE NOTICE 'Policy "waitlist_anon_insert_policy" already exists';
  WHEN OTHERS THEN
    RAISE NOTICE 'Error creating policy: %', SQLERRM;
END
$$;

-- Verify the policy was created successfully
DO $$
DECLARE
  policy_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'waitlist' AND policyname = 'waitlist_anon_insert_policy'
  ) INTO policy_exists;
  
  IF policy_exists THEN
    RAISE NOTICE 'Verification successful: Policy "waitlist_anon_insert_policy" exists';
  ELSE
    RAISE NOTICE 'Verification failed: Policy "waitlist_anon_insert_policy" does not exist';
  END IF;
END
$$;