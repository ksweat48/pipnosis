# CREDIT SYSTEM IMPLEMENTATION - CCIP PLAN

**Status:** Pre-Implementation Planning
**Protocol:** Change Control Intelligence Protocol (CCIP)
**Risk Level:** HIGH (Production System, Payment Integration)
**Date:** 2026-01-19

---

## EXECUTIVE SUMMARY

Implementing a credit-based payment system where:
- Users consume 10 credits per trade execution
- Users must have minimum 10 credits to start sessions
- Admins have infinite credits and can toggle system on/off
- Integration with Stripe for one-time and subscription payments
- Full audit trail and SSOT compliance

---

## PHASE 1: SYSTEM MAP

### 1.1 Database Layer (SSOT Authority)

**NEW TABLES:**

```sql
-- Credit packages configuration
credit_packages (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  credits integer NOT NULL,
  price_usd decimal NOT NULL,
  type text NOT NULL, -- 'onetime' | 'subscription'
  stripe_price_id text UNIQUE,
  is_active boolean DEFAULT true,
  created_at timestamptz
)

-- User subscriptions
user_subscriptions (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES auth.users,
  package_id uuid REFERENCES credit_packages,
  stripe_subscription_id text UNIQUE NOT NULL,
  status text NOT NULL, -- 'active' | 'canceled' | 'past_due'
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean DEFAULT false,
  created_at timestamptz,
  updated_at timestamptz
)

-- Credit transaction audit trail
credit_transactions (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES auth.users,
  amount integer NOT NULL, -- positive for credit, negative for debit
  balance_after integer NOT NULL,
  type text NOT NULL, -- 'purchase' | 'subscription' | 'trade_execution' | 'admin_adjustment' | 'initial_grant'
  reference_id uuid, -- links to trade_id, subscription_id, etc.
  metadata jsonb,
  created_at timestamptz,
  created_by uuid REFERENCES auth.users -- for admin adjustments
)

-- Platform settings
platform_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value jsonb NOT NULL,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users
)
```

**MODIFIED TABLES:**

```sql
-- user_profiles (add credit tracking)
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS credit_balance integer DEFAULT 1000 NOT NULL;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS is_admin boolean DEFAULT false;

-- Add constraint: admins have infinite credits (represented as NULL or -1)
-- Regular users must have >= 0 credits
```

**INDEXES:**
```sql
CREATE INDEX idx_credit_transactions_user_created ON credit_transactions(user_id, created_at DESC);
CREATE INDEX idx_user_subscriptions_user_status ON user_subscriptions(user_id, status);
CREATE INDEX idx_credit_transactions_type ON credit_transactions(type);
```

### 1.2 Application Layer Files

**AFFECTED FILES:**

1. **Database Services**
   - `src/services/database-service.ts` - Add credit query functions
   - NEW: `src/services/credit-manager.ts` - SSOT for all credit operations

2. **Trade Execution**
   - `src/services/trade-execution-engine.ts` - Deduct credits on execution
   - `src/services/goal-session-manager.ts` - Check credits before session start
   - `src/services/alpha-omega-orchestrator.ts` - May need credit check

3. **Admin Layer**
   - `src/hooks/useAdminDashboard.ts` - Add credit toggle state
   - `src/pages/AdminDashboard.tsx` - Add credit toggle UI
   - `src/components/admin/CreditManagementPanel.tsx` - NEW component

4. **Payment Layer (NEW)**
   - `src/services/stripe-service.ts` - Stripe API wrapper
   - `src/services/payment-coordinator.ts` - Payment SSOT
   - `netlify/functions/create-checkout-session.ts` - Stripe checkout
   - `netlify/functions/stripe-webhook.ts` - Handle payment events
   - `netlify/functions/create-portal-session.ts` - Subscription management

5. **UI Components**
   - `src/components/Header.tsx` - Show credit balance
   - `src/components/CreditBalanceDisplay.tsx` - NEW component
   - `src/pages/CreditsPage.tsx` - MODIFY: Add purchase UI
   - `src/components/PurchaseCreditsModal.tsx` - NEW component

6. **Hooks**
   - `src/hooks/useCreditBalance.ts` - MODIFY: Add real-time updates
   - `src/hooks/usePayment.ts` - NEW: Payment flow management

### 1.3 Environment Variables

**NEW REQUIRED:**
```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...
```

---

## PHASE 2: LOGIC CONTRACT

### 2.1 Credit Manager (SSOT Authority)

**Location:** `src/services/credit-manager.ts`

