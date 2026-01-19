/*
  # Update Credit Packages to 10x Credit Amounts for Stripe Integration

  1. Changes
    - Delete all existing token packages
    - Insert new pricing structure with 10x more credits per dollar

  2. New Pricing Structure

    One-Time Packages ($0.025 per credit):
    - $25.00 = 1000 credits
    - $50.00 = 2100 credits (+100 bonus)
    - $100.00 = 4200 credits (+200 bonus)

    Subscription Packages ($0.020 per credit):
    - $20.00/month = 1000 credits
    - $40.00/month = 2100 credits (+100 bonus)
    - $80.00/month = 4200 credits (+200 bonus)

  3. Purpose
    - Prepare for Stripe payment integration
    - Align with new credit economy (1 credit per trade)
    - Add stripe_price_id column for Stripe integration

  4. Security
    - All existing RLS policies remain in place
*/

-- Add stripe_price_id column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'token_packages' AND column_name = 'stripe_price_id'
  ) THEN
    ALTER TABLE token_packages ADD COLUMN stripe_price_id text UNIQUE;
  END IF;
END $$;

-- Delete all existing packages
DELETE FROM token_packages;

-- Insert one-time packages with new 10x credit amounts
INSERT INTO token_packages (package_type, name, description, price_usd, token_amount, cost_per_token, is_active, display_order, badge, stripe_price_id)
VALUES
  ('onetime', '1000 Credits', 'One-time purchase', 25.00, 1000, 0.0250, true, 1, NULL, NULL),
  ('onetime', '2100 Credits', 'One-time purchase', 50.00, 2100, 0.0238, true, 2, NULL, NULL),
  ('onetime', '4200 Credits', 'One-time purchase', 100.00, 4200, 0.0238, true, 3, 'Best Value', NULL);

-- Insert subscription packages with new 10x credit amounts
INSERT INTO token_packages (package_type, name, description, price_usd, token_amount, cost_per_token, is_active, display_order, badge, stripe_price_id)
VALUES
  ('subscription', '1000 Credits', 'Monthly', 20.00, 1000, 0.0200, true, 4, NULL, NULL),
  ('subscription', '2100 Credits', 'Monthly', 40.00, 2100, 0.0190, true, 5, 'Most Popular', NULL),
  ('subscription', '4200 Credits', 'Monthly', 80.00, 4200, 0.0190, true, 6, 'Best Value', NULL);

COMMENT ON COLUMN token_packages.stripe_price_id IS 'Stripe Price ID for payment integration';
