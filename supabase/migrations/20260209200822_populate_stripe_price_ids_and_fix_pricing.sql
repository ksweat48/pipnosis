/*
  # Populate Stripe Price IDs and Fix Subscription Pricing

  1. Changes
    - Updates all 6 token_packages rows with their actual Stripe Price IDs
    - Fixes the 2100 subscription tier price from $40.00/mo to $49.00/mo to match Stripe
    - Recalculates cost_per_token for the updated subscription tier

  2. Price ID Mapping
    - 1000 Credits onetime ($25): price_1Sz0AZAgtl79xlBVjG5DftjR
    - 2100 Credits onetime ($50): price_1Sz0AZAgtl79xlBVrrR16C1B
    - 4200 Credits onetime ($100): price_1Sz0AZAgtl79xlBVKWApvtMC
    - 1000 Credits subscription ($20/mo): price_1Sz0ESAgtl79xlBV3COi8KhC
    - 2100 Credits subscription ($49/mo): price_1Sz0ESAgtl79xlBViXdGFJ0O
    - 4200 Credits subscription ($80/mo): price_1Sz0ESAgtl79xlBVSoSjex4j

  3. Important Notes
    - All Price IDs are from Stripe test mode
    - The 2100 subscription tier is updated from $40 to $49 to match the Stripe product
*/

UPDATE token_packages
SET stripe_price_id = 'price_1Sz0AZAgtl79xlBVjG5DftjR'
WHERE package_type = 'onetime' AND token_amount = 1000 AND price_usd = 25.00;

UPDATE token_packages
SET stripe_price_id = 'price_1Sz0AZAgtl79xlBVrrR16C1B'
WHERE package_type = 'onetime' AND token_amount = 2100 AND price_usd = 50.00;

UPDATE token_packages
SET stripe_price_id = 'price_1Sz0AZAgtl79xlBVKWApvtMC'
WHERE package_type = 'onetime' AND token_amount = 4200 AND price_usd = 100.00;

UPDATE token_packages
SET stripe_price_id = 'price_1Sz0ESAgtl79xlBV3COi8KhC'
WHERE package_type = 'subscription' AND token_amount = 1000 AND price_usd = 20.00;

UPDATE token_packages
SET stripe_price_id = 'price_1Sz0ESAgtl79xlBViXdGFJ0O',
    price_usd = 49.00,
    cost_per_token = 0.0233
WHERE package_type = 'subscription' AND token_amount = 2100;

UPDATE token_packages
SET stripe_price_id = 'price_1Sz0ESAgtl79xlBVSoSjex4j'
WHERE package_type = 'subscription' AND token_amount = 4200 AND price_usd = 80.00;
