/*
  # Fix $40/month subscription Stripe Price ID -- SSOT Restoration

  ## CCIP Change Control Record
  - **Change Type:** Data correction (single column update)
  - **Root Cause:** Migration 20260209200822 incorrectly assumed Stripe Price
    `price_1Sz0ESAgtl79xlBViXdGFJ0O` was $49/mo. It was always $40/mo in Stripe.
    Migration 20260214070311 then set stripe_price_id = NULL because it believed
    the price had changed. Since the Stripe price was always $40, the original
    price ID is still valid and must be restored.
  - **SSOT Authority:** `token_packages` table is the single source of truth
    for package pricing and Stripe integration. Frontend and backend both
    read from this table dynamically -- no hardcoded price IDs exist elsewhere.
  - **Affected Table:** `token_packages`
  - **Affected Row:** UUID `f6d05e31-b084-4eae-ab05-bd496131018f`
    ($40/mo subscription, 1000 credits, "Best Value" badge)
  - **Impact:** Restores checkout capability for the $40/month subscription
    package which is currently broken (stripe_price_id is NULL, causing 400
    errors on purchase attempts).
  - **Compatibility Check:** No schema changes. Single UPDATE on one row.
    Frontend (CreditsPage.tsx) and backend (stripe-create-checkout-session.ts)
    both read stripe_price_id dynamically -- no code changes needed.
  - **Verification:** After applying, the package should have:
    - price_usd = 40.00
    - stripe_price_id = 'price_1Sz0ESAgtl79xlBViXdGFJ0O'
    - Stripe checkout should succeed for this package

  1. Modified Tables
    - `token_packages`
      - Row `f6d05e31-b084-4eae-ab05-bd496131018f`: set `stripe_price_id`
        from NULL to `price_1Sz0ESAgtl79xlBViXdGFJ0O`

  2. Security
    - No RLS changes (existing policies remain intact)
    - No new tables or columns

  3. Governance
    - Corrects a data integrity issue introduced by migration 20260209200822
    - Aligns database SSOT with actual Stripe configuration
*/

UPDATE token_packages
SET
  stripe_price_id = 'price_1Sz0ESAgtl79xlBViXdGFJ0O',
  updated_at = NOW()
WHERE id = 'f6d05e31-b084-4eae-ab05-bd496131018f'
  AND price_usd = 40.00
  AND package_type = 'subscription'
  AND stripe_price_id IS NULL;