**Responsibilities:**
1. Check if user has sufficient credits
2. Deduct credits (atomic operation)
3. Add credits (atomic operation)
4. Get current balance
5. Check if credits are enabled globally
6. Check if user is admin (infinite credits)

**Contract:**
```typescript
interface CreditManager {
  // Returns current balance or null if admin
  getCurrentBalance(userId: string): Promise<number | null>;

  // Throws error if insufficient credits or system disabled
  checkSufficientCredits(userId: string, required: number): Promise<void>;

  // Deducts credits and logs transaction (atomic)
  // Throws error if insufficient or system disabled
  deductCredits(userId: string, amount: number, type: string, referenceId?: string): Promise<number>;

  // Adds credits and logs transaction (atomic)
  addCredits(userId: string, amount: number, type: string, referenceId?: string, metadata?: any): Promise<number>;

  // Check if credit system is enabled
  isCreditSystemEnabled(): Promise<boolean>;

  // Admin only: toggle credit system
  toggleCreditSystem(enabled: boolean, adminId: string): Promise<void>;
}
```

### 2.2 Payment Coordinator (SSOT for Payments)

**Location:** `src/services/payment-coordinator.ts`

**Responsibilities:**
1. Create Stripe checkout sessions
2. Handle successful payments
3. Handle failed payments
4. Manage subscriptions
5. Handle subscription renewals
6. Handle subscription cancellations

**Contract:**
```typescript
interface PaymentCoordinator {
  // Create checkout session for one-time or subscription purchase
  createCheckoutSession(userId: string, packageId: string): Promise<{ sessionId: string }>;

  // Handle successful payment webhook
  handlePaymentSuccess(stripeEvent: Stripe.Event): Promise<void>;

  // Handle subscription renewal webhook
  handleSubscriptionRenewal(stripeEvent: Stripe.Event): Promise<void>;

  // Handle subscription cancellation
  handleSubscriptionCancellation(stripeEvent: Stripe.Event): Promise<void>;

  // Create portal session for subscription management
  createPortalSession(userId: string): Promise<{ url: string }>;
}
```

### 2.3 Trade Execution Credit Flow

**Modified:** `src/services/trade-execution-engine.ts`

**Logic:**
```typescript
async executeEntry(entryIntent: EntryIntent): Promise<Trade> {
  // 1. Check if credits enabled
  const creditsEnabled = await creditManager.isCreditSystemEnabled();

  if (creditsEnabled) {
    // 2. Check sufficient credits (throws if insufficient)
    await creditManager.checkSufficientCredits(entryIntent.user_id, 10);
  }

  // 3. Execute trade (existing logic)
  const trade = await executeTrade(entryIntent);

  if (creditsEnabled) {
    // 4. Deduct credits AFTER successful execution
    try {
      await creditManager.deductCredits(
        entryIntent.user_id,
        10,
        'trade_execution',
        trade.id
      );
    } catch (error) {
      // Log error but don't roll back trade
      // Admin can manually adjust if needed
      logger.error('Failed to deduct credits after trade execution', { error, tradeId: trade.id });
    }
  }

  return trade;
}
```

### 2.4 Session Start Credit Check

**Modified:** `src/services/goal-session-manager.ts`

**Logic:**
```typescript
async startSession(userId: string, goalParams: GoalParams): Promise<Session> {
  // 1. Check if credits enabled
  const creditsEnabled = await creditManager.isCreditSystemEnabled();

  if (creditsEnabled) {
    // 2. Check minimum credits (throws if insufficient)
    await creditManager.checkSufficientCredits(userId, 10);
  }

  // 3. Start session (existing logic)
  return await createSession(userId, goalParams);
}
```

### 2.5 Admin Credit Toggle

**Modified:** `src/hooks/useAdminDashboard.ts`

**Logic:**
```typescript
const toggleCreditSystem = async (enabled: boolean) => {
  // 1. Verify admin permissions
  if (!currentUser.is_admin) {
    throw new Error('Unauthorized');
  }

  // 2. Toggle via credit manager
  await creditManager.toggleCreditSystem(enabled, currentUser.id);

  // 3. Notify all users (via realtime)
  // 4. Update local state
};
```

---

## PHASE 3: DRY-RUN SIMULATION

### 3.1 Scenario: User Starts Session

**Initial State:**
- User has 50 credits
- Credit system enabled
- No active session

**Flow:**
1. User clicks "Start Session"
2. `goalSessionManager.startSession()` called
3. `creditManager.checkSufficientCredits(userId, 10)` → passes
4. Session created successfully
5. Alpha scans for trades

**Result:** ✅ Session starts, credits still at 50

---

