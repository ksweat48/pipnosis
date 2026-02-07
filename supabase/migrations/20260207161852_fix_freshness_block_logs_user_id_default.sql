/*
  # Fix freshness_block_logs user_id default value

  1. Changes
    - Add DEFAULT auth.uid() to `user_id` column on `freshness_block_logs` table
    - This allows the block logger to insert rows without explicitly providing user_id
      when the request is made by an authenticated user
    - Keeps NOT NULL constraint to ensure data integrity

  2. Why
    - The freshness block logger was unable to insert rows because user_id is NOT NULL
      with no default value, but the application code did not include user_id in the INSERT
    - This caused the freshness_block_logs table to remain permanently empty (0 rows)
    - The Freshness Gate Analytics dashboard showed all zeros as a result

  3. Security
    - auth.uid() ensures the logged user_id matches the authenticated user
    - Existing RLS policies remain unchanged
*/

ALTER TABLE freshness_block_logs
  ALTER COLUMN user_id SET DEFAULT auth.uid();
