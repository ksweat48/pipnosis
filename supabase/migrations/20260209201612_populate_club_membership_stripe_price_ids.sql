/*
  # Populate Club Membership Stripe Price IDs

  1. Changes
    - Updates all 6 active club_membership_packages rows with their Stripe Price IDs

  2. Price ID Mapping
    - Member ($99): price_1Sz0nXAgtl79xlBV3VEUzPve
    - Starter ($250): price_1Sz0nXAgtl79xlBVYNcbaBRY
    - Builder ($500): price_1Sz0nXAgtl79xlBVSUDs1m4b
    - Pro ($1,000): price_1Sz0nXAgtl79xlBVwwQGUPUp
    - Elite Partner ($5,000): price_1Sz0nXAgtl79xlBVXQSnphkF
    - Founder ($10,000): price_1Sz0nXAgtl79xlBV230Ew2XN

  3. Important Notes
    - Only updates active packages matching by name and price
    - Inactive legacy tiers (Bronze, Silver, Gold) are not affected
*/

UPDATE club_membership_packages
SET stripe_price_id = 'price_1Sz0nXAgtl79xlBV3VEUzPve'
WHERE name = 'Member' AND price_usd = 99.00 AND is_active = true;

UPDATE club_membership_packages
SET stripe_price_id = 'price_1Sz0nXAgtl79xlBVYNcbaBRY'
WHERE name = 'Starter' AND price_usd = 250.00 AND is_active = true;

UPDATE club_membership_packages
SET stripe_price_id = 'price_1Sz0nXAgtl79xlBVSUDs1m4b'
WHERE name = 'Builder' AND price_usd = 500.00 AND is_active = true;

UPDATE club_membership_packages
SET stripe_price_id = 'price_1Sz0nXAgtl79xlBVwwQGUPUp'
WHERE name = 'Pro' AND price_usd = 1000.00 AND is_active = true;

UPDATE club_membership_packages
SET stripe_price_id = 'price_1Sz0nXAgtl79xlBVXQSnphkF'
WHERE name = 'Elite Partner' AND price_usd = 5000.00 AND is_active = true;

UPDATE club_membership_packages
SET stripe_price_id = 'price_1Sz0nXAgtl79xlBV230Ew2XN'
WHERE name = 'Founder' AND price_usd = 10000.00 AND is_active = true;
