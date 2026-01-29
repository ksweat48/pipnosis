/*
  # Add Journal Entry Created Flag to Trades

  1. New Columns
    - `goal_session_trades.journal_entry_created` (boolean, default false)
      - Tracks whether journal entry was successfully created
      - Allows async retry of failed journal entries
      - Admin visibility into journal creation gaps

  2. Business Logic Change
    - Journal entry creation is now NON-BLOCKING for trade execution
    - Trades execute regardless of journal entry success/failure
    - Failed journal entries can be retried asynchronously
    - This prevents analytics failures from blocking live trading

  3. Security
    - No RLS changes (inherits from goal_session_trades)
    - Column is audit-only, doesn't affect trade execution

  IMPORTANT NOTES:
  - This is a mandatory non-blocking improvement
  - Solves data flow break where journal failure blocks trade execution
  - Allows platform to continue operating even if LLM logging fails
  - Administrators can see which trades are missing journal entries
*/

DO $$
BEGIN
  -- Add journal_entry_created column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'journal_entry_created'
  ) THEN
    ALTER TABLE goal_session_trades
    ADD COLUMN journal_entry_created boolean DEFAULT false;
    
    -- Create index for efficient queries of trades missing journal entries
    CREATE INDEX idx_goal_session_trades_journal_entry_created 
      ON goal_session_trades(user_id, journal_entry_created) 
      WHERE status IN ('open', 'closed');
    
    RAISE NOTICE 'Added journal_entry_created column to goal_session_trades';
  END IF;
END $$;