### 3.2 Scenario: Alpha Executes Trade

**Initial State:**
- User has 50 credits
- Active session running
- Alpha finds trade opportunity

**Flow:**
1. `tradeExecutionEngine.executeEntry()` called
2. `creditManager.checkSufficientCredits(userId, 10)` → passes
3. Trade executed on MetaAPI
4. Trade record created in database
5. `creditManager.deductCredits(userId, 10, 'trade_execution', tradeId)` → balance: 40
6. Transaction logged in `credit_transactions`

**Result:** ✅ Trade executed, balance now 40, transaction logged

---

### 3.3 Scenario: User Runs Out of Credits

**Initial State:**
- User has 5 credits
- Alpha finds trade opportunity

**Flow:**
1. `tradeExecutionEngine.executeEntry()` called
2. `creditManager.checkSufficientCredits(userId, 10)` → THROWS InsufficientCreditsError
3. Trade NOT executed
4. Error shown to user: "Insufficient credits. You need 10 credits to execute trades."

**Result:** ❌ Trade blocked, user notified

---

### 3.4 Scenario: Admin Executes Trade

**Initial State:**
- Admin user (is_admin = true)
- credit_balance = 100 (ignored)

**Flow:**
1. `tradeExecutionEngine.executeEntry()` called
2. `creditManager.checkSufficientCredits(adminId, 10)` → passes (admin check)
3. Trade executed
4. `creditManager.deductCredits()` → skipped (admin has infinite)
5. No transaction logged

**Result:** ✅ Admin trade executes, balance unchanged

---

### 3.5 Scenario: User Purchases Credits

**Initial State:**
- User has 5 credits
- Selects $50 package (2100 credits)

**Flow:**
1. User clicks "Purchase"
2. `paymentCoordinator.createCheckoutSession(userId, packageId)` called
3. Stripe checkout session created
4. User redirected to Stripe
5. User completes payment
6. Stripe webhook fires → `stripe-webhook` function
7. `paymentCoordinator.handlePaymentSuccess(event)` called
8. `creditManager.addCredits(userId, 2100, 'purchase', paymentIntentId)` → balance: 2105
9. Transaction logged
10. User redirected back to app

**Result:** ✅ User has 2105 credits, transaction logged

---

### 3.6 Scenario: Subscription Renewal

**Initial State:**
- User has $40/month subscription (2100 credits/month)
- 30 days passed since last billing
- User has 200 credits remaining

**Flow:**
1. Stripe automatically charges card
2. Webhook fires → `invoice.payment_succeeded`
3. `paymentCoordinator.handleSubscriptionRenewal(event)` called
4. `creditManager.addCredits(userId, 2100, 'subscription', subscriptionId)` → balance: 2300
5. Transaction logged
6. Subscription record updated

**Result:** ✅ User credited 2100 more, balance now 2300

---

### 3.7 Scenario: Admin Disables Credit System

**Initial State:**
- Credit system enabled
- User has 5 credits

**Flow:**
1. Admin toggles credit system OFF
2. `creditManager.toggleCreditSystem(false, adminId)` called
3. Platform setting updated in database
4. User with 5 credits starts session
5. `creditManager.checkSufficientCredits()` → passes (system disabled)
6. Trade executes
7. `creditManager.deductCredits()` → skipped (system disabled)

**Result:** ✅ All users can trade regardless of balance

---

## PHASE 4: COMPATIBILITY CHECK

### 4.1 Breaking Changes: NONE

**Reason:** Credit system is additive:
- New tables don't affect existing queries
- Credit checks are added before existing logic
- If credit system disabled, flow is identical to current

### 4.2 Database Migration Safety

**Strategy:**
1. Add credit_balance column with DEFAULT 1000 → all existing users get 1000 credits
2. Admin users manually updated to is_admin = true
3. Credit system starts DISABLED by default
4. Admin manually enables after verification

### 4.3 Existing Code Analysis

**Files that DON'T need changes:**
- All Omega brains (no credit logic)
- Chart components (display only)
- Market data services (no trade execution)
- Pattern detection (no execution)

**Files that DO need changes:**
- ✅ `trade-execution-engine.ts` - Add credit deduction
- ✅ `goal-session-manager.ts` - Add credit check
- ✅ `AdminDashboard.tsx` - Add toggle UI
- ✅ `Header.tsx` - Add balance display
- ✅ `CreditsPage.tsx` - Add purchase UI

### 4.4 Edge Cases

**Edge Case 1:** Trade executes but credit deduction fails
- **Solution:** Log error, continue trade, admin can manually adjust
- **Reason:** Don't roll back real money trades due to DB issues

