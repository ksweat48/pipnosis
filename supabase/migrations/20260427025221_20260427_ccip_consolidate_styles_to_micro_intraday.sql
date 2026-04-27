-- CCIP-2026-0427E-STYLE-CONSOLIDATION
-- Single-style platform consolidation: collapse SCALP/MICRO_INTRADAY/INTRADAY -> MICRO_INTRADAY
-- (uppercase) and scalper/micro/intraday -> micro (lowercase, goal_sessions only).
--
-- This migration:
--   1) Drops outdated CHECK constraints that still reference SCALP/INTRADAY/SWING/scalper/intraday.
--   2) Pre-deletes non-canonical rows from tables with UNIQUE indexes on (..., style, ...) so
--      the subsequent backfill cannot collide with existing canonical rows.
--   3) Backfills every style-bearing column to the canonical value (preserving each column's case convention).
--   4) Re-adds CHECK constraints permitting only the canonical value (plus NULL where the column was nullable).
--   5) Updates column defaults to the canonical value.
--
-- Idempotent: every DROP CONSTRAINT uses IF EXISTS; every backfill is a value-bound UPDATE.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1) DROP existing CHECK constraints that reference legacy styles
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE goal_sessions                       DROP CONSTRAINT IF EXISTS goal_sessions_trade_style_check;
ALTER TABLE goal_session_trades                 DROP CONSTRAINT IF EXISTS check_alpha_style;
ALTER TABLE goal_session_trades                 DROP CONSTRAINT IF EXISTS check_duration_band;
ALTER TABLE entry_intents                       DROP CONSTRAINT IF EXISTS entry_intents_style_intent_check;
ALTER TABLE trade_forensics                     DROP CONSTRAINT IF EXISTS trade_forensics_style_intent_check;
ALTER TABLE style_gate_blocks                   DROP CONSTRAINT IF EXISTS style_gate_blocks_style_check;
ALTER TABLE alpha_scan_signals                  DROP CONSTRAINT IF EXISTS alpha_scan_signals_trade_style_check;
ALTER TABLE alpha_tp_distribution_stats         DROP CONSTRAINT IF EXISTS alpha_tp_distribution_stats_style_check;
ALTER TABLE sweep_aware_stop_adjustments        DROP CONSTRAINT IF EXISTS sweep_aware_stop_adjustments_trade_style_check;
ALTER TABLE pre_screen_results                  DROP CONSTRAINT IF EXISTS pre_screen_results_style_check;
ALTER TABLE structural_alerts                   DROP CONSTRAINT IF EXISTS structural_alerts_style_check;
ALTER TABLE alpha_session_phase_performance     DROP CONSTRAINT IF EXISTS alpha_spp_trade_style_check;
ALTER TABLE alpha_phase_confluence_calibration  DROP CONSTRAINT IF EXISTS alpha_phase_calibration_style_check;
ALTER TABLE alpha_phase_calibration_feedback    DROP CONSTRAINT IF EXISTS phase_feedback_style_check;
ALTER TABLE market_behavior_signals             DROP CONSTRAINT IF EXISTS market_behavior_signals_style_check;
ALTER TABLE alpha_hunt_readiness                DROP CONSTRAINT IF EXISTS alpha_hunt_readiness_style_check;
ALTER TABLE alpha_brain_promotion_announcements DROP CONSTRAINT IF EXISTS alpha_brain_promotion_announcements_style_check;
ALTER TABLE omega_weight_profiles               DROP CONSTRAINT IF EXISTS valid_style;
ALTER TABLE omega_weight_audit_log              DROP CONSTRAINT IF EXISTS valid_audit_style;

-- ────────────────────────────────────────────────────────────────────────────
-- 2) Pre-delete non-canonical rows from tables with UNIQUE(..., style, ...) so
--    the backfill UPDATE cannot collide with already-canonical rows. These are
--    cache/scan/learning tables that regenerate naturally — safe to prune.
-- ────────────────────────────────────────────────────────────────────────────

DELETE FROM pre_screen_results              WHERE style <> 'MICRO_INTRADAY';
DELETE FROM alpha_hunt_readiness            WHERE style <> 'MICRO_INTRADAY';
DELETE FROM market_behavior_signals         WHERE style <> 'MICRO_INTRADAY';
DELETE FROM alpha_tp_distribution_stats     WHERE style <> 'MICRO_INTRADAY';
DELETE FROM tp_near_miss_learning           WHERE trade_style IS NOT NULL AND trade_style <> 'MICRO_INTRADAY';
-- Configuration tables: drop legacy-style rows; the MICRO_INTRADAY row stays.
DELETE FROM omega_weight_profiles           WHERE style <> 'MICRO_INTRADAY';
DELETE FROM alpha_phase_confluence_calibration WHERE trade_style <> 'MICRO_INTRADAY';
-- session-phase performance is rolling — drop non-canonical buckets so the
-- (user_id, session_name, market_phase, trade_style) unique key is collision-free.
DELETE FROM alpha_session_phase_performance WHERE trade_style <> 'micro_intraday';

-- ────────────────────────────────────────────────────────────────────────────
-- 3) BACKFILL — uppercase tables (canonical = 'MICRO_INTRADAY')
-- ────────────────────────────────────────────────────────────────────────────

UPDATE goal_session_trades
   SET alpha_style = 'MICRO_INTRADAY'
 WHERE alpha_style IN ('SCALP', 'INTRADAY');

UPDATE goal_session_trades
   SET duration_band = 'MICRO_INTRADAY'
 WHERE duration_band IN ('SCALP', 'INTRADAY', 'EXTENDED');

UPDATE goal_session_trades
   SET requested_style = 'MICRO_INTRADAY'
 WHERE requested_style IN ('SCALP', 'INTRADAY');

UPDATE goal_session_trades
   SET resolved_style = 'MICRO_INTRADAY'
 WHERE resolved_style IN ('SCALP', 'INTRADAY');

UPDATE entry_intents
   SET style = 'MICRO_INTRADAY'
 WHERE style IS NOT NULL AND style <> 'MICRO_INTRADAY';

UPDATE entry_intents
   SET style_intent = 'MICRO_INTRADAY'
 WHERE style_intent IS NOT NULL AND style_intent <> 'MICRO_INTRADAY';

UPDATE trade_forensics
   SET style_intent = 'MICRO_INTRADAY'
 WHERE style_intent <> 'MICRO_INTRADAY';

UPDATE style_gate_blocks
   SET style = 'MICRO_INTRADAY'
 WHERE style <> 'MICRO_INTRADAY';

UPDATE sweep_aware_stop_adjustments
   SET trade_style = 'MICRO_INTRADAY'
 WHERE trade_style <> 'MICRO_INTRADAY';

UPDATE structural_alerts
   SET style = 'MICRO_INTRADAY'
 WHERE style <> 'MICRO_INTRADAY';

UPDATE alpha_phase_calibration_feedback
   SET trade_style = 'MICRO_INTRADAY'
 WHERE trade_style <> 'MICRO_INTRADAY';

UPDATE alpha_brain_promotion_announcements
   SET style = 'MICRO_INTRADAY'
 WHERE style NOT IN ('MICRO_INTRADAY', 'ALL');

UPDATE omega_weight_audit_log
   SET style = 'MICRO_INTRADAY'
 WHERE style <> 'MICRO_INTRADAY';

-- ────────────────────────────────────────────────────────────────────────────
-- 4) BACKFILL — lowercase tables (canonical = 'micro' / 'micro_intraday')
-- ────────────────────────────────────────────────────────────────────────────

UPDATE goal_sessions
   SET trade_style = 'micro'
 WHERE trade_style IN ('scalper', 'intraday');

UPDATE alpha_scan_signals
   SET trade_style = 'micro_intraday'
 WHERE trade_style IN ('scalp', 'intraday');

