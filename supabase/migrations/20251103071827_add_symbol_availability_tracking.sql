/*
  # Symbol Availability Tracking System

  1. New Table
    - `symbol_availability`
      - `symbol` (text, primary key) - Trading symbol (e.g., EURUSD, US30)
      - `available_for_historical` (boolean) - Whether historical data is available
      - `available_for_realtime` (boolean) - Whether realtime prices are available
      - `last_checked` (timestamptz) - When availability was last verified
      - `error_message` (text, nullable) - Error message if unavailable
      - `broker_symbol_name` (text, nullable) - Alternative broker symbol name
      - `created_at` (timestamptz) - Record creation timestamp
      - `updated_at` (timestamptz) - Record update timestamp

  2. Security
    - Enable RLS on `symbol_availability` table
    - Add policies for authenticated users to read availability data
    - Add policies for authenticated users to update availability (for validation)

  3. Indexes
    - Index on `symbol` for fast lookups
    - Index on `available_for_historical` for filtering available symbols
    - Index on `last_checked` for cache invalidation queries

  4. Purpose
    This table tracks which symbols are available for historical data fetching
    from the user's MetaAPI broker account, preventing repeated failed requests
    for unavailable symbols and improving user experience with clear feedback.
*/

-- Create symbol_availability table
CREATE TABLE IF NOT EXISTS symbol_availability (
  symbol TEXT PRIMARY KEY,
  available_for_historical BOOLEAN DEFAULT false,
  available_for_realtime BOOLEAN DEFAULT true,
  last_checked TIMESTAMPTZ DEFAULT now(),
  error_message TEXT,
  broker_symbol_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_symbol_availability_historical 
  ON symbol_availability(available_for_historical);

CREATE INDEX IF NOT EXISTS idx_symbol_availability_last_checked 
  ON symbol_availability(last_checked);

-- Enable RLS
ALTER TABLE symbol_availability ENABLE ROW LEVEL SECURITY;

-- Policy: Authenticated users can read all symbol availability data
CREATE POLICY "Authenticated users can read symbol availability"
  ON symbol_availability
  FOR SELECT
  TO authenticated
  USING (true);

-- Policy: Authenticated users can insert symbol availability records
CREATE POLICY "Authenticated users can insert symbol availability"
  ON symbol_availability
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Policy: Authenticated users can update symbol availability records
CREATE POLICY "Authenticated users can update symbol availability"
  ON symbol_availability
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_symbol_availability_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER symbol_availability_updated_at
  BEFORE UPDATE ON symbol_availability
  FOR EACH ROW
  EXECUTE FUNCTION update_symbol_availability_timestamp();

-- Insert default known working forex pairs
INSERT INTO symbol_availability (symbol, available_for_historical, available_for_realtime, error_message)
VALUES 
  ('EURUSD', true, true, NULL),
  ('GBPUSD', true, true, NULL),
  ('USDJPY', true, true, NULL),
  ('USDCHF', true, true, NULL),
  ('AUDUSD', true, true, NULL),
  ('USDCAD', true, true, NULL),
  ('NZDUSD', true, true, NULL),
  ('EURGBP', true, true, NULL),
  ('EURJPY', true, true, NULL),
  ('GBPJPY', true, true, NULL)
ON CONFLICT (symbol) DO NOTHING;
