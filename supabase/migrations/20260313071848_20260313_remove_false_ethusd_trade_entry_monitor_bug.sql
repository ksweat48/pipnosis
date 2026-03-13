
/*
  # Remove False ETHUSD Trade — Entry Monitor Gate Bug Recovery

  ## Root Cause
  The entry monitor gate in goal-session-live-engine.ts read `tier_level` from
  `user_monitor_preferences`, a column that does not exist. This made `hasTierAccess`
  permanently false, permanently disabling MONITORED mode for all users.

  Alpha intended a zone entry at 2109.47 (~2110 resistance rejection, est. fill 170 min).
  The broken gate forced IMMEDIATE execution at live market price 2096.41 — 13.06 points
  away from the intended zone. The trade hit its stop loss 71 seconds after opening,
  producing a false -$927.48 loss.

  ## Records Removed
  All child records deleted in FK dependency order:
  - session_health_check_log (124 rows)
  - alpha_scan_thoughts (111 rows)
  - goal_ai_conversations (6 rows)
  - alpha_decisions (9 rows)
  - ai_trade_journal (1 row)
  - trade_closure_events (1 row)
  - goal_notifications (any)
  - entry_quality_advisories (any, via entry_intents)
  - entry_intents (any)
  - entry_overextension_events (1 row)
  - goal_session_scan_results (any)
  - lot_sizing_audit_log (any)
  - goal_aware_lot_sizing_decisions (any)
  - governance_change_log referencing trade (42 rows)
  - position_monitoring_logs (1 row)
  - wellness_check_logs (1 row)
  - goal_session_trades (1 row — the false trade)
  - goal_sessions (1 row)

  ## Balance Restoration
  User ksweat48@gmail.com (91905a02): $9772.34 + $927.48 = $10,699.82
*/

DO $$
DECLARE
  v_trade_id   uuid := '619e8ef6-a304-4093-a353-eacf63d8b912';
  v_session    uuid := '87ded04d-5ed7-4b31-9f51-32d0ca95514c';
  v_user_id    uuid := '91905a02-cf9e-4537-9920-98a4b790830a';
  v_pnl_loss   numeric := 927.48;
BEGIN

  DELETE FROM session_health_check_log WHERE session_id = v_session;
  DELETE FROM alpha_scan_thoughts WHERE session_id = v_session;
  DELETE FROM goal_ai_conversations WHERE goal_session_id = v_session;
  DELETE FROM alpha_decisions WHERE session_id = v_session;
  DELETE FROM alpha_decisions WHERE trade_id = v_trade_id;
  DELETE FROM ai_trade_journal WHERE trade_id = v_trade_id;
  DELETE FROM trade_closure_events WHERE goal_session_id = v_session;
  DELETE FROM goal_notifications WHERE goal_session_id = v_session;
  DELETE FROM entry_quality_advisories
    WHERE entry_intent_id IN (SELECT id FROM entry_intents WHERE session_id = v_session);
  DELETE FROM entry_intents WHERE session_id = v_session;
  DELETE FROM entry_overextension_events WHERE session_id = v_session;
  DELETE FROM goal_session_scan_results WHERE session_id = v_session;
  DELETE FROM lot_sizing_audit_log WHERE trade_id = v_trade_id;
  DELETE FROM goal_aware_lot_sizing_decisions WHERE goal_session_id = v_session;
  DELETE FROM governance_change_log WHERE entity_id = v_trade_id;
  DELETE FROM position_monitoring_logs WHERE position_id = v_trade_id;
  DELETE FROM wellness_check_logs WHERE position_id = v_trade_id;
  DELETE FROM goal_session_trades WHERE id = v_trade_id;
  DELETE FROM goal_sessions WHERE id = v_session;

  UPDATE user_profiles
  SET account_balance = account_balance + v_pnl_loss,
      updated_at = now()
  WHERE id = v_user_id;

  INSERT INTO governance_change_log (
    entity_type, entity_id, operation,
    old_value, new_value, reason,
    requester_id, metadata, created_at
  ) VALUES (
    'goal_sessions',
    v_session,
    'system_recovery',
    jsonb_build_object(
      'trade_id', v_trade_id,
      'symbol', 'ETHUSD',
      'direction', 'SELL',
      'lot_size', 70.99,
      'entry_price', 2096.41,
      'planned_entry_price', 2109.47,
      'pnl', -927.48,
      'close_reason', 'stop_loss',
      'duration_seconds', 71,
      'account_balance_before', 9772.34
    ),
    jsonb_build_object(
      'action', 'false_trade_removed',
      'account_balance_after', 10699.82
    ),
    'Entry monitor gate permanently disabled by missing tier_level column in user_monitor_preferences. hasTierAccess was always false. Alpha intended MONITORED zone entry at 2109.47 but IMMEDIATE execution fired at 2096.41 (13.06pt slippage). Trade hit SL 71 seconds after open. Removed as false data. Balance restored +$927.48.',
    v_user_id,
    jsonb_build_object(
      'bug', 'tier_level column missing from user_monitor_preferences',
      'root_cause', 'hasTierAccess permanently false — MONITORED mode could never activate for any user',
      'fix_file', 'src/services/goal-session-live-engine.ts',
      'migration', '20260313_remove_false_ethusd_trade_entry_monitor_bug'
    ),
    now()
  );

END $$;
