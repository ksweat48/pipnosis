-- Fix Waitlist Policy Error
-- This migration safely fixes the waitlist policies without disrupting other database operations

-- Step 1: Drop existing waitlist policies to avoid conflicts
DO $$ 
BEGIN
  -- Drop existing policies if they exist
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

-- Step 2: Make sure RLS is enabled on waitlist table
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

-- Step 3: Create waitlist policies with correct syntax and unique names
CREATE POLICY "waitlist_anon_insert_policy_20250708" 
  ON waitlist
  FOR INSERT 
  TO anon
  WITH CHECK (true);

CREATE POLICY "waitlist_authenticated_read_policy_20250708" 
  ON waitlist
  FOR SELECT 
  TO authenticated
  USING (true);

-- Success message
DO $$
BEGIN
  RAISE NOTICE '✅ Waitlist policies fixed successfully!';
END $$;