/*
  # Close Stale Forex/Index Trades - New Year's Day 2026

  ## Issue
  Several trades have been open during market closure:
  - XAUUSD trade with INVALID entry price ($4383 vs real ~$2600)
  - NAS100 trade open during holiday

  ## Action
  Close these trades at $0 P&L with reason 'session_ended'
  Set sessions to 'system_stopped' status

  ## Trades Affected
  - gisselleb88 - XAUUSD (invalid entry price)
  - fatimaabimbola - NAS100 (market closed)

  ## BTCUSD trades are NOT affected (crypto is 24/7)
*/

-- Close XAUUSD trade with invalid entry price
UPDATE goal_session_trades
SET 
  status = 'closed',
  exit_price = entry_price,
  closed_at = NOW(),
  close_reason = 'session_ended',
  profit_loss = 0,
  current_pnl = 0,
  updated_at = NOW()
WHERE id = '2dcbfef9-950e-4f04-8b94-7fa9480e1f45'
  AND status = 'open'
  AND symbol = 'XAUUSD';

-- Close NAS100 trade (market closed on holiday)
UPDATE goal_session_trades
SET 
  status = 'closed',
  exit_price = entry_price,
  closed_at = NOW(),
  close_reason = 'session_ended',
  profit_loss = 0,
  current_pnl = 0,
  updated_at = NOW()
WHERE id = '8fd023ea-01e8-41be-9132-e6749d5c56f9'
  AND status = 'open'
  AND symbol = 'NAS100';

-- Update the corresponding sessions to system_stopped status
UPDATE goal_sessions
SET 
  status = 'system_stopped',
  completed_at = NOW(),
  updated_at = NOW()
WHERE id IN (
  SELECT goal_session_id 
  FROM goal_session_trades 
  WHERE id IN (
    '2dcbfef9-950e-4f04-8b94-7fa9480e1f45',
    '8fd023ea-01e8-41be-9132-e6749d5c56f9'
  )
);

-- End the scanning session for d_honey_kone (forex markets closed on holiday)
UPDATE goal_sessions
SET 
  status = 'system_stopped',
  completed_at = NOW(),
  updated_at = NOW()
WHERE id = 'eaea85ae-426b-48a7-9648-fa6b8bcc6980'
  AND status = 'scanning';
