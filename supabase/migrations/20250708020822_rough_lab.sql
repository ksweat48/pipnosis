/*
  # Fix Waitlist Policies

  1. Changes
    - Drop existing waitlist policies to prevent conflicts
    - Create new uniquely named policies for waitlist table
    - Ensure proper access control for waitlist data

  2. Security
    - Maintain public insert access to waitlist table
    - Ensure only authenticated users can read waitlist entries
    - Enable anonymous inserts for public signup
*/

-- First, drop existing policies to prevent conflicts
DROP POLICY IF EXISTS "Allow authenticated users to read waitlist" ON waitlist;
DROP POLICY IF EXISTS "Allow public inserts to waitlist" ON waitlist;
DROP POLICY IF EXISTS "waitlist_anon_insert_policy_20250708" ON waitlist;
DROP POLICY IF EXISTS "waitlist_authenticated_read_policy_20250708" ON waitlist;

-- Create new policies with unique names
-- Allow anonymous users to insert into waitlist
CREATE POLICY "waitlist_anon_insert_policy_20250708_fixed"
  ON waitlist
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Allow authenticated users to read waitlist
CREATE POLICY "waitlist_authenticated_read_policy_20250708_fixed"
  ON waitlist
  FOR SELECT
  TO authenticated
  USING (true);

-- Log success
DO $$
BEGIN
  RAISE NOTICE 'Waitlist policies successfully updated';
END $$;