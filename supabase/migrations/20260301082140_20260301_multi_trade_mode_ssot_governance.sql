/*
  # Multi-Trade Mode SSOT Governance Fix

  ## Summary
  Establishes `trading_preferences` as the Single Source of Truth (SSOT) for
  the multi-trade mode toggle on `user_profiles`.

  ## Root Cause (CCIP Conflict Detected)
  - SettingsPage was reading from `user_profiles.preferences` — a column that does NOT exist
  - SettingsPage was writing to `user_profiles.preferences` — silently failing (column absent)
  - SmartGoalPanel correctly reads from `user_profiles.trading_preferences` (correct SSOT)
  - Result: the toggle appeared to work visually but NEVER persisted; session creation
    always used the default false value (single-trade mode was always forced)

  ## Fix
  Frontend SettingsPage.tsx updated (same deployment) to:
  1. Read multiTradeMode from trading_preferences (correct SSOT column)
  2. Write multiTradeMode to trading_preferences (correct SSOT column)
  3. Notification prefs managed via dedicated boolean columns / email_notification_preferences

  ## Columns Affected
  - user_profiles.trading_preferences (JSONB) — SSOT for multiTradeMode and all
    trading-behaviour flags

  ## Governance Notes
  - No destructive operations; migration is a governance record + no-op data step
  - RLS unchanged; existing policies continue to apply
*/

-- No-op safe step: ensure trading_preferences defaults to empty object (not NULL)
-- for any rows where it is currently NULL, preventing jsonb merge errors
UPDATE user_profiles
SET trading_preferences = '{}'::jsonb
WHERE trading_preferences IS NULL;
