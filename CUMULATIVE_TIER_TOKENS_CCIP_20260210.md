# CCIP Change Control: Cumulative Tier Token Bonus System

**Date**: 2026-02-10
**Change Type**: Feature Enhancement - Tokenomics System Upgrade
**Risk Level**: HIGH (affects payment flow, token allocation, membership logic)
**CCIP Status**: IN PROGRESS

---

## Executive Summary

Implementing a cumulative tier progression system where users receive token bonuses from ALL tiers they pass through, not just their purchased tier. This creates an incentive structure rewarding users who purchase higher tiers directly.

---

## Business Requirements

### Current System (BEFORE)
- User buys Founder ($10,000) → Gets 10,000 tokens
- All 10,000 tokens locked as membership collateral
- Available balance: 0 tokens

### New System (AFTER)
- User buys Founder ($10,000) → Gets cumulative bonus from all 6 tiers:
  - Member (Tier 1): 100 tokens
  - Starter (Tier 2): 250 tokens
  - Builder (Tier 3): 500 tokens
  - Pro (Tier 4): 1,000 tokens
  - Elite Partner (Tier 5): 5,000 tokens
  - Founder (Tier 6): 10,000 tokens
  - **Total awarded: 16,850 tokens**
- Locked: 10,000 tokens (Founder requirement)
- **Available balance: 6,850 tokens**

### Upgrade Behavior
- User has Member (100 tokens) → Upgrades to Builder ($500)
- Gets tokens from: Starter (250) + Builder (500) = 750 new tokens
- Previous 100 tokens unlocked immediately
- New total: 850 tokens
- New locked: 500 tokens (Builder requirement)
- New available: 350 tokens

---

## System Map - Current Architecture

### Affected Components

**Database Tables:**
- `club_membership_packages` - Stores tier definitions
- `club_memberships` - Active membership records
- `club_token_balances` - User token balances
- `club_token_ledger` - Immutable transaction log

**RPC Functions:**
- `grant_club_membership` - Awards membership and tokens
- `get_club_token_balance` - Retrieves balance data

**Netlify Functions:**
- `stripe-webhook.ts` - Processes payment webhooks
- `verify-membership-purchase.ts` - Verification endpoint

**Frontend Components:**
- `ClubEntryGatePage.tsx` - Purchase interface
- `TokenBalanceCard.tsx` - Balance display
- `AdminClubPanel.tsx` - Admin management

### Current Flow
1. User completes Stripe payment
2. Webhook calls `grant_club_membership(user_id, package_id)`
3. RPC awards `initial_token_allocation` from package
4. RPC locks `required_token_balance` tokens
5. UI displays available balance (total - locked)

---

## Logic Contract - New Behavior

### Core Principle: Single Source of Truth
**Authority**: `club_membership_tier_history` table
- Records which tier bonuses have been awarded to each user
- Prevents double-awarding same tier bonus
- Enables cumulative calculation by checking history

### New Database Schema

**Table: club_membership_tier_history**
- Tracks every tier bonus award per user
- Columns:
  - `id` UUID PRIMARY KEY
  - `user_id` UUID REFERENCES auth.users
  - `tier_level` INTEGER (1-6)
  - `tier_name` TEXT
  - `tokens_awarded` NUMERIC(12,2)
  - `membership_id` UUID REFERENCES club_memberships
  - `awarded_at` TIMESTAMPTZ
- Unique constraint: (user_id, tier_level)

**Table: club_memberships (new columns)**
- `previous_membership_id` UUID - Links to old membership
- `is_upgrade` BOOLEAN - True if upgrade vs new purchase
- `upgrade_tokens_awarded` NUMERIC(12,2) - Tracks bonus from upgrade

### Cumulative Token Calculation Algorithm

**Function: calculate_cumulative_token_award(user_id, target_tier_level)**

```
1. Query tier_history: Get list of tiers already awarded to user
2. Query packages: Get all tiers from 1 to target_tier_level
3. Filter: Remove tiers already in history
4. Calculate: SUM(initial_token_allocation) for remaining tiers
5. Return:
   - total_tokens_to_award
   - tier_breakdown[] (list of tiers and amounts)
   - tiers_newly_awarded[] (which tiers need history records)
```

**Examples:**
- Fresh user, Founder: Awards tiers [1,2,3,4,5,6] = 16,850 tokens
- Has Member [1], buys Builder: Awards tiers [2,3] = 750 tokens
- Has Builder [1,2,3], buys Founder: Awards tiers [4,5,6] = 16,000 tokens

### Token Lock/Unlock Flow on Upgrade

**When user upgrades from Tier X to Tier Y:**
1. Calculate current locked amount from old membership
2. Calculate new required locked amount for new tier
3. Net adjustment: `new_required - old_required`
4. Update `locked_tokens` column with adjustment
5. Available tokens automatically recalculated (computed column)

**Example: Member → Builder**
- Old locked: 100
- New locked: 500
- Adjustment: +400 to locked_tokens
- If user had 100 total before, gets +750 from upgrade
- New total: 850, locked: 500, available: 350

---

## Affected Systems Audit

### Payment Flow
- **stripe-webhook.ts**: Extracts package_id, calls grant function
- **Risk**: Must handle cumulative tokens correctly
- **Change**: Pass is_upgrade flag if detected

### Token Allocation
- **grant_club_membership**: Currently awards single tier
- **Risk**: Core logic change, affects all memberships
- **Change**: Call cumulative calculator, award multiple tier bonuses

### Token Balances
- **club_token_balances**: Computed column for available
- **Risk**: Lock adjustment must be atomic
- **Change**: Update locked_tokens correctly during upgrade

### Ledger Tracking
- **club_token_ledger**: Transaction history
- **Risk**: Must track all tier bonuses separately
- **Change**: Insert one ledger entry per tier awarded

### UI Display
- **TokenBalanceCard**: Shows available/locked/staked
- **Risk**: Users need to understand cumulative bonuses
- **Change**: Add breakdown tooltip or section

---

## Migration Strategy

### Phase 1: Schema Changes (Non-Breaking)
1. Create `club_membership_tier_history` table
2. Add columns to `club_memberships` table
3. All changes are additive, no breaking changes

### Phase 2: Data Backfill (Idempotent)
1. For each existing active membership:
   - Insert tier_history record for their current tier only
   - Set awarded_at = purchased_at from membership
2. This prevents retroactive bonuses for existing members
3. Script must be idempotent (check before insert)

### Phase 3: Function Deployment (Atomic)
1. Create new `calculate_cumulative_token_award` function
2. Create new version of `grant_club_membership` (v2)
3. Update webhook to call new function
4. Old function remains available as fallback

### Phase 4: Frontend Updates (Progressive)
1. Update purchase flow to detect upgrades
2. Update UI to show cumulative bonus preview
3. Update balance display with breakdown
4. Changes are UX-only, no breaking API changes

---

## Compatibility Checklist

### Existing Members
- ✅ Keep current balances unchanged
- ✅ Tier history populated with their current tier only
- ✅ Future upgrades will use cumulative system
- ✅ No retroactive bonuses for past purchases

### New Members (Post-Deployment)
- ✅ Receive cumulative bonuses immediately
- ✅ Tier history tracks all awarded tiers
- ✅ Can see breakdown in UI

### Upgrade Scenarios
- ✅ Member → Any higher tier: Works correctly
- ✅ Builder → Founder: Only awards [4,5,6]
- ✅ Cannot downgrade (validation enforced)
- ✅ Cannot re-buy same tier (validation enforced)

### Token Locking Behavior
- ✅ Old locked tokens immediately available on upgrade
- ✅ New tier requirement locked atomically
- ✅ No race conditions (transaction-based)
- ✅ Computed column recalculates automatically

---

## Governance Constraints

### SSOT Principles
1. **Tier Award Authority**: `club_membership_tier_history` table is canonical source
2. **Token Balance Authority**: `club_token_balances.total_tokens` is canonical
3. **Lock Amount Authority**: `club_memberships.tokens_locked` for active tier
4. **Ledger Immutability**: All awards logged in `club_token_ledger` (append-only)

### CCIP Requirements
1. All database changes via migrations (tracked)
2. All RPC functions versioned and documented
3. Rollback plan defined for each phase
4. Change log maintained in this document

### Anti-Regression Safeguards
1. Unique constraint: (user_id, tier_level) in tier_history
2. Check constraint: target_tier > current_tier for upgrades
3. Transaction isolation: All token operations in single transaction
4. Idempotent migrations: Safe to run multiple times

---

## Testing Requirements

### Unit Tests (Database)
- Calculate cumulative tokens for all tier combinations
- Verify tier history prevents double-awards
- Test lock adjustment calculations
- Validate constraint enforcement

### Integration Tests (API)
- Complete Stripe webhook → token allocation flow
- Verify ledger entries match awarded amounts
- Test upgrade detection and processing
- Confirm UI data updates via realtime subscriptions

### User Acceptance Tests (UI)
- Purchase flow shows cumulative bonus preview
- Token balance displays correct available amount
- Upgrade button shows incremental token gain
- Admin panel displays tier progression history

---

## Rollback Plan

### If Issues Detected in Production

**Step 1: Immediate Mitigation**
- Disable new purchases temporarily (maintenance mode)
- Revert webhook to call legacy `grant_club_membership` function
- Existing members unaffected

**Step 2: Data Correction**
- Identify affected users from deployment timestamp
- Calculate correct token balances manually
- Apply corrections via admin RPC function

**Step 3: Code Rollback**
- Revert frontend to previous version
- Revert Netlify functions to previous version
- Keep database schema (additive changes are safe)
- Mark new RPC functions as deprecated

**Step 4: Post-Mortem**
- Document root cause
- Update CCIP tracking with lessons learned
- Plan corrective deployment

---

## Deployment Checklist

### Pre-Deployment
- [ ] All migrations tested in staging environment
- [ ] Backfill script verified with production data sample
- [ ] RPC functions pass all unit tests
- [ ] Frontend changes reviewed for UX clarity
- [ ] Admin team briefed on new system

### Deployment Sequence
1. [ ] Apply Phase 1 migrations (schema changes)
2. [ ] Run Phase 2 backfill (existing member history)
3. [ ] Deploy Phase 3 functions (new RPC versions)
4. [ ] Deploy Phase 4 frontend (UI updates)
5. [ ] Verify test purchase completes successfully
6. [ ] Monitor error logs for 24 hours

### Post-Deployment
- [ ] Verify existing members retain correct balances
- [ ] Test new purchase receives cumulative tokens
- [ ] Test upgrade awards correct incremental tokens
- [ ] Confirm ledger entries are complete
- [ ] Document any issues in CCIP change log

---

## Change Log

**2026-02-10 Initial Draft**
- Created CCIP tracking document
- Defined logic contract and system map
- Established migration strategy

**[To be updated as implementation progresses]**

---

## Approval Status

**Technical Review**: PENDING
**Security Review**: PENDING
**Business Review**: PENDING
**Deployment Authorization**: PENDING

---

## Notes & Risks

### Known Risks
1. **Token Balance Inflation**: Users receive significantly more tokens
   - Mitigation: Required locks scale proportionally
   - Impact: Available balance increases, but access gates remain effective

2. **Retroactive Bonus Expectations**: Existing members may expect bonuses
   - Mitigation: Clear communication, fair policy
   - Decision: Only future upgrades get cumulative bonuses

3. **Race Condition on Concurrent Purchases**: User buys two tiers simultaneously
   - Mitigation: Database-level locking, unique constraints
   - Impact: One purchase succeeds, other fails gracefully

### Open Questions
1. Should referral rewards scale with tier purchased?
2. Should there be limits on available tokens for lower tiers?
3. How do staking multipliers interact with cumulative tokens?

---

**END OF CCIP DOCUMENT**
