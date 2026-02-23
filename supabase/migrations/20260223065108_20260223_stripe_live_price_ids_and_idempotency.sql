/*
  # Stripe Live Mode Price IDs + Webhook Idempotency

  ## Summary
  Switches all Stripe price IDs from test mode to live mode and creates
  the idempotency infrastructure to prevent double-crediting on webhook replays.

  ## Changes

  ### 1. token_packages — live price IDs
  Updates stripe_price_id for all 6 credit packages using their database UUIDs:
    - 250  credits / $15  one-time     → price_1T3rdqAYN1gLpLfVAowhsRUX
    - 500  credits / $25  one-time     → price_1T3rg5AYN1gLpLfVUrwWcVyp
    - 1000 credits / $50  one-time     → price_1T3rg5AYN1gLpLfVjodXM2wk
    - 500  credits / $20  subscription → price_1T3rlCAYN1gLpLfVPOeUnm0H
    - 1000 credits / $40  subscription → price_1T3rmCAYN1gLpLfVKbcErkww
    - 2000 credits / $80  subscription → price_1T3rmgAYN1gLpLfVDX9Nf5Da

  ### 2. club_membership_packages — live price IDs
  Updates stripe_price_id for all 6 active membership tiers:
    - Member       $99     → price_1T3rw9AYN1gLpLfVAesWXwLw
    - Starter      $250    → price_1T3rwvAYN1gLpLfV31JY7yP0
    - Builder      $500    → price_1T3ry4AYN1gLpLfVQGHsLnQz
    - Pro          $1000   → price_1T3rywAYN1gLpLfVoKCgsW2W
    - Elite Partner $5000  → price_1T3rzaAYN1gLpLfVoOAmzK5m
    - Founder      $10000  → price_1T3s0EAYN1gLpLfVYNLd6V7x

  ### 3. stripe_webhook_events table (idempotency)
  New table that records every Stripe event ID that has been successfully
  processed. The webhook handler checks this table before processing and
  skips duplicate events silently.

  ### Security
  - RLS enabled on stripe_webhook_events
  - Only service_role can insert / read (webhook handler uses service role key)
  - No user-level access needed or granted
*/

-- ─────────────────────────────────────────────
-- 1. token_packages live price IDs (by exact UUID)
-- ─────────────────────────────────────────────

UPDATE token_packages SET stripe_price_id = 'price_1T3rdqAYN1gLpLfVAowhsRUX'
WHERE id = '39bef65b-1c44-49c5-af07-485b485f3274'; -- 250 Credits $15 one-time

UPDATE token_packages SET stripe_price_id = 'price_1T3rg5AYN1gLpLfVUrwWcVyp'
WHERE id = '93805176-0408-4807-815f-cdb78cd4b37f'; -- 500 Credits $25 one-time

UPDATE token_packages SET stripe_price_id = 'price_1T3rg5AYN1gLpLfVjodXM2wk'
WHERE id = '21e0bb2f-9f4b-4f5b-8177-e1587d2b9f75'; -- 1000 Credits $50 one-time

UPDATE token_packages SET stripe_price_id = 'price_1T3rlCAYN1gLpLfVPOeUnm0H'
WHERE id = '27971fda-f0d0-4ea3-956e-1600dad2cb7c'; -- 500 Credits $20 subscription

UPDATE token_packages SET stripe_price_id = 'price_1T3rmCAYN1gLpLfVKbcErkww'
WHERE id = 'f6d05e31-b084-4eae-ab05-bd496131018f'; -- 1000 Credits $40 subscription

UPDATE token_packages SET stripe_price_id = 'price_1T3rmgAYN1gLpLfVDX9Nf5Da'
WHERE id = '80ba7c24-ff02-4028-a57a-37c6497f2796'; -- 2000 Credits $80 subscription

-- ─────────────────────────────────────────────
-- 2. club_membership_packages live price IDs (by exact UUID)
-- ─────────────────────────────────────────────

UPDATE club_membership_packages SET stripe_price_id = 'price_1T3rw9AYN1gLpLfVAesWXwLw'
WHERE id = 'fbda0632-ca0a-40e1-bc31-c31021a54f72'; -- Member $99

UPDATE club_membership_packages SET stripe_price_id = 'price_1T3rwvAYN1gLpLfV31JY7yP0'
WHERE id = '083a19f0-b469-45ea-8c3e-7e3dc1b07f56'; -- Starter $250

UPDATE club_membership_packages SET stripe_price_id = 'price_1T3ry4AYN1gLpLfVQGHsLnQz'
WHERE id = '8845894c-998c-4bb4-84de-0ca303b73e8b'; -- Builder $500

UPDATE club_membership_packages SET stripe_price_id = 'price_1T3rywAYN1gLpLfVoKCgsW2W'
WHERE id = '7de89028-8afe-42d6-9d9e-7216d5b16c60'; -- Pro $1000

UPDATE club_membership_packages SET stripe_price_id = 'price_1T3rzaAYN1gLpLfVoOAmzK5m'
WHERE id = '54b32266-8b85-4898-a1be-aea9a2872e37'; -- Elite Partner $5000

UPDATE club_membership_packages SET stripe_price_id = 'price_1T3s0EAYN1gLpLfVYNLd6V7x'
WHERE id = '1f64088b-1147-44c0-9a82-76859e54d5a0'; -- Founder $10000

-- ─────────────────────────────────────────────
-- 3. Webhook idempotency table
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text        UNIQUE NOT NULL,
  event_type      text        NOT NULL,
  processed_at    timestamptz NOT NULL DEFAULT now(),
  user_id         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata        jsonb       DEFAULT '{}'::jsonb
);

ALTER TABLE stripe_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can insert webhook events"
  ON stripe_webhook_events
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can select webhook events"
  ON stripe_webhook_events
  FOR SELECT
  TO service_role
  USING (true);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_event_id
  ON stripe_webhook_events (stripe_event_id);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_processed_at
  ON stripe_webhook_events (processed_at DESC);

-- ─────────────────────────────────────────────
-- 4. Subscription status tracking table
--    (uses a name that doesn't conflict with existing stripe_* tables)
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_subscription_status (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id     text,
  stripe_subscription_id text,
  status                 text        NOT NULL DEFAULT 'none'
                           CHECK (status IN ('active', 'past_due', 'canceled', 'unpaid', 'none', 'trialing')),
  plan_name              text,
  package_id             uuid        REFERENCES token_packages(id) ON DELETE SET NULL,
  credit_amount          integer     DEFAULT 0,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean     NOT NULL DEFAULT false,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_subscription_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own subscription status"
  ON user_subscription_status
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert subscription status"
  ON user_subscription_status
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update subscription status"
  ON user_subscription_status
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_user_subscription_status_user_id
  ON user_subscription_status (user_id);

CREATE INDEX IF NOT EXISTS idx_user_subscription_status_sub_id
  ON user_subscription_status (stripe_subscription_id);
