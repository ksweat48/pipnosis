/*
  # Add error_code column to openai_usage_log

  ## Summary
  Adds a structured `error_code` column to the `openai_usage_log` table so that
  the specific OpenAI error code (e.g. `insufficient_quota`, `rate_limit_exceeded`)
  is stored separately from the free-text `error_message`.

  ## Why
  During the 2026-02-24 incident, every scan attempt silently produced
  `insufficient_quota` errors that were only visible by reading the raw
  `error_message` text. With a dedicated column, operators can run:

    SELECT error_code, COUNT(*) FROM openai_usage_log
    WHERE created_at > now() - interval '1 hour'
    AND error_code IS NOT NULL
    GROUP BY error_code;

  …and immediately identify a billing problem vs a transient rate limit.

  ## Changes
  - `openai_usage_log`: adds nullable text column `error_code`
  - Adds a non-unique index on `(error_code, created_at)` for monitoring queries
  - No data is lost; existing rows simply have NULL for the new column

  ## Security
  No RLS changes required — the table's existing policies are unchanged.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'openai_usage_log' AND column_name = 'error_code'
  ) THEN
    ALTER TABLE openai_usage_log ADD COLUMN error_code text;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_openai_usage_log_error_code_created_at
  ON openai_usage_log (error_code, created_at DESC)
  WHERE error_code IS NOT NULL;
