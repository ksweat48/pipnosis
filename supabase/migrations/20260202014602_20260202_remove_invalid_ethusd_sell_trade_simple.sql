/*
  # Remove Invalid ETHUSD SELL Trade - Geometry Fix

  Issue: Trade with invalid TP (exit > entry for SELL direction)
  - Trade ID: da3cbc21-5714-4a16-bed4-47123f0ea49a
  - Symbol: ETHUSD, Direction: SELL
  - Entry: 2252.77158, Exit: 2308.03000 (WRONG - should be < entry)
  - P&L: -97.25 (loss from invalid exit)
  - User: 91905a02-cf9e-4537-9920-98a4b790830a

  Action: Remove trade and reset user balance
*/

-- Step 1: Remove the invalid trade
DELETE FROM goal_session_trades 
WHERE id = 'da3cbc21-5714-4a16-bed4-47123f0ea49a'::UUID;

-- Step 2: Reverse the user's balance impact (+97.25)
UPDATE user_profiles
SET account_balance = account_balance + 97.2548164335598400000,
    updated_at = NOW()
WHERE id = '91905a02-cf9e-4537-9920-98a4b790830a'::UUID;

-- Step 3: Verify removal
DO $$
DECLARE
  v_trade_exists BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM goal_session_trades 
    WHERE id = 'da3cbc21-5714-4a16-bed4-47123f0ea49a'::UUID
  ) INTO v_trade_exists;

  IF v_trade_exists THEN
    RAISE WARNING 'Trade still exists after deletion attempt';
  ELSE
    RAISE NOTICE 'Invalid ETHUSD SELL trade removed | Balance reversed: +97.25';
  END IF;
END $$;
