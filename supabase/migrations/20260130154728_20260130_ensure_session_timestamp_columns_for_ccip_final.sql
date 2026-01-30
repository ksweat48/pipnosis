/*
  # Ensure Session Timestamp Columns for CCIP Compliance

  1. Add/Update Columns
    - Ensure awaiting_continuation_since exists (NULLABLE initially)
    - Ensure continuation_deadline exists (NULLABLE initially)
    - Backfill existing data with safe defaults

  2. CCIP Compliance
    - All timestamps required for timeout logic are present
    - Backfill existing data with safe defaults
    - Add detection for already-stuck sessions

  3. Data Migration
    - No data loss - only adding columns or updating values
    - Null-safe migrations for existing sessions
*/

-- Add awaiting_continuation_since if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'awaiting_continuation_since'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN awaiting_continuation_since timestamptz;
  END IF;
END $$;

-- Add continuation_deadline if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'continuation_deadline'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN continuation_deadline timestamptz;
  END IF;
END $$;

-- Add continuation_modal_shown_at if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'continuation_modal_shown_at'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN continuation_modal_shown_at timestamptz;
  END IF;
END $$;

-- Backfill missing awaiting_continuation_since for sessions in awaiting_continuation state
UPDATE goal_sessions
SET awaiting_continuation_since = COALESCE(
  awaiting_continuation_since,
  CASE
    WHEN status = 'awaiting_continuation' THEN updated_at
    ELSE awaiting_continuation_since
  END
)
WHERE
  status = 'awaiting_continuation'
  AND awaiting_continuation_since IS NULL;

-- Backfill missing continuation_deadline for sessions in awaiting_continuation state
UPDATE goal_sessions
SET continuation_deadline = COALESCE(
  continuation_deadline,
  CASE
    WHEN status = 'awaiting_continuation' THEN updated_at + interval '60 seconds'
    ELSE continuation_deadline
  END
)
WHERE
  status = 'awaiting_continuation'
  AND continuation_deadline IS NULL;

-- Backfill entry_monitor_state to DISCOVERY_SCANNING if NULL
UPDATE goal_sessions
SET entry_monitor_state = COALESCE(entry_monitor_state, 'DISCOVERY_SCANNING')
WHERE entry_monitor_state IS NULL;

-- Detect and log stuck sessions (those in awaiting_continuation with old timestamps)
INSERT INTO stuck_session_recovery_log (
  session_id, stuck_reason, cleanup_status, metadata
)
SELECT
  id,
  'timeout_not_triggered',
  'pending',
  jsonb_build_object(
    'awaiting_since', awaiting_continuation_since,
    'deadline_was', continuation_deadline,
    'detected_at', NOW()
  )
FROM goal_sessions
WHERE
  status = 'awaiting_continuation'
  AND awaiting_continuation_since IS NOT NULL
  AND EXTRACT(EPOCH FROM (NOW() - awaiting_continuation_since)) > 3600 -- >1 hour
ON CONFLICT DO NOTHING;
