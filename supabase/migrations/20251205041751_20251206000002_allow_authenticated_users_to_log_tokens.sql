/*
  # Allow Authenticated Users to Log Their Own Token Usage

  ## Why
  The LLM brains run client-side and need to log their token usage.
  Currently only service_role can insert, but authenticated users need this too.

  ## Changes
  - Add INSERT policy for authenticated users to log their own token usage
  - Users can only insert records with their own user_id
*/

-- Allow authenticated users to insert their own token usage
CREATE POLICY "Users can insert own token usage"
  ON llm_token_usage
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);