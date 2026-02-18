/*
  # Emergency Cleanup: Remove Corrupted Trades from Bad Alpha Prompts

  ## Summary
  Removes all trades from the last 14 hours for 4 affected users whose trades were
  corrupted by bad alpha prompts. Also reverses PnL impact on account balances.

  ## Affected Users & Trades
  1. fourthdimension7@yahoo.com
     - US30 SELL (closed, PnL: -$56.48) - trade 5ebb6af0
     - XAUUSD SELL (closed, PnL: -$249.55) - trade d8e71085
     - Balance reversal: +$306.03

  2. ksweat48@gmail.com
     - XAUUSD SELL (closed, PnL: +$416.96) - trade ff563cca
     - XAUUSD SELL (closed, PnL: -$108.72) - trade b3149076
     - NAS100 SELL (closed, PnL: -$148.77) - trade 62482fb4
     - NAS100 SELL (closed, PnL: -$297.57) - trade 5b21a9ab
     - Net PnL: -$138.10, Balance reversal: +$138.10

  3. greenmorris.83@gmail.com
     - GBPUSD SELL (OPEN, no realized PnL) - trade 6de62975
     - No balance reversal needed

  4. greenhaggai@gmail.com - No trades found

  ## Cleanup Scope
  - Deletes all FK-dependent child records across 25+ tables
  - Deletes 7 trades, 7 entry_intents
  - Reverses balance for 2 users
  - Resets affected goal sessions
  - Full audit trail in governance_change_log
*/

-- Audit trail
INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  metadata
) VALUES (
  'system_configuration',
  gen_random_uuid(),
  'system_recovery',
  jsonb_build_object(
    'affected_trades', 7,
    'affected_users', jsonb_build_array('fourthdimension7@yahoo.com', 'ksweat48@gmail.com', 'greenmorris.83@gmail.com')
  ),
  jsonb_build_object(
    'action', 'delete_corrupted_trades_and_reverse_balances',
    'fourthdimension7_reversal', 306.03,
    'ksweat48_reversal', 138.10
  ),
  'Emergency cleanup: Removing trades executed during bad alpha prompt period.',
  jsonb_build_object('ccip_protocol', true, 'incident_date', '2026-02-18')
);

-- ============================================================
-- PHASE 1: Delete all FK-dependent records for TRADES
-- ============================================================
DO $$
DECLARE
  trade_ids uuid[] := ARRAY[
    '5ebb6af0-9a63-4c6b-809e-b2f07b4d545e',
    'd8e71085-9399-4f05-88d2-da7639691864',
    '6de62975-4355-4d26-9304-8bde8ee57f91',
    'ff563cca-a1d7-4235-8a44-ff214adf8c74',
    'b3149076-3485-4405-aa6d-2255e6aee109',
    '62482fb4-9af7-4232-aa52-1f1e57b7cd60',
    '5b21a9ab-109b-4c7b-a657-ddb3ee43ac70'
  ];
  intent_ids uuid[] := ARRAY[
    'f43bb427-73ba-41ae-b248-5f1e687f2e5c',
    '0d03d0c7-e853-4074-b335-5f35546b9a36',
    '1e57f3e1-6633-4aa5-9bbb-ddf7e9a9aafa',
    '3fd96ccb-6095-4e81-8d1e-855543393a25',
    'c771bd01-cd43-4375-861a-d46adbf32eba',
    '35f12d40-d4bf-47b9-ab13-11d26871bf77',
    'f771612f-694f-4743-b524-8793784c00de'
  ];
