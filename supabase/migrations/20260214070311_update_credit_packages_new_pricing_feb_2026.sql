/*
  # Update Credit Packages - New Pricing February 2026

  ## Changes
  ### One-Time Packages (3 tiers)
  1. $15 = 250 credits (NEW package)
  2. $25 = 500 credits (Best Value badge) - updated from 1000 credits
  3. $50 = 1000 credits - updated from 2100 credits
  - Deactivate old $100 / 4200 credits package

  ### Subscription Packages (3 tiers)
  1. $20/mo = 500 credits - updated from 1000 credits
  2. $40/mo = 1000 credits (Best Value badge) - updated from $49/2100 credits
  3. $80/mo = 2000 credits - updated from 4200 credits

  ## Badge Changes
  - Remove all existing "Best Value" and "Most Popular" badges
  - Add "Best Value" badge only to: $25 onetime and $40/mo subscription

  ## Stripe Price IDs
  - $15 onetime: price_1T0caHAgtl79xlBV3rtH0MmP (new)
  - $25 onetime: reuses existing price_1Sz0AZAgtl79xlBVjG5DftjR (same $ amount)
  - $50 onetime: reuses existing price_1Sz0AZAgtl79xlBVrrR16C1B (same $ amount)
  - $20/mo sub: reuses existing price_1Sz0ESAgtl79xlBV3COi8KhC (same $ amount)
  - $40/mo sub: NEEDS NEW STRIPE PRICE ID (was $49, now $40)
  - $80/mo sub: reuses existing price_1Sz0ESAgtl79xlBVSoSjex4j (same $ amount)

  ## SSOT Authority
  - Package definitions: `token_packages` table
  - Stripe Price mapping: `stripe_price_id` column
*/

-- Step 1: Clear all existing badges
UPDATE token_packages SET badge = NULL WHERE badge IS NOT NULL;

-- Step 2: Update One-Time Package 1 ($25 -> $15, 1000cr -> 250cr)
UPDATE token_packages
SET
  name = '250 Credits',
  price_usd = 15.00,
  token_amount = 250,
  cost_per_token = 0.0600,
  stripe_price_id = 'price_1T0caHAgtl79xlBV3rtH0MmP',
  badge = NULL,
  display_order = 1,
  updated_at = NOW()
WHERE id = '39bef65b-1c44-49c5-af07-485b485f3274';

-- Step 3: Update One-Time Package 2 ($50 -> $25, 2100cr -> 500cr, Best Value)
UPDATE token_packages
SET
  name = '500 Credits',
  price_usd = 25.00,
  token_amount = 500,
  cost_per_token = 0.0500,
  stripe_price_id = 'price_1Sz0AZAgtl79xlBVjG5DftjR',
  badge = 'Best Value',
  display_order = 2,
  updated_at = NOW()
WHERE id = '93805176-0408-4807-815f-cdb78cd4b37f';

-- Step 4: Update One-Time Package 3 ($100 -> $50, 4200cr -> 1000cr)
UPDATE token_packages
SET
  name = '1000 Credits',
  price_usd = 50.00,
  token_amount = 1000,
  cost_per_token = 0.0500,
  stripe_price_id = 'price_1Sz0AZAgtl79xlBVrrR16C1B',
  badge = NULL,
  display_order = 3,
  is_active = true,
  updated_at = NOW()
WHERE id = '21e0bb2f-9f4b-4f5b-8177-e1587d2b9f75';

-- Step 5: Update Subscription Package 1 ($20, 1000cr -> 500cr)
UPDATE token_packages
SET
  name = '500 Credits',
  price_usd = 20.00,
  token_amount = 500,
  cost_per_token = 0.0400,
  badge = NULL,
  display_order = 4,
  updated_at = NOW()
WHERE id = '27971fda-f0d0-4ea3-956e-1600dad2cb7c';

-- Step 6: Update Subscription Package 2 ($49 -> $40, 2100cr -> 1000cr, Best Value)
-- NOTE: stripe_price_id set to NULL because price changed from $49 to $40
-- A new Stripe Price must be created in Stripe Dashboard for $40/mo recurring
UPDATE token_packages
SET
  name = '1000 Credits',
  price_usd = 40.00,
  token_amount = 1000,
  cost_per_token = 0.0400,
  stripe_price_id = NULL,
  badge = 'Best Value',
  display_order = 5,
  updated_at = NOW()
WHERE id = 'f6d05e31-b084-4eae-ab05-bd496131018f';

-- Step 7: Update Subscription Package 3 ($80, 4200cr -> 2000cr)
UPDATE token_packages
SET
  name = '2000 Credits',
  price_usd = 80.00,
  token_amount = 2000,
  cost_per_token = 0.0400,
  badge = NULL,
  display_order = 6,
  updated_at = NOW()
WHERE id = '80ba7c24-ff02-4028-a57a-37c6497f2796';
