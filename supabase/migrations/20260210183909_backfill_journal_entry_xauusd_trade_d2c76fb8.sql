/*
  # Backfill Missing Journal Entry for XAUUSD Trade d2c76fb8

  ## Context
  Trade d2c76fb8 (XAUUSD BUY 0.23 lots) was closed by stop_loss on 2026-02-10.
  The RPC had a P&L formula bug that produced -$22,977 instead of -$229.77.
  The P&L was corrected via emergency migration, but the journal entry was never
  created because post_processing_status remained 'pending' throughout.

  ## Changes
  1. Insert journal entry into ai_trade_journal for the corrected trade
  2. Update post_processing_status to 'succeeded' on goal_session_trades
  3. Update post_processing_status to 'succeeded' on trade_closure_events
  4. Log to governance_change_log for audit trail

  ## Security
  - No RLS changes
  - Uses DO block for atomic execution
*/

DO $$
DECLARE
  v_trade_id uuid := 'd2c76fb8-8832-4510-8dcd-5fac627c3214';
  v_user_id uuid := '91905a02-cf9e-4537-9920-98a4b790830a';
  v_session_id uuid := 'b3d0a74d-1993-4180-bb85-ae04c588ab24';
  v_journal_exists boolean;
  v_journal_id uuid;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM ai_trade_journal WHERE trade_id = v_trade_id
  ) INTO v_journal_exists;

  IF v_journal_exists THEN
    RAISE LOG '[JournalBackfill] Journal entry already exists for trade %, skipping', v_trade_id;
  ELSE
    INSERT INTO ai_trade_journal (
      user_id, trade_id, session_id, symbol, direction,
      entry_price, exit_price, stop_loss, take_profit,
      pnl, outcome, actual_outcome,
      entry_time, exit_time,
      journal_entry_type, created_at
    ) VALUES (
      v_user_id, v_trade_id, v_session_id, 'XAUUSD', 'buy',
      5025.93, 5015.94, 5018.43, 5068.43,
      -229.77, 'loss', 'Stop loss hit at 5015.94',
      '2026-02-10T17:56:45.731126+00:00'::timestamptz,
      '2026-02-10T18:06:03.529891+00:00'::timestamptz,
      'trade', now()
    ) RETURNING id INTO v_journal_id;

    RAISE LOG '[JournalBackfill] Created journal entry % for trade %', v_journal_id, v_trade_id;
  END IF;

  UPDATE goal_session_trades
  SET post_processing_status = 'succeeded', updated_at = now()
  WHERE id = v_trade_id AND post_processing_status = 'pending';

  UPDATE trade_closure_events
  SET post_processing_status = 'succeeded', last_processed_at = now()
  WHERE trade_id = v_trade_id AND post_processing_status = 'pending';

  INSERT INTO governance_change_log (
    entity_type, entity_id, operation, reason,
    old_value, new_value, metadata
  ) VALUES (
    'goal_session_trades', v_trade_id, 'status_transition',
    'Backfilled missing journal entry and marked post-processing as succeeded',
    jsonb_build_object('post_processing_status', 'pending', 'journal_entry', false),
    jsonb_build_object('post_processing_status', 'succeeded', 'journal_entry', true),
    jsonb_build_object('user_id', v_user_id, 'journal_id', v_journal_id)
  );

  RAISE LOG '[JournalBackfill] Migration complete for trade %', v_trade_id;
END $$;
