# Stripe Payment Integration - Complete Setup Guide

**Last Updated:** 2026-01-19
**Status:** ✅ Ready for Integration

---

## Overview

Pipnosis now supports secure credit purchases through Stripe with:
- **One-time purchases:** $25 (1000 credits), $50 (2100 credits), $100 (4200 credits)
- **Monthly subscriptions:** $20 (1000 credits), $40 (2100 credits), $80 (4200 credits)
- Automatic credit delivery after payment
- Subscription renewal handling
- Webhook-based verification

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Stripe Dashboard Setup](#stripe-dashboard-setup)
3. [Creating Products & Prices](#creating-products--prices)
4. [Configuring Webhooks](#configuring-webhooks)
5. [Environment Variables](#environment-variables)
6. [Testing](#testing)
7. [Going Live](#going-live)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before starting, ensure you have:
- [x] Stripe account (sign up at https://stripe.com)
- [x] Access to Netlify dashboard
- [x] Supabase project configured
- [x] Admin access to deploy code

---

## Stripe Dashboard Setup

### Step 1: Create or Log Into Stripe Account

1. Go to https://dashboard.stripe.com/
2. Create account or log in
3. Complete business verification (required for live mode)

### Step 2: Get API Keys

1. Navigate to **Developers** → **API keys**
2. You'll see two keys:
   - **Publishable key:** `pk_test_...` (safe to expose in browser)
   - **Secret key:** `sk_test_...` (MUST remain server-side)
3. Copy both keys - you'll need them later

**🔒 Security:** NEVER commit secret keys to Git or expose them in frontend code!

---

## Creating Products & Prices

You need to create 6 products in Stripe Dashboard - 3 one-time and 3 subscriptions.

### One-Time Products

#### Product 1: 1000 Credits Package
1. Go to **Products** → **Add product**
2. Fill in:
   - **Name:** 1000 Credits
   - **Description:** One-time purchase of 1000 trading credits
   - **Pricing:**
     - **One-time payment**
     - **Price:** $25.00 USD
3. Click **Save product**
4. **Copy the Price ID** (starts with `price_...`)
5. Update `token_packages` table:
   ```sql
   UPDATE token_packages
   SET stripe_price_id = 'price_YOUR_ACTUAL_PRICE_ID'
   WHERE package_type = 'onetime' AND token_amount = 1000;
   ```

#### Product 2: 2100 Credits Package
1. Go to **Products** → **Add product**
2. Fill in:
   - **Name:** 2100 Credits
   - **Description:** One-time purchase of 2100 trading credits (includes 100 bonus)
   - **Pricing:**
     - **One-time payment**
     - **Price:** $50.00 USD
3. Click **Save product**
4. **Copy the Price ID**
5. Update database:
   ```sql
   UPDATE token_packages
   SET stripe_price_id = 'price_YOUR_ACTUAL_PRICE_ID'
   WHERE package_type = 'onetime' AND token_amount = 2100;
   ```

#### Product 3: 4200 Credits Package
1. Go to **Products** → **Add product**
2. Fill in:
   - **Name:** 4200 Credits
   - **Description:** One-time purchase of 4200 trading credits (includes 200 bonus) - Best Value
   - **Pricing:**
     - **One-time payment**
     - **Price:** $100.00 USD
3. Click **Save product**
4. **Copy the Price ID**
5. Update database:
   ```sql
   UPDATE token_packages
   SET stripe_price_id = 'price_YOUR_ACTUAL_PRICE_ID'
   WHERE package_type = 'onetime' AND token_amount = 4200;
   ```

### Subscription Products

#### Product 4: 1000 Credits Monthly
1. Go to **Products** → **Add product**
2. Fill in:
   - **Name:** 1000 Credits Monthly
   - **Description:** Monthly subscription - 1000 trading credits per month
   - **Pricing:**
     - **Recurring**
     - **Billing period:** Monthly
     - **Price:** $20.00 USD/month
3. Click **Save product**
4. **Copy the Price ID**
5. Update database:
   ```sql
   UPDATE token_packages
   SET stripe_price_id = 'price_YOUR_ACTUAL_PRICE_ID'
   WHERE package_type = 'subscription' AND token_amount = 1000;
   ```

#### Product 5: 2100 Credits Monthly
1. Go to **Products** → **Add product**
2. Fill in:
   - **Name:** 2100 Credits Monthly
   - **Description:** Monthly subscription - 2100 trading credits per month (includes 100 bonus) - Most Popular
   - **Pricing:**
     - **Recurring**
     - **Billing period:** Monthly
     - **Price:** $40.00 USD/month
3. Click **Save product**
4. **Copy the Price ID**
5. Update database:
   ```sql
   UPDATE token_packages
   SET stripe_price_id = 'price_YOUR_ACTUAL_PRICE_ID'
   WHERE package_type = 'subscription' AND token_amount = 2100;
   ```

#### Product 6: 4200 Credits Monthly
1. Go to **Products** → **Add product**
2. Fill in:
   - **Name:** 4200 Credits Monthly
   - **Description:** Monthly subscription - 4200 trading credits per month (includes 200 bonus) - Best Value
   - **Pricing:**
     - **Recurring**
     - **Billing period:** Monthly
     - **Price:** $80.00 USD/month
3. Click **Save product**
4. **Copy the Price ID**
5. Update database:
   ```sql
   UPDATE token_packages
   SET stripe_price_id = 'price_YOUR_ACTUAL_PRICE_ID'
   WHERE package_type = 'subscription' AND token_amount = 4200;
   ```

---

## Configuring Webhooks

Webhooks automatically notify your server when payments succeed, subscriptions renew, or are canceled.

### Step 1: Add Webhook Endpoint

1. Go to **Developers** → **Webhooks**
2. Click **Add endpoint**
3. Enter endpoint URL:
   ```
   https://pipnosis.com/.netlify/functions/stripe-webhook
   ```
   (Replace `pipnosis.com` with your actual domain)

4. Select events to listen to:
   - ✅ `checkout.session.completed` (initial purchase)
   - ✅ `invoice.payment_succeeded` (subscription renewal)
   - ✅ `customer.subscription.deleted` (subscription canceled)

5. Click **Add endpoint**

### Step 2: Get Webhook Signing Secret

1. Click on your newly created webhook
2. Click **Reveal** under **Signing secret**
3. **Copy the signing secret** (starts with `whsec_...`)
4. You'll add this to Netlify environment variables

---

## Environment Variables

### Step 1: Update Local .env File (Development Only)

Add these to your `.env` file for local testing:

```bash
# Stripe Keys (TEST MODE)
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_YOUR_PUBLISHABLE_KEY_HERE
STRIPE_SECRET_KEY=sk_test_YOUR_SECRET_KEY_HERE
STRIPE_WEBHOOK_SECRET=whsec_YOUR_WEBHOOK_SECRET_HERE
```

### Step 2: Add to Netlify (REQUIRED for Production)

1. Go to Netlify Dashboard
2. Select your site
3. Navigate to **Site settings** → **Environment variables**
4. Add the following variables:

| Variable Name | Value | Description |
|--------------|-------|-------------|
| `VITE_STRIPE_PUBLISHABLE_KEY` | `pk_test_...` or `pk_live_...` | Stripe publishable key (safe for frontend) |
| `STRIPE_SECRET_KEY` | `sk_test_...` or `sk_live_...` | Stripe secret key (KEEP SECURE) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | Webhook signing secret |

**⚠️ Important:** Use test keys (`pk_test_` and `sk_test_`) for testing, then switch to live keys (`pk_live_` and `sk_live_`) when ready for production.

---

## Testing

### Test Mode Testing

Stripe provides test cards for testing payments:

#### Successful Payment
```
Card Number: 4242 4242 4242 4242
Expiry: Any future date (e.g., 12/25)
CVC: Any 3 digits (e.g., 123)
ZIP: Any 5 digits (e.g., 12345)
```

#### Payment Requires Authentication (3D Secure)
```
Card Number: 4000 0027 6000 3184
Expiry: Any future date
CVC: Any 3 digits
ZIP: Any 5 digits
```

#### Declined Payment
```
Card Number: 4000 0000 0000 0002
Expiry: Any future date
CVC: Any 3 digits
ZIP: Any 5 digits
```

### Testing Workflow

1. **Test One-Time Purchase:**
   - Go to Credits page
   - Click "Buy Now" on any one-time package
   - Complete checkout with test card
   - Verify credits are added to account
   - Check transaction history

2. **Test Subscription:**
   - Click "Subscribe" on any subscription package
   - Complete checkout with test card
   - Verify credits are added
   - Check Stripe Dashboard → Subscriptions

3. **Test Webhook:**
   - Go to Stripe Dashboard → Developers → Webhooks
   - Click your webhook endpoint
   - Click "Send test webhook"
   - Select `checkout.session.completed`
   - Verify it shows as succeeded

4. **Test Subscription Renewal (Simulated):**
   - In Stripe Dashboard, find the test subscription
   - Click "..." → "Update subscription"
   - Change billing date to trigger renewal
   - OR use Stripe CLI for instant testing:
     ```bash
     stripe trigger invoice.payment_succeeded
     ```

---

## Going Live

### Before Switching to Live Mode

Checklist:
- [ ] Test all payment flows in test mode
- [ ] Verify webhook receives events correctly
- [ ] Check credits are added properly
- [ ] Test subscription renewals
- [ ] Complete Stripe business verification
- [ ] Review Stripe's going live checklist

### Switching to Live Mode

1. **Get Live API Keys:**
   - Go to **Developers** → **API keys**
   - Toggle to **Live mode** (top right)
   - Copy live publishable key (`pk_live_...`)
   - Copy live secret key (`sk_live_...`)

2. **Update Environment Variables:**
   - Go to Netlify environment variables
   - Replace test keys with live keys:
     - `VITE_STRIPE_PUBLISHABLE_KEY` → `pk_live_...`
     - `STRIPE_SECRET_KEY` → `sk_live_...`

3. **Update Webhook for Live Mode:**
   - In Stripe Dashboard, toggle to **Live mode**
   - Go to **Developers** → **Webhooks**
   - Add endpoint (same URL as test mode)
   - Select same events
   - Get new live webhook secret (`whsec_...`)
   - Update `STRIPE_WEBHOOK_SECRET` in Netlify

4. **Deploy:**
   - Trigger Netlify deployment
   - Test with real card (small amount first!)
   - Monitor Stripe Dashboard for live transactions

---

## Troubleshooting

### Problem: "Payment system not configured" error

**Cause:** Stripe publishable key not set in environment

**Solution:**
1. Check `.env` file has `VITE_STRIPE_PUBLISHABLE_KEY`
2. Check Netlify environment variables
3. Redeploy after adding variables

### Problem: Webhook not receiving events

**Cause:** Webhook URL incorrect or signature verification failing

**Solution:**
1. Verify webhook URL in Stripe Dashboard is correct
2. Check `STRIPE_WEBHOOK_SECRET` matches what's in Stripe Dashboard
3. View webhook logs in Stripe Dashboard → Developers → Webhooks
4. Check Netlify function logs for errors

### Problem: Credits not added after payment

**Cause:** Webhook handler failing or database error

**Solution:**
1. Check Netlify function logs: `/.netlify/functions/stripe-webhook`
2. Verify `token_packages` table has correct `stripe_price_id` values
3. Check Supabase logs for RPC function errors
4. Verify user exists in database

### Problem: "Package not found" in webhook logs

**Cause:** `stripe_price_id` in database doesn't match Stripe Price ID

**Solution:**
1. Get Price ID from Stripe Dashboard → Products
2. Update database:
   ```sql
   SELECT id, name, stripe_price_id FROM token_packages;
   ```
3. Fix any mismatches with:
   ```sql
   UPDATE token_packages SET stripe_price_id = 'correct_price_id' WHERE id = 'package_id';
   ```

### Problem: Subscription not renewing

**Cause:** Webhook not receiving `invoice.payment_succeeded` events

**Solution:**
1. Check webhook is listening to `invoice.payment_succeeded`
2. Verify webhook is in live mode (if using live keys)
3. Check subscription metadata includes `userId` and `packageId`

---

## Architecture Overview

### Payment Flow

```
User clicks Buy/Subscribe
    ↓
Frontend calls: /.netlify/functions/stripe-create-checkout-session
    ↓
Netlify Function creates Stripe Checkout Session
    ↓
User redirected to Stripe Checkout
    ↓
User completes payment
    ↓
Stripe sends webhook: checkout.session.completed
    ↓
/.netlify/functions/stripe-webhook receives event
    ↓
Webhook calls: add_credits_transaction() RPC
    ↓
Credits added to token_balance
    ↓
Transaction logged in token_transactions
    ↓
User notified via goal_notifications
```

### Subscription Renewal Flow

```
Stripe automatically charges monthly
    ↓
Stripe sends webhook: invoice.payment_succeeded
    ↓
/.netlify/functions/stripe-webhook receives event
    ↓
Webhook retrieves subscription metadata
    ↓
Webhook calls: add_credits_transaction() RPC
    ↓
Monthly credits added to account
    ↓
User notified via goal_notifications
```

---

## Security Best Practices

1. **Never expose secret key:** Only use in server-side code (Netlify Functions)
2. **Validate webhooks:** Always verify signature with webhook secret
3. **Use HTTPS:** Stripe requires HTTPS for webhooks
4. **Monitor transactions:** Regularly check Stripe Dashboard for unusual activity
5. **Test before live:** Always test thoroughly in test mode
6. **Rotate keys:** If secret key is compromised, immediately rotate in Stripe Dashboard

---

## Database Schema

### token_packages Table

```sql
CREATE TABLE token_packages (
  id uuid PRIMARY KEY,
  package_type text NOT NULL, -- 'onetime' or 'subscription'
  name text NOT NULL,
  description text,
  price_usd numeric(10,2) NOT NULL,
  token_amount integer NOT NULL,
  cost_per_token numeric(10,4) NOT NULL,
  stripe_price_id text UNIQUE, -- Stripe Price ID
  is_active boolean DEFAULT true,
  display_order integer NOT NULL,
  badge text, -- 'Best Value', 'Most Popular', etc.
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

### Key Fields
- `stripe_price_id`: **Must match** the Price ID from Stripe Dashboard
- `package_type`: Determines if checkout mode is 'payment' or 'subscription'
- `token_amount`: Credits delivered after purchase

---

## Support & Resources

- **Stripe Documentation:** https://stripe.com/docs
- **Stripe Dashboard:** https://dashboard.stripe.com
- **Test Cards:** https://stripe.com/docs/testing
- **Webhook Testing:** https://stripe.com/docs/webhooks/test
- **Stripe CLI:** https://stripe.com/docs/stripe-cli

---

## Deployment Checklist

Before launching to production:

- [ ] All 6 products created in Stripe Dashboard
- [ ] All Price IDs copied and stored
- [ ] Database updated with `stripe_price_id` values
- [ ] Webhook endpoint added and verified
- [ ] Environment variables set in Netlify
- [ ] Test mode thoroughly tested
- [ ] Webhook events verified working
- [ ] Credits adding correctly
- [ ] Transaction history showing up
- [ ] Business verification completed in Stripe
- [ ] Live keys obtained
- [ ] Live webhook configured
- [ ] First test purchase made in production
- [ ] Monitoring set up for transactions

---

**Status:** ✅ Integration complete and ready to configure

**Next Steps:**
1. Create Stripe account
2. Follow setup guide above
3. Test in test mode
4. Go live when ready

**Questions?** Check troubleshooting section or Stripe documentation.