BEGIN
  -- Child tables of goal_session_trades (trade_id FK)
  DELETE FROM admin_alerts WHERE trade_id = ANY(trade_ids);
  DELETE FROM ccip_trade_execution_audit WHERE trade_id = ANY(trade_ids);
  DELETE FROM closure_audit_log WHERE trade_id = ANY(trade_ids);
  DELETE FROM cross_user_monitoring_violations WHERE trade_id = ANY(trade_ids);
  DELETE FROM entry_overextension_events WHERE trade_id = ANY(trade_ids);
  DELETE FROM entry_price_recommendations WHERE trade_id = ANY(trade_ids);
  DELETE FROM entry_qualification_logs WHERE trade_id = ANY(trade_ids);
  DELETE FROM entry_quality_advisories WHERE trade_id = ANY(trade_ids);
  DELETE FROM entry_quality_scores WHERE trade_id = ANY(trade_ids);
  DELETE FROM goal_ai_conversations WHERE trade_id = ANY(trade_ids);
  DELETE FROM goal_feasibility_decisions WHERE trade_id = ANY(trade_ids);
  DELETE FROM goal_feasibility_tracking WHERE trade_id = ANY(trade_ids);
  DELETE FROM goal_notifications WHERE trade_id = ANY(trade_ids);
  DELETE FROM goal_trade_actions WHERE trade_id = ANY(trade_ids);
  DELETE FROM lot_sizing_audit_log WHERE trade_id = ANY(trade_ids);
  DELETE FROM periodic_wellness_checks WHERE trade_id = ANY(trade_ids);
  DELETE FROM position_audit_trail WHERE trade_id = ANY(trade_ids);
  DELETE FROM position_close_attempts WHERE trade_id = ANY(trade_ids);
  DELETE FROM position_recovery_log WHERE trade_id = ANY(trade_ids);
  DELETE FROM thesis_monitoring_logs WHERE trade_id = ANY(trade_ids);
  DELETE FROM tp1_learning_log WHERE trade_id = ANY(trade_ids);
  DELETE FROM trade_closure_events WHERE trade_id = ANY(trade_ids);
  DELETE FROM trade_closure_audit WHERE trade_id = ANY(trade_ids);
  DELETE FROM trade_forensics WHERE trade_id = ANY(trade_ids);
  DELETE FROM trade_geometry_incidents WHERE trade_id = ANY(trade_ids);
  DELETE FROM trade_processing_locks WHERE trade_id = ANY(trade_ids);
  DELETE FROM trade_thesis_plans WHERE trade_id = ANY(trade_ids);
  DELETE FROM trigger_closure_accuracy WHERE trade_id = ANY(trade_ids);
  DELETE FROM ai_trade_journal WHERE trade_id = ANY(trade_ids);

  -- Child tables of entry_intents (intent_id / entry_intent_id FK)
  DELETE FROM credit_deduction_history WHERE intent_id = ANY(intent_ids);
  DELETE FROM entry_execution_attempts WHERE intent_id = ANY(intent_ids);
  DELETE FROM entry_execution_audit WHERE intent_id = ANY(intent_ids);
  DELETE FROM entry_intent_server_state WHERE intent_id = ANY(intent_ids);
  DELETE FROM entry_monitor_logs WHERE intent_id = ANY(intent_ids);
  DELETE FROM entry_monitoring_logs WHERE intent_id = ANY(intent_ids);
  DELETE FROM entry_quality_advisories WHERE entry_intent_id = ANY(intent_ids);
  DELETE FROM entry_quality_scores WHERE intent_id = ANY(intent_ids);
  DELETE FROM entry_thesis_memory WHERE entry_intent_id = ANY(intent_ids);
  DELETE FROM entry_zone_analytics WHERE entry_intent_id = ANY(intent_ids);
  DELETE FROM server_monitoring_alerts WHERE intent_id = ANY(intent_ids);

  -- Now delete the entry_intents themselves
  DELETE FROM entry_intents WHERE id = ANY(intent_ids);

  -- Now delete the trades themselves
  DELETE FROM goal_session_trades WHERE id = ANY(trade_ids);

  -- Reverse balances
  -- fourthdimension7: reverse -56.48 and -249.55 = +306.03
  UPDATE user_profiles
  SET account_balance = account_balance + 306.03, updated_at = now()
  WHERE email = 'fourthdimension7@yahoo.com';

  -- ksweat48: reverse +416.96 - 108.72 - 148.77 - 297.57 = net -138.10, so add back 138.10
  UPDATE user_profiles
  SET account_balance = account_balance + 138.10, updated_at = now()
  WHERE email = 'ksweat48@gmail.com';

  -- Reset trades_in_session on affected goal sessions
  UPDATE goal_sessions
  SET trades_in_session = 0
  WHERE id IN (
    'b3d89b99-0022-4be5-b68f-f36c05cfc518',
    'c3e23f9f-b087-494e-a44f-37b93f18e54f',
    '862ae8b5-4fb8-4462-ab65-380e663a520d',
    '6dc612fe-65d7-49d6-83cf-614e6e759783',
    'b6fd0b7c-ff58-4376-8587-90aaca9547b8'
  );

  -- Stop any still-active affected sessions
  UPDATE goal_sessions
  SET status = 'user_stopped',
      completed_at = COALESCE(completed_at, now())
  WHERE id IN (
    'b3d89b99-0022-4be5-b68f-f36c05cfc518',
    'c3e23f9f-b087-494e-a44f-37b93f18e54f',
    '862ae8b5-4fb8-4462-ab65-380e663a520d',
    '6dc612fe-65d7-49d6-83cf-614e6e759783',
    'b6fd0b7c-ff58-4376-8587-90aaca9547b8'
  )
  AND status NOT IN ('user_stopped', 'completed', 'goal_achieved');

  RAISE NOTICE 'Cleanup complete: 7 trades removed, balances reversed, sessions stopped';
END $$;