**Edge Case 2:** Webhook fires twice (Stripe retry)
- **Solution:** Use idempotency key (payment_intent_id) to prevent double-crediting
- **Implementation:** Check if transaction with reference_id exists before adding credits

**Edge Case 3:** User cancels checkout before completion
- **Solution:** No action needed, no credits added, no record created

**Edge Case 4:** Subscription payment fails
- **Solution:** Webhook updates subscription status to 'past_due', user keeps existing credits but can't renew until payment succeeds

**Edge Case 5:** User has multiple subscriptions
- **Solution:** Database constraint prevents multiple active subscriptions per user

---

## PHASE 5: STAGED DEPLOYMENT

### Stage 1: Database Schema (No User Impact)
1. Create migration file
2. Run migration in production
3. Verify all users have 1000 credits
4. Manually set admin users (is_admin = true)
5. Set credit system toggle to OFF

**Rollback:** Can drop new tables, remove new columns

---

### Stage 2: Backend Services (No User Impact)
1. Deploy `credit-manager.ts` (service layer)
2. Deploy `payment-coordinator.ts`
3. Deploy Netlify functions (Stripe integration)
4. Test in sandbox mode with test Stripe keys

**Rollback:** Revert to previous deployment

---

### Stage 3: Trade Execution Integration (CRITICAL)
1. Deploy modified `trade-execution-engine.ts`
2. Deploy modified `goal-session-manager.ts`
3. Keep credit system DISABLED
4. Monitor logs for errors
5. Verify trades still execute normally

**Rollback:** Revert to previous deployment

---

### Stage 4: Admin UI (Admin Only)
1. Deploy admin dashboard with credit toggle
2. Deploy credit management panel
3. Test toggle functionality
4. Verify admins can trade with system ON

**Rollback:** Revert to previous deployment

---

### Stage 5: User UI (User Visible)
1. Deploy credit balance display in header
2. Deploy purchase page UI
3. Keep credit system DISABLED
4. Users see balance but can't purchase yet

**Rollback:** Revert to previous deployment

---

### Stage 6: Stripe Production Mode (PAYMENT LIVE)
1. Switch to live Stripe keys
2. Test with real $0.50 charge
3. Verify credits added correctly
4. Verify webhook handling

**Rollback:** Switch back to test keys

---

### Stage 7: Enable Credit System (FULL ACTIVATION)
1. Admin toggles credit system ON
2. Monitor for errors
3. Monitor trade execution
4. Monitor user feedback

**Rollback:** Admin toggles OFF

---

## PHASE 6: POST-DEPLOY VERIFICATION

### 6.1 Smoke Tests

**Test 1:** Admin can trade with system ON
- Expected: Trade executes, balance unchanged

**Test 2:** User with 1000 credits can start session
- Expected: Session starts

**Test 3:** User can execute trade
- Expected: Trade executes, balance = 990

**Test 4:** User can purchase credits
- Expected: Stripe checkout opens, credits added after payment

**Test 5:** Admin can toggle system OFF
- Expected: All users can trade without credit checks

**Test 6:** Subscription renewal works
- Expected: Credits added monthly

---

### 6.2 Monitoring Metrics

**Key Metrics:**
1. Credit transaction volume
2. Failed credit checks (insufficient funds)
3. Payment success rate
4. Subscription renewal rate
5. Failed webhook deliveries
6. Credit balance distribution across users

**Alerts:**
1. Webhook failure rate > 1%
2. Payment success rate < 95%
3. User stuck in checkout (no completion after 10 min)
4. Negative credit balance detected (data integrity issue)

---

### 6.3 Database Integrity Checks

**Query 1:** All users have valid credit balance
```sql
SELECT COUNT(*) FROM user_profiles WHERE credit_balance < 0 AND is_admin = false;
-- Expected: 0
```

**Query 2:** All transactions balance correctly
```sql
SELECT
  user_id,
  SUM(amount) as total_credits,
  (SELECT credit_balance FROM user_profiles WHERE id = user_id) as current_balance
FROM credit_transactions
GROUP BY user_id
HAVING SUM(amount) + 1000 != current_balance; -- 1000 = initial grant
-- Expected: 0 rows
```

**Query 3:** No duplicate subscription credits
```sql
SELECT reference_id, COUNT(*)
FROM credit_transactions
WHERE type = 'subscription'
GROUP BY reference_id
HAVING COUNT(*) > 1;
-- Expected: 0 rows
```

---

## PHASE 7: STRIPE SETUP WALKTHROUGH

### 7.1 Stripe Account Setup

