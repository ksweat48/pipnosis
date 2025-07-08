/*
  # Waitlist Table Policies

  1. Changes
    - Create uniquely named policies for waitlist table
    - Ensure proper access control for waitlist data
    - Use timestamp-based naming to prevent conflicts

  2. Security
    - Allow anonymous users to insert into waitlist (public signup)
    - Allow authenticated users to read waitlist entries
    - Maintain proper row-level security
*/

-- First, drop existing policies to prevent conflicts
DROP POLICY IF EXISTS "Allow authenticated users to read waitlist" ON waitlist;
DROP POLICY IF EXISTS "Allow public inserts to waitlist" ON waitlist;
DROP POLICY IF EXISTS "waitlist_anon_insert_policy_20250708" ON waitlist;
DROP POLICY IF EXISTS "waitlist_authenticated_read_policy_20250708" ON waitlist;
DROP POLICY IF EXISTS "waitlist_anon_insert_policy_20250708_fixed" ON waitlist;
DROP POLICY IF EXISTS "waitlist_authenticated_read_policy_20250708_fixed" ON waitlist;

-- Create new policies with timestamp-based unique names
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

-- Log success
DO $$
BEGIN
  RAISE NOTICE 'Waitlist policies successfully created with timestamp-based names';
  RAISE NOTICE 'Anonymous users can insert into waitlist';
  RAISE NOTICE 'Authenticated users can read waitlist entries';
END $$;