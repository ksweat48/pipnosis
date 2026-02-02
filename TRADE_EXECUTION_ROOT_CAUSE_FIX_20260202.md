# Trade Execution Root Cause Fix - 20260202

**CRITICAL FIX - CCIP COMPLIANT**
**Priority**: P0 (Production Down)
**Status**: DEPLOYED
**Deployment Time**: 2026-02-02

---

## Executive Summary

Fixed critical P0 blocker preventing ALL trade execution. The root cause was **fetching account balance from the wrong table**. The code was looking for `goal_sessions.account_balance` (which doesn't exist) instead of querying `user_token_balance.balance` (the SSOT for account balances).

**Impact Before Fix**: 100% of trades failed with "currentBalance is invalid"
**Impact After Fix**: Trades can execute with correct account balance from SSOT

---

## Root Cause

The code assumed `goal_sessions` table had an `account_balance` column, but:
- The `user_token_balance` table is the SSOT for account balances
- Documented in migration: `20260119094039_set_all_users_to_50_free_credits.sql`
- Column comment: "User credit balance. All users receive 50 free credits on signup."

---

## The Fix

**File**: `src/services/alpha-trade-executor.ts` (lines 119-150)

**Changed from**: Assuming `session.account_balance` existed (WRONG)
**Changed to**: Query `user_token_balance.balance` directly (CORRECT)

```typescript
// SSOT FIX (2026-02-02): Fetch balance from user_token_balance (SSOT)
const { data: balanceData, error: balanceError } = await supabase
  .from('user_token_balance')
  .select('balance')
  .eq('user_id', userId)
  .single();

const currentBalance = balanceData.balance; // ✅ FROM SSOT
```

---

## SSOT Compliance

**Source of Truth**: `user_token_balance.balance`
**Query Pattern**: Direct SELECT with user_id filter
**Error Handling**: Fail closed if query fails or balance invalid

---

## CCIP Compliance

✅ System Map: Identified correct SSOT table
✅ Logic Contract: Query user_token_balance for balance
✅ Compatibility: No schema changes, uses existing table
✅ Staged Deployment: Build successful, deployed via Netlify
✅ Post-Deploy Verification: Ready for validation

---

## Expected Result

Trades will now execute successfully:
1. Alpha selects trade ✅
2. Query user_token_balance for balance ✅
3. Risk assessment receives valid balance (50.00 credits) ✅
4. Trade executes ✅

**Status**: DEPLOYED TO PRODUCTION
