# CCIP: Club Token Balance Synchronization Fix
**Date:** 2026-02-11
**Change ID:** CCIP-CLUB-TOKEN-SYNC-20260211
**Priority:** High
**Type:** Data Integrity Fix + Architecture Clarification

## Executive Summary

Fix critical data inconsistency where `club_token_balances` table is out of sync with `club_token_ledger` (the SSOT). The retroactive tier bonus tokens (6,850 PIP) were correctly inserted into the ledger but the denormalized balance table was not updated, causing the admin dashboard and user balance displays to show incorrect values.

## Root Cause Analysis

### Problem 1: Denormalized State Not Updated
- **SSOT:** `club_token_ledger` (immutable transaction log) - Contains 7 transactions totaling 16,850 PIP
- **Derived State:** `club_token_balances` (performance snapshot) - Shows only 10,000 PIP
- **Gap:** Migration `20260210234752_backfill_tier_history_existing_members.sql` inserted ledger records but didn't update balances table

### Problem 2: Admin Dashboard Querying Wrong System
- **Current Behavior:** AdminClubPanel queries `token_events` table (NEW system with 0 records)
- **Expected Behavior:** Should query `club_token_ledger` (ACTIVE system with 7 records)
- **Root Cause:** Two parallel token systems exist:
  - OLD System (actively used): `club_token_ledger`, `club_token_balances`
  - NEW System (not yet active): `token_events`, `token_balances`

## System Map

### Current Architecture (Before Fix)

```
┌─────────────────────────────────────────────────────────────┐
│ Token Transaction Systems (DUAL SYSTEMS - PROBLEMATIC)     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ OLD SYSTEM (Active):                                       │
│   club_token_ledger (SSOT) ───┐                           │
│                                 │                           │
│                                 ├─[NO SYNC]─X─> club_token_balances (Stale)
│                                 │                           │
│                                 │                           │
│ NEW SYSTEM (Inactive):                                     │
│   token_events (SSOT) ─────────┼──[SYNC]──> token_balances│
│                                 │                           │
│                                                             │
│ Admin Dashboard:                                           │
│   - Members tab ────────────────> club_token_balances ✓    │
│   - Treasury tab ───────────────> token_events ✗ (WRONG)   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Target Architecture (After Fix)

```
┌─────────────────────────────────────────────────────────────┐
│ Token Transaction Systems (CLARIFIED)                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ ACTIVE SYSTEM (Club Tokens):                               │
│   club_token_ledger (SSOT) ───┐                           │
│                                 │                           │
│                                 ├─[AUTO SYNC]─> club_token_balances (Accurate)
│                                 │                           │
│                                 │                           │
│   club_token_ledger_coordinator (SSOT Authority)           │
│     - Single source for all mutations                      │
│     - Auto-updates denormalized state                      │
│                                                             │
│ FUTURE SYSTEM (Not Yet Active):                            │
│   token_events (Reserved for multi-token expansion)        │
│   token_balances                                            │
│                                                             │
│ Admin Dashboard:                                           │
│   - Members tab ────────────────> club_token_balances ✓    │
│   - Treasury tab ───────────────> club_token_ledger ✓      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Logic Contract

### SSOT Principles
1. **club_token_ledger** is the immutable SSOT for all club token transactions
2. **club_token_balances** is a derived/denormalized state for performance
3. All mutations MUST go through `club_token_ledger_coordinator`
4. Balances table MUST be automatically synchronized with ledger

### Data Integrity Guarantees
1. `club_token_balances.total_tokens` = SUM of all ledger entries for user
2. `club_token_balances.available_tokens` = total_tokens - locked_tokens (generated column)
3. Any direct writes to club_token_balances (bypassing coordinator) are violations

### Synchronization Rules
1. On ledger insert → Update balance atomically in same transaction
2. Periodic reconciliation job to detect/fix drift
3. Admin dashboard shows reconciliation status

## Implementation Plan

### Phase 1: Data Repair (Immediate)
- [x] Identify affected users (currently: ksweat48@gmail.com)
- [ ] Create migration to recalculate balances from ledger
- [ ] Backfill correct balances (10,000 + 6,850 = 16,850)

### Phase 2: SSOT Architecture (Core Fix)
- [ ] Create `club_token_ledger_coordinator.ts` service
  - Single authority for all club token mutations
  - Auto-updates club_token_balances
  - Event-sourced audit trail
- [ ] Add database trigger as failsafe
  - Trigger on club_token_ledger INSERT
  - Auto-recalculates user balance

### Phase 3: Admin Dashboard Fix
- [ ] Update AdminClubPanel Token Treasury tab
  - Query club_token_ledger instead of token_events
  - Map transaction_types to lifecycle categories
- [ ] Add data source indicators (show which table is being queried)

### Phase 4: Verification
- [ ] Test balance calculations
- [ ] Verify admin dashboard shows correct data
- [ ] Check user-facing pages

## Compatibility Check

### Breaking Changes: None
- Existing functions continue to work
- Only fixing data inconsistency

### Migration Safety
- Read-only SELECT queries to calculate correct balances
- Single UPDATE per user to fix balances
- Idempotent (safe to re-run)

### Rollback Plan
If issues detected:
```sql
-- Rollback: Restore previous balance (though incorrect)
UPDATE club_token_balances
SET total_tokens = 10000
WHERE user_id = '91905a02-cf9e-4537-9920-98a4b790830a';
```

## Staged Deployment

### Stage 1: Database Migration (Production)
- Deploy migration to sync balances
- Verify ksweat48 account shows 16,850 total, 6,850 available
- Monitor for errors

### Stage 2: Service Layer (Code Deployment)
- Deploy club_token_ledger_coordinator
- Deploy AdminClubPanel updates
- Monitor admin dashboard

### Stage 3: Monitoring (24 hours)
- Watch for balance drift
- Verify no SSOT violations logged
- Check user satisfaction

## Post-Deploy Verification

### Success Criteria
- [ ] `club_token_balances.total_tokens` matches ledger sum for all users
- [ ] Admin Dashboard > Treasury shows accurate lifecycle flows
- [ ] Admin Dashboard > Members shows correct available balances
- [ ] User Club pages show correct balances
- [ ] No SSOT violation logs

### Verification Queries
```sql
-- Verify balance matches ledger
SELECT
  u.email,
  b.total_tokens as balance_total,
  COALESCE(SUM(l.amount), 0) as ledger_total,
  b.total_tokens - COALESCE(SUM(l.amount), 0) as drift
FROM club_token_balances b
JOIN user_profiles u ON u.id = b.user_id
LEFT JOIN club_token_ledger l ON l.user_id = b.user_id
GROUP BY u.email, b.total_tokens
HAVING b.total_tokens != COALESCE(SUM(l.amount), 0);

-- Should return 0 rows after fix
```

## Governance & Audit

### Change Classification
- **Type:** Data Repair + Architecture Clarification
- **Risk Level:** Medium (touches money-equivalent tokens)
- **Review Required:** Yes
- **User Impact:** Positive (shows correct balances)

### Audit Trail
- Migration logged in `ccip_change_tracking`
- All balance changes logged in `governance_change_log`
- Transaction history preserved in `club_token_ledger`

### Compliance
- ✅ CCIP Protocol followed
- ✅ SSOT principles enforced
- ✅ Governance audit trail
- ✅ Migration documentation complete

## Known Issues & Future Work

### Issue: Two Token Systems Exist
- `club_token_*` tables (active)
- `token_*` tables (inactive)

**Resolution:** Document and clarify purpose:
- Club system: For club membership tokens (PIP)
- Token system: Reserved for future multi-token expansion (different currencies, etc.)

### Future: Unify Systems
Consider merging in future CCIP once club system is stable:
- Migrate club_token_ledger → token_events
- Migrate club_token_balances → token_balances
- Single unified token authority

## Sign-off

**Created By:** Claude (AI Assistant)
**Approved By:** (Pending user approval)
**Deployed:** (Pending)
**Status:** ⏳ Awaiting Implementation
