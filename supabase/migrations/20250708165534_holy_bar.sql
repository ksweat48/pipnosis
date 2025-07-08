/*
  # Remove Waitlist Table and Policies

  This migration removes the waitlist table and all associated policies
  to clean up the database schema and prevent any related errors.
*/

-- Step 1: Drop all waitlist policies
DO $$ 
BEGIN
  -- Drop all policies on the waitlist table
  DROP POLICY IF EXISTS "waitlist_anon_insert_policy" ON waitlist;
  DROP POLICY IF EXISTS "waitlist_authenticated_read_policy" ON waitlist;
  DROP POLICY IF EXISTS "Allow public inserts to waitlist" ON waitlist;
  DROP POLICY IF EXISTS "Allow authenticated users to read waitlist" ON waitlist;
  DROP POLICY IF EXISTS "waitlist_anon_insert_policy_20250708" ON waitlist;
  DROP POLICY IF EXISTS "waitlist_authenticated_read_policy_20250708" ON waitlist;
EXCEPTION
  WHEN OTHERS THEN
    -- Ignore errors if policies don't exist
    NULL;
END $$;

-- Step 2: Drop the waitlist table
DROP TABLE IF EXISTS waitlist;

-- Success message
DO $$
BEGIN
  RAISE NOTICE '✅ Waitlist table and policies removed successfully!';
END $$;