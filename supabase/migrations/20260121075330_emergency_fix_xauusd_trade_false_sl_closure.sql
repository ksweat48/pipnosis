/*
  # Emergency Fix: XAUUSD Trade False Stop Loss Closure

  ## Critical Issue
  Trade da5ff1a1-cd16-446c-a6f4-e3d8a1bbf475 was incorrectly closed by a database trigger:
  - Stop loss was NEVER hit (exit price 30.31 pips ABOVE stop loss)
  - P&L calculated as -$1,500 instead of correct +$730.25
  - User balance never updated
  - Trade closed 96% faster than intended (6 min vs 153 min)

  ## Root Cause
  Database trigger used STOP LOSS PRICE instead of ACTUAL MARKET PRICE for P&L calculation

  ## User Impact
  - User: greenmorris.83@gmail.com (e6f3399f-deff-43af-b0fc-6ad8ad5ccb88)
  - Financial correction: +$2,230.25 ($730.25 profit + $1,500 incorrect loss removal)
*/

-- Step 1: Correct the trade record
UPDATE goal_session_trades
SET
  profit_loss = 730.25,
  close_reason = 'force_closed',
  close_reason_detail = 'SYSTEM ERROR CORRECTED: Trade was incorrectly closed by faulty database trigger. Stop loss was NEVER hit - exit price was 30.31 pips ABOVE stop loss. Price went UP making this profitable. Original incorrect P&L: -$1500. Corrected P&L: +$730.25. Root cause: Trigger used stop_loss price (4817.965) instead of actual market price (4848.27) for calculation. User has been credited correct profit amount.',
  updated_at = now()
WHERE id = 'da5ff1a1-cd16-446c-a6f4-e3d8a1bbf475';

-- Step 2: Update user balance
UPDATE user_token_balance
SET
  balance = 100730.25,
  updated_at = now()
WHERE user_id = 'e6f3399f-deff-43af-b0fc-6ad8ad5ccb88';

-- Step 3: Update session progress
UPDATE goal_sessions
SET
  current_progress = 730.25,
  progress_percentage = (730.25 / 2000.0) * 100,
  updated_at = now()
WHERE id = '3d891387-da9c-4afc-8f3d-7c0bf2315d83';