/*
  # Add Bonus Credits and Package Badges

  1. Changes
    - Add bonus credits to higher one-time packages for psychological differentiation
    - Add badge column to highlight popular packages
    
  2. New One-Time Package Structure
    - $15.00 = 60 credits (no bonus - entry tier)
    - $25.00 = 105 credits (+5 bonus - better value)
    - $50.00 = 215 credits (+15 bonus - best value for one-time)
    
  3. Subscription Badges
    - Add "Most Popular" badge to 100-credit tier
*/

-- Add badge column to token_packages
ALTER TABLE token_packages ADD COLUMN IF NOT EXISTS badge TEXT;

-- Update one-time packages with bonus credits
UPDATE token_packages 
SET token_amount = 60, cost_per_token = 0.25
WHERE package_type = 'onetime' AND price_usd = 15.00;

UPDATE token_packages 
SET token_amount = 105, cost_per_token = 0.238
WHERE package_type = 'onetime' AND price_usd = 25.00;

UPDATE token_packages 
SET token_amount = 215, cost_per_token = 0.233
WHERE package_type = 'onetime' AND price_usd = 50.00;

-- Add "Most Popular" badge to 100-credit subscription
UPDATE token_packages 
SET badge = 'Most Popular'
WHERE package_type = 'subscription' AND token_amount = 100;
