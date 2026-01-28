/*
  # Modal State Recovery and Error Tracking System

  1. New Table: modal_action_audit_log
    - Tracks every modal button action (Continue, Close, Start New)
    - Records state before/after transitions
    - Captures errors for recovery/debugging

  2. Security
    - Enable RLS on modal_action_audit_log
    - Only service role can write (server-side)
    - Users can read their own audit log
*/

DO $$
BEGIN
  -- Create modal_action_audit_log table if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'modal_action_audit_log'
  ) THEN
    CREATE TABLE modal_action_audit_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      goal_session_id uuid NOT NULL REFERENCES goal_sessions(id) ON DELETE CASCADE,
      modal_id uuid NOT NULL,
      action text NOT NULL CHECK (action IN ('continue', 'close', 'start_new')),
      previous_status text NOT NULL,
      target_status text NOT NULL,
      actual_status_after text,
      success boolean NOT NULL DEFAULT false,
      error_message text,
      recovery_attempted boolean DEFAULT false,
      created_at timestamptz DEFAULT now()
    );

    CREATE INDEX idx_modal_action_audit_user ON modal_action_audit_log(user_id, created_at DESC);
    CREATE INDEX idx_modal_action_audit_session ON modal_action_audit_log(goal_session_id);
    CREATE INDEX idx_modal_action_audit_success ON modal_action_audit_log(success) WHERE NOT success;

    -- Enable RLS
    ALTER TABLE modal_action_audit_log ENABLE ROW LEVEL SECURITY;

    -- Users can read their own audit log
    CREATE POLICY "Users can read their own modal action audit log"
      ON modal_action_audit_log FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);

    -- Service role can insert (server-side only)
    CREATE POLICY "Service role inserts modal action audit log"
      ON modal_action_audit_log FOR INSERT
      TO service_role
      WITH CHECK (true);

    GRANT SELECT ON modal_action_audit_log TO authenticated;
    GRANT ALL ON modal_action_audit_log TO service_role;
  END IF;
END $$;
