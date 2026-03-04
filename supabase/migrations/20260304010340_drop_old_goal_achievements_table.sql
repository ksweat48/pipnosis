/*
  # Drop old goal_achievements table

  ## Summary
  Permanently removes the legacy session-goal based achievements table.
  The new per-trade system (trade_achievements) is now the SSOT for all
  achievement data. All existing data was backfilled into trade_achievements
  in the previous migration.

  ## What Is Removed
  - `goal_achievements` table and all its data
*/

DROP TABLE IF EXISTS goal_achievements CASCADE;
