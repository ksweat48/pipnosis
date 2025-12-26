/*
  # Fix Token Packages with Correct Pricing

  1. Changes
    - Delete existing token packages
    - Insert correct pricing structure

  2. New Pricing Structure

    One-Time Packages ($0.25 per credit):
    - $15.00 = 60 credits
    - $25.00 = 100 credits
    - $50.00 = 200 credits

    Subscription Packages ($0.20 per credit):
    - $12.00/month = 60 credits
    - $20.00/month = 100 credits
    - $40.00/month = 200 credits
*/

-- Delete existing packages
DELETE FROM token_packages;

-- Insert one-time packages (Premium pricing: $0.25 per credit)
INSERT INTO token_packages (package_type, name, description, price_usd, token_amount, cost_per_token, is_active, display_order)
VALUES
  ('onetime', '60 Credits', 'One-time purchase', 15.00, 60, 0.25, true, 1),
  ('onetime', '100 Credits', 'One-time purchase', 25.00, 100, 0.25, true, 2),
  ('onetime', '200 Credits', 'One-time purchase', 50.00, 200, 0.25, true, 3);

-- Insert subscription packages (Best value: $0.20 per credit)
INSERT INTO token_packages (package_type, name, description, price_usd, token_amount, cost_per_token, is_active, display_order)
VALUES
  ('subscription', '60 Credits', 'Monthly', 12.00, 60, 0.20, true, 4),
  ('subscription', '100 Credits', 'Monthly', 20.00, 100, 0.20, true, 5),
  ('subscription', '200 Credits', 'Monthly', 40.00, 200, 0.20, true, 6);
