/*
  # Create Token Packages System with Halved Credit Amounts

  1. New Tables
    - `token_packages`
      - `id` (uuid, primary key)
      - `package_type` (text) - 'onetime' or 'subscription'
      - `name` (text) - Display name of package
      - `description` (text) - Package description
      - `price_usd` (numeric) - Price in USD
      - `token_amount` (integer) - Number of credits in package
      - `cost_per_token` (numeric) - Calculated cost per credit
      - `is_active` (boolean) - Whether package is available
      - `display_order` (integer) - Order to display packages
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `token_packages` table
    - Add policy for authenticated users to read active packages

  3. Data
    - Insert 6 packages with NEW halved credit amounts:

      One-Time Packages ($0.30 per credit):
      - $15.00 = 50 credits (was 100)
      - $30.00 = 100 credits (was 200)
      - $60.00 = 200 credits (was 400)

      Subscription Packages ($0.20 per credit):
      - $10.00/month = 50 credits (was 100)
      - $20.00/month = 100 credits (was 200)
      - $50.00/month = 250 credits (was 500)
*/

-- Create token_packages table
CREATE TABLE IF NOT EXISTS token_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_type text NOT NULL CHECK (package_type IN ('onetime', 'subscription')),
  name text NOT NULL,
  description text,
  price_usd numeric(10,2) NOT NULL,
  token_amount integer NOT NULL CHECK (token_amount > 0),
  cost_per_token numeric(10,4) NOT NULL,
  is_active boolean DEFAULT true,
  display_order integer NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_token_packages_type_active
  ON token_packages(package_type, is_active, display_order);

-- Enable RLS
ALTER TABLE token_packages ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Authenticated users can read active packages" ON token_packages;

-- Allow authenticated users to read active packages
CREATE POLICY "Authenticated users can read active packages"
  ON token_packages FOR SELECT
  TO authenticated
  USING (is_active = true);

-- Insert one-time packages (Premium pricing: $0.30 per credit)
INSERT INTO token_packages (package_type, name, description, price_usd, token_amount, cost_per_token, is_active, display_order)
VALUES
  ('onetime', '50 Credits', 'One-time purchase', 15.00, 50, 0.30, true, 1),
  ('onetime', '100 Credits', 'One-time purchase', 30.00, 100, 0.30, true, 2),
  ('onetime', '200 Credits', 'One-time purchase', 60.00, 200, 0.30, true, 3)
ON CONFLICT DO NOTHING;

-- Insert subscription packages (Best value: $0.20 per credit)
INSERT INTO token_packages (package_type, name, description, price_usd, token_amount, cost_per_token, is_active, display_order)
VALUES
  ('subscription', '50 Credits', 'Monthly', 10.00, 50, 0.20, true, 4),
  ('subscription', '100 Credits', 'Monthly', 20.00, 100, 0.20, true, 5),
  ('subscription', '250 Credits', 'Monthly', 50.00, 250, 0.20, true, 6)
ON CONFLICT DO NOTHING;

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_token_packages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS token_packages_updated_at ON token_packages;

CREATE TRIGGER token_packages_updated_at
  BEFORE UPDATE ON token_packages
  FOR EACH ROW
  EXECUTE FUNCTION update_token_packages_updated_at();

COMMENT ON TABLE token_packages IS 'Stores available credit packages with NEW halved credit amounts (50% reduction from original pricing)';
