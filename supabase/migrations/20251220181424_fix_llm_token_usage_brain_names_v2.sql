/*
  # Fix LLM Token Usage Brain Name Constraint

  1. Changes
    - Remove restrictive CHECK constraint on brain_name
    - Allow all Omega brain names (1-10) and Alpha
    - Enables tracking of full Omega suite + Alpha coordinator
    - Includes MidTrade variants

  2. Security
    - No changes to RLS policies
    - Existing policies remain secure
*/

-- Drop the old restrictive CHECK constraint
ALTER TABLE llm_token_usage
DROP CONSTRAINT IF EXISTS llm_token_usage_brain_name_check;

-- Add a more flexible constraint that allows all Omega brains (1-10) and Alpha
ALTER TABLE llm_token_usage
ADD CONSTRAINT llm_token_usage_brain_name_check
CHECK (brain_name IN (
  'Alpha',
  'Omega-1', 'Omega-2', 'Omega-3', 'Omega-4', 'Omega-5',
  'Omega-6', 'Omega-7', 'Omega-8', 'Omega-9', 'Omega-10',
  'MidTrade-Monitor',
  'MidTrade-Periodic',
  'Unknown'
));