-- ────────────────────────────────────────────────────────────────────────────
-- 5) RE-ADD canonical CHECK constraints
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE goal_sessions
  ADD CONSTRAINT goal_sessions_trade_style_check
  CHECK (trade_style IS NULL OR trade_style = 'micro');

ALTER TABLE goal_session_trades
  ADD CONSTRAINT check_alpha_style
  CHECK (alpha_style IS NULL OR alpha_style = 'MICRO_INTRADAY');

ALTER TABLE goal_session_trades
  ADD CONSTRAINT check_duration_band
  CHECK (duration_band IS NULL OR duration_band = 'MICRO_INTRADAY');

ALTER TABLE entry_intents
  ADD CONSTRAINT entry_intents_style_intent_check
  CHECK (style_intent IS NULL OR style_intent = 'MICRO_INTRADAY');

ALTER TABLE trade_forensics
  ADD CONSTRAINT trade_forensics_style_intent_check
  CHECK (style_intent = 'MICRO_INTRADAY');

ALTER TABLE style_gate_blocks
  ADD CONSTRAINT style_gate_blocks_style_check
  CHECK (style = 'MICRO_INTRADAY');

ALTER TABLE alpha_scan_signals
  ADD CONSTRAINT alpha_scan_signals_trade_style_check
  CHECK (trade_style = 'micro_intraday');

ALTER TABLE alpha_tp_distribution_stats
  ADD CONSTRAINT alpha_tp_distribution_stats_style_check
  CHECK (style = 'MICRO_INTRADAY');

ALTER TABLE sweep_aware_stop_adjustments
  ADD CONSTRAINT sweep_aware_stop_adjustments_trade_style_check
  CHECK (trade_style = 'MICRO_INTRADAY');

ALTER TABLE pre_screen_results
  ADD CONSTRAINT pre_screen_results_style_check
  CHECK (style = 'MICRO_INTRADAY');

ALTER TABLE structural_alerts
  ADD CONSTRAINT structural_alerts_style_check
  CHECK (style = 'MICRO_INTRADAY');

ALTER TABLE alpha_session_phase_performance
  ADD CONSTRAINT alpha_spp_trade_style_check
  CHECK (trade_style = 'micro_intraday');

ALTER TABLE alpha_phase_confluence_calibration
  ADD CONSTRAINT alpha_phase_calibration_style_check
  CHECK (trade_style = 'MICRO_INTRADAY');

ALTER TABLE alpha_phase_calibration_feedback
  ADD CONSTRAINT phase_feedback_style_check
  CHECK (trade_style = 'MICRO_INTRADAY');

ALTER TABLE market_behavior_signals
  ADD CONSTRAINT market_behavior_signals_style_check
  CHECK (style = 'MICRO_INTRADAY');

ALTER TABLE alpha_hunt_readiness
  ADD CONSTRAINT alpha_hunt_readiness_style_check
  CHECK (style = 'MICRO_INTRADAY');

ALTER TABLE alpha_brain_promotion_announcements
  ADD CONSTRAINT alpha_brain_promotion_announcements_style_check
  CHECK (style IN ('MICRO_INTRADAY', 'ALL'));

ALTER TABLE omega_weight_profiles
  ADD CONSTRAINT valid_style
  CHECK (style = 'MICRO_INTRADAY');

ALTER TABLE omega_weight_audit_log
  ADD CONSTRAINT valid_audit_style
  CHECK (style = 'MICRO_INTRADAY');

-- ────────────────────────────────────────────────────────────────────────────
-- 6) Update column defaults to the canonical value
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE goal_session_trades
  ALTER COLUMN requested_style SET DEFAULT 'MICRO_INTRADAY';

ALTER TABLE goal_session_trades
  ALTER COLUMN resolved_style  SET DEFAULT 'MICRO_INTRADAY';

ALTER TABLE entry_intents
  ALTER COLUMN style SET DEFAULT 'MICRO_INTRADAY';

COMMIT;
