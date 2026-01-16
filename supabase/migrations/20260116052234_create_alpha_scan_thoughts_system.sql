/*
  # Create Alpha Scan Thoughts System

  ## Purpose
  Provide real-time visibility into Alpha's decision-making process during market scanning.
  Users see step-by-step thoughts as Alpha evaluates trades, consults Omega Council, and makes decisions.

  ## Features
  1. Ephemeral thought storage - clears when new scan starts
  2. Real-time streaming via Supabase subscriptions
  3. Rich metadata including Omega Council votes
  4. Auto-cleanup of old thoughts

  ## Changes
  1. New Table: alpha_scan_thoughts
     - Stores individual thought steps during scanning
     - Linked to session and user
     - Includes step type, message, and rich metadata
     - is_active_scan flag for ephemeral behavior

  2. Indexes for performance
     - Composite index on (session_id, is_active_scan, created_at)
     - User isolation via user_id index

  3. RLS Policies
     - Users can only see their own thoughts
     - Service role can manage all thoughts

  4. Helper Functions
     - clear_scan_thoughts(session_id) - Clear old thoughts when new scan starts
     - cleanup_old_scan_thoughts() - Background cleanup job

  ## Security
  - RLS enabled by default
  - Users cannot see other users' thoughts
  - Service role access for system operations
*/

-- Create alpha_scan_thoughts table
CREATE TABLE IF NOT EXISTS alpha_scan_thoughts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES goal_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scan_id uuid DEFAULT NULL, -- Optional reference to scan result (set after scan completes)

  -- Step metadata
  step_type text NOT NULL CHECK (step_type IN (
    'scan_start',
    'filtering',
    'omega_voting',
    'comparing',
    'analyzing_entry',
    'final_decision',
    'execution',
    'scan_complete'
  )),
  step_number integer NOT NULL DEFAULT 1,

  -- Content
  message text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,

  -- Ephemeral control
  is_active_scan boolean NOT NULL DEFAULT true,

  -- Timestamps
  created_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_alpha_scan_thoughts_session_active
  ON alpha_scan_thoughts(session_id, is_active_scan, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alpha_scan_thoughts_user
  ON alpha_scan_thoughts(user_id);

CREATE INDEX IF NOT EXISTS idx_alpha_scan_thoughts_created
  ON alpha_scan_thoughts(created_at);

-- Enable RLS
ALTER TABLE alpha_scan_thoughts ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see their own thoughts
CREATE POLICY "Users can view own scan thoughts"
  ON alpha_scan_thoughts
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policy: Service role can insert thoughts
CREATE POLICY "Service role can insert scan thoughts"
  ON alpha_scan_thoughts
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- RLS Policy: Service role can update thoughts
CREATE POLICY "Service role can update scan thoughts"
  ON alpha_scan_thoughts
  FOR UPDATE
  TO service_role
  USING (true);

-- RLS Policy: Service role can delete thoughts
CREATE POLICY "Service role can delete scan thoughts"
  ON alpha_scan_thoughts
  FOR DELETE
  TO service_role
  USING (true);

-- RLS Policy: Authenticated users can insert their own thoughts (for client-side emissions if needed)
CREATE POLICY "Users can insert own scan thoughts"
  ON alpha_scan_thoughts
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Helper function: Clear old thoughts when new scan starts
CREATE OR REPLACE FUNCTION clear_scan_thoughts(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Mark all existing thoughts as inactive
  UPDATE alpha_scan_thoughts
  SET is_active_scan = false
  WHERE session_id = p_session_id
    AND is_active_scan = true;

  -- Alternative: Delete old thoughts entirely (more aggressive cleanup)
  -- DELETE FROM alpha_scan_thoughts
  -- WHERE session_id = p_session_id;
END;
$$;

-- Helper function: Cleanup old scan thoughts (background job)
CREATE OR REPLACE FUNCTION cleanup_old_scan_thoughts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count integer;
BEGIN
  -- Delete thoughts older than 6 hours
  DELETE FROM alpha_scan_thoughts
  WHERE created_at < now() - interval '6 hours';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  RETURN deleted_count;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION clear_scan_thoughts(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION cleanup_old_scan_thoughts() TO service_role;

-- Add helpful comments
COMMENT ON TABLE alpha_scan_thoughts IS
  'Stores Alpha''s thought process steps during market scanning. Ephemeral - clears when new scan starts.';

COMMENT ON COLUMN alpha_scan_thoughts.step_type IS
  'Type of thought step: scan_start, filtering, omega_voting, comparing, analyzing_entry, final_decision, execution, scan_complete';

COMMENT ON COLUMN alpha_scan_thoughts.message IS
  'The thought/narrative Alpha is sharing with the user';

COMMENT ON COLUMN alpha_scan_thoughts.metadata IS
  'Rich context data: symbols evaluated, confidence scores, Omega votes, rankings, etc.';

COMMENT ON COLUMN alpha_scan_thoughts.is_active_scan IS
  'TRUE for current scan thoughts, FALSE for completed scans. Frontend filters to is_active_scan=true.';

COMMENT ON FUNCTION clear_scan_thoughts(uuid) IS
  'Marks all thoughts for a session as inactive. Called when new scan starts.';

COMMENT ON FUNCTION cleanup_old_scan_thoughts() IS
  'Background cleanup job to delete thoughts older than 6 hours. Returns count of deleted rows.';
