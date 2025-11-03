/*
  # Link Goal Session Trades to Simulated Positions

  1. Changes
    - Add `simulated_position_id` column to `goal_session_trades` table
    - Add foreign key constraint to link to `simulated_positions`
    - Add index for efficient lookups

  2. Purpose
    - Enables bidirectional sync between goal trading system and position monitoring
    - Allows position monitor to update goal trades when positions close
    - Tracks which simulated position corresponds to each goal trade
*/

DO $$
BEGIN
  -- Add simulated_position_id column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'simulated_position_id'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN simulated_position_id uuid;

    -- Add foreign key constraint
    ALTER TABLE goal_session_trades
      ADD CONSTRAINT fk_goal_trades_simulated_position
      FOREIGN KEY (simulated_position_id)
      REFERENCES simulated_positions(id)
      ON DELETE SET NULL;

    -- Add index for efficient lookups from simulated_positions
    CREATE INDEX IF NOT EXISTS idx_goal_trades_simulated_position
      ON goal_session_trades(simulated_position_id);

    COMMENT ON COLUMN goal_session_trades.simulated_position_id IS 'Links to the corresponding simulated position for automatic monitoring and closure';
  END IF;
END $$;