1. Go to https://stripe.com
2. Create account or log in
3. Go to Developers → API Keys
4. Copy "Publishable key" and "Secret key"
5. Add to `.env`:
   ```
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_PUBLISHABLE_KEY=pk_test_...
   VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
   ```

### 7.2 Create Products in Stripe Dashboard

**One-Time Products:**
1. Go to Products → Add Product
2. Name: "1000 Credits"
3. Price: $25 USD (one-time)
4. Copy Price ID → save for database seed
5. Repeat for $50 and $100 packages

**Subscription Products:**
1. Go to Products → Add Product
2. Name: "1000 Credits Monthly"
3. Price: $20 USD (recurring monthly)
4. Copy Price ID → save for database seed
5. Repeat for $40 and $80 packages

### 7.3 Configure Webhooks

1. Go to Developers → Webhooks
2. Click "Add Endpoint"
3. URL: `https://your-site.netlify.app/.netlify/functions/stripe-webhook`
4. Select events:
   - `checkout.session.completed`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
   - `customer.subscription.deleted`
   - `customer.subscription.updated`
5. Copy "Signing secret" → add to `.env`:
   ```
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```

### 7.4 Test Mode vs Production

**Test Mode:**
- Use test credit card: `4242 4242 4242 4242`
- No real charges
- Use `sk_test_...` and `pk_test_...` keys

**Production Mode:**
- Real charges
- Use `sk_live_...` and `pk_live_...` keys
- Request activation from Stripe (requires business verification)

---

## PHASE 8: RISK MITIGATION

### 8.1 High-Risk Areas

**Risk 1:** Double-charging users
- **Mitigation:** Idempotency keys, transaction deduplication
- **Detection:** Monitor for duplicate reference_ids

**Risk 2:** Credit deduction fails but trade executes
- **Mitigation:** Log errors, don't roll back trade, admin manual adjustment
- **Detection:** Compare trade count vs transaction count

**Risk 3:** Webhook delivery failure
- **Mitigation:** Stripe retries for 3 days, manual reconciliation tool
- **Detection:** Monitor webhook failure rate

**Risk 4:** Race condition: multiple trades deduct simultaneously
- **Mitigation:** Database-level atomic operations with row locking
- **Detection:** Balance integrity check queries

**Risk 5:** Admin accidentally enables system before ready
- **Mitigation:** System starts disabled by default, requires explicit enable
- **Detection:** Monitor credit check failure rate spike

---

## PHASE 9: SSOT COMPLIANCE CHECKLIST

- ✅ **Single Authority for Credits:** `credit-manager.ts` owns all credit operations
- ✅ **Single Authority for Payments:** `payment-coordinator.ts` owns all payment flows
- ✅ **No Direct DB Mutations:** All credit changes go through credit manager
- ✅ **Atomic Operations:** All credit transactions use database transactions
- ✅ **Audit Trail:** Every credit change logged in credit_transactions
- ✅ **No Duplicate Logic:** Session start and trade execution both call same credit manager
- ✅ **Clear Ownership:** Each responsibility has one owner

---

## PHASE 10: ROLLOUT TIMELINE

**Day 1:** Database migration + backend services (credit system OFF)
**Day 2:** Trade execution integration testing (credit system OFF)
**Day 3:** Admin UI deployment + admin testing
**Day 4:** User UI deployment (credit system still OFF)
**Day 5:** Stripe test mode validation
**Day 6:** Stripe production mode + first test purchase
**Day 7:** Enable credit system for 10% of users (canary)
**Day 8:** Enable for 50% of users
**Day 9:** Enable for 100% of users
**Day 10:** Monitor and stabilize

---

## APPROVAL CHECKLIST

Before proceeding with implementation, confirm:

- [ ] Database schema reviewed and approved
- [ ] SSOT architecture reviewed and approved
- [ ] Credit deduction logic reviewed and approved
- [ ] Payment flow reviewed and approved
- [ ] Edge cases understood and mitigated
- [ ] Rollback plan understood
- [ ] Stripe account ready
- [ ] Environment variables documented
- [ ] Monitoring plan in place
- [ ] Admin toggle tested

---

## NEXT STEPS

Once approved, implementation order:
1. Create database migration
2. Seed credit packages with Stripe price IDs
3. Implement credit-manager.ts
4. Implement payment-coordinator.ts
5. Create Netlify functions for Stripe
6. Modify trade execution engine
7. Modify session manager
8. Create admin UI components
9. Create user purchase UI
10. Test end-to-end
11. Deploy to production (credit system OFF)
12. Enable credit system

**Ready to proceed with implementation?**
