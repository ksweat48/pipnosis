/*
  # Create Simulated Positions Table for Paper Trading

  1. New Tables
    - `simulated_positions`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to user_profiles)
      - `symbol` (text, e.g., EURUSD)
      - `position_type` (text, 'buy' or 'sell')
      - `order_type` (text, 'market' or 'limit')
      - `lot_size` (numeric, default 0.01)
      - `entry_price` (numeric, actual execution price)
      - `limit_price` (numeric, for pending limit orders)
      - `stop_loss` (numeric, stop loss price level)
      - `take_profit` (numeric, take profit price level)
      - `status` (text, 'pending', 'open', or 'closed')
      - `current_price` (numeric, last known price)
      - `current_pnl` (numeric, unrealized P&L)
      - `opened_at` (timestamptz)
      - `closed_at` (timestamptz)
      - `close_reason` (text, 'manual', 'stop_loss', 'take_profit')
      
    - `balance_transactions`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key)
      - `transaction_type` (text)
      - `amount` (numeric)
      - `balance_before` (numeric)
      - `balance_after` (numeric)
      - `position_id` (uuid, nullable reference)
      - `description` (text)
      - `created_at` (timestamptz)

  2. Changes to Existing Tables
    - Add `demo_balance` column to `user_profiles` table
    - Set default value to 10000.00
    - Update existing users to have initial demo balance

  3. Security
    - Enable RLS on both new tables
    - Users can only view and manage their own positions
    - Users can only view their own transactions
    - Admins can view all records

  4. Indexes
    - Index on user_id and status for fast position queries
    - Index on symbol for filtering by currency pair
    - Index on opened_at for historical tracking
*/

-- ============================================================================
-- STEP 1: Add demo_balance column to user_profiles
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_profiles' AND column_name = 'demo_balance'
  ) THEN
    ALTER TABLE user_profiles ADD COLUMN demo_balance numeric(15,2) DEFAULT 10000.00;
    
    -- Initialize demo_balance for existing users
    UPDATE user_profiles SET demo_balance = 10000.00 WHERE demo_balance IS NULL;
  END IF;
END $$;

-- ============================================================================
-- STEP 2: Create simulated_positions table
-- ============================================================================

CREATE TABLE IF NOT EXISTS simulated_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  position_type text NOT NULL CHECK (position_type IN ('buy', 'sell')),
  order_type text NOT NULL CHECK (order_type IN ('market', 'limit')),
  lot_size numeric(10,2) NOT NULL DEFAULT 0.01,
  entry_price numeric(15,5),
  limit_price numeric(15,5),
  stop_loss numeric(15,5),
  take_profit numeric(15,5),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'open', 'closed')),
  current_price numeric(15,5),
  current_pnl numeric(15,2) DEFAULT 0,
  opened_at timestamptz DEFAULT now(),
  closed_at timestamptz,
  close_reason text CHECK (close_reason IN ('manual', 'stop_loss', 'take_profit')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- STEP 3: Create balance_transactions table
-- ============================================================================

CREATE TABLE IF NOT EXISTS balance_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  transaction_type text NOT NULL CHECK (transaction_type IN ('deposit', 'withdrawal', 'trade_pnl', 'margin_reserve', 'margin_release')),
  amount numeric(15,2) NOT NULL,
  balance_before numeric(15,2) NOT NULL,
  balance_after numeric(15,2) NOT NULL,
  position_id uuid REFERENCES simulated_positions(id) ON DELETE SET NULL,
  description text,
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- STEP 4: Create indexes for performance
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_simulated_positions_user_status 
  ON simulated_positions(user_id, status);

CREATE INDEX IF NOT EXISTS idx_simulated_positions_symbol 
  ON simulated_positions(symbol);

CREATE INDEX IF NOT EXISTS idx_simulated_positions_opened_at 
  ON simulated_positions(opened_at DESC);

CREATE INDEX IF NOT EXISTS idx_balance_transactions_user 
  ON balance_transactions(user_id, created_at DESC);

-- ============================================================================
-- STEP 5: Enable Row Level Security
-- ============================================================================

ALTER TABLE simulated_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE balance_transactions ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- STEP 6: Create RLS Policies for simulated_positions
-- ============================================================================

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view own positions" ON simulated_positions;
DROP POLICY IF EXISTS "Users can insert own positions" ON simulated_positions;
DROP POLICY IF EXISTS "Users can update own positions" ON simulated_positions;
DROP POLICY IF EXISTS "Admins can view all positions" ON simulated_positions;

-- Users can view their own positions
CREATE POLICY "Users can view own positions"
  ON simulated_positions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can insert their own positions
CREATE POLICY "Users can insert own positions"
  ON simulated_positions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own positions
CREATE POLICY "Users can update own positions"
  ON simulated_positions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Admins can view all positions
CREATE POLICY "Admins can view all positions"
  ON simulated_positions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- ============================================================================
-- STEP 7: Create RLS Policies for balance_transactions
-- ============================================================================

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view own transactions" ON balance_transactions;
DROP POLICY IF EXISTS "Users can insert own transactions" ON balance_transactions;
DROP POLICY IF EXISTS "Admins can view all transactions" ON balance_transactions;

-- Users can view their own transactions
CREATE POLICY "Users can view own transactions"
  ON balance_transactions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can insert their own transactions
CREATE POLICY "Users can insert own transactions"
  ON balance_transactions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Admins can view all transactions
CREATE POLICY "Admins can view all transactions"
  ON balance_transactions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- ============================================================================
-- STEP 8: Create trigger for updating updated_at timestamp
-- ============================================================================

CREATE OR REPLACE FUNCTION update_simulated_positions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_simulated_positions_updated_at_trigger ON simulated_positions;

CREATE TRIGGER update_simulated_positions_updated_at_trigger
  BEFORE UPDATE ON simulated_positions
  FOR EACH ROW
  EXECUTE FUNCTION update_simulated_positions_updated_at();
