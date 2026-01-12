/*
  # Market Data RLS Policies

  1. Enable RLS on market data tables
  2. Create policies:
    - Public read access for market data
    - Authenticated write access for market data
    - Authenticated access for subscriptions
*/

-- Enable RLS
ALTER TABLE market_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_data_subscriptions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS "Anyone can read market data" ON market_data;
DROP POLICY IF EXISTS "Authenticated users can insert market data" ON market_data;
DROP POLICY IF EXISTS "Authenticated users can update market data" ON market_data;
DROP POLICY IF EXISTS "Authenticated users can read subscriptions" ON market_data_subscriptions;
DROP POLICY IF EXISTS "Authenticated users can manage subscriptions" ON market_data_subscriptions;

-- Market Data Policies (public read, authenticated write)
CREATE POLICY "Anyone can read market data"
  ON market_data FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert market data"
  ON market_data FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update market data"
  ON market_data FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Market Data Subscriptions Policies
CREATE POLICY "Authenticated users can read subscriptions"
  ON market_data_subscriptions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage subscriptions"
  ON market_data_subscriptions FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);