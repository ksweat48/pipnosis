/*
  # Update Credit Packages to Final Pricing Structure

  1. Changes
    - Delete all existing token packages
    - Insert new pricing structure with higher credit amounts

  2. New Pricing Structure

    One-Time Packages ($0.25 per credit base, with bonuses):
    - $25.00 = 100 credits ($0.25 per credit)
    - $50.00 = 210 credits ($0.238 per credit - 10 bonus)
    - $100.00 = 420 credits ($0.238 per credit - 20 bonus)

    Subscription Packages (Best value - $0.20 per credit base, with bonuses):
    - $20.00/month = 100 credits ($0.20 per credit)
    - $40.00/month = 210 credits ($0.190 per credit - 10 bonus)
    - $80.00/month = 420 credits ($0.190 per credit - 20 bonus)

  3. Security
    - All existing RLS policies remain in place
*/

-- Delete all existing packages
DELETE FROM token_packages;

-- Insert one-time packages with new pricing
INSERT INTO token_packages (package_type, name, description, price_usd, token_amount, cost_per_token, is_active, display_order, badge)
VALUES
  ('onetime', '100 Credits', 'One-time purchase', 25.00, 100, 0.2500, true, 1, NULL),
  ('onetime', '210 Credits', 'One-time purchase', 50.00, 210, 0.2381, true, 2, NULL),
  ('onetime', '420 Credits', 'One-time purchase', 100.00, 420, 0.2381, true, 3, 'Best Value');

-- Insert subscription packages with new pricing
INSERT INTO token_packages (package_type, name, description, price_usd, token_amount, cost_per_token, is_active, display_order, badge)
VALUES
  ('subscription', '100 Credits', 'Monthly', 20.00, 100, 0.2000, true, 4, NULL),
  ('subscription', '210 Credits', 'Monthly', 40.00, 210, 0.1905, true, 5, 'Most Popular'),
  ('subscription', '420 Credits', 'Monthly', 80.00, 420, 0.1905, true, 6, 'Best Value');