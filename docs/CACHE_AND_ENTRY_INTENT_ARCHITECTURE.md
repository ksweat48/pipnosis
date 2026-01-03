# 3-Tier Intelligence Cache & Entry Intent Architecture

## Overview

This document explains the boundary between **market-wide cached intelligence** and **user-specific entry execution**, ensuring no accidental caching of personalized data.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    3-TIER INTELLIGENCE CACHE                     │
│                      (Market-Wide, Shared)                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  TIER 1: Omega Brain Votes (Shared Market Intelligence)         │
│  ├─ Cached by: symbol + timeframe + market_state_hash           │
│  ├─ TTL: 5-15 minutes (timeframe-dependent)                     │
│  ├─ Content: BUY/SELL/NO_TRADE votes from 12 Omega brains      │
│  └─ User-Agnostic: NO user-specific data                        │
│                                                                   │
│  TIER 2: Alpha Strategic Decisions (Shared Strategic Insight)   │
│  ├─ Cached by: symbol + timeframe + omega_votes_hash            │
│  ├─ TTL: 10-20 minutes (timeframe-dependent)                    │
│  ├─ Content: Market bias, conviction, suggested direction       │
│  └─ User-Agnostic: NO user-specific data                        │
│                                                                   │
│  TIER 3: Alpha Scout State (Market Change Detection)            │
│  ├─ Cached by: symbol + timeframe                               │
│  ├─ TTL: 5 minutes                                               │
│  ├─ Content: Should reconvene, improvement score, key changes   │
│  └─ User-Agnostic: NO user-specific data                        │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
                                  ↓
                          HANDOFF BOUNDARY
                                  ↓
┌─────────────────────────────────────────────────────────────────┐
│                    ENTRY INTENT SYSTEM                           │
│                  (User-Specific, Never Cached)                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Entry Intent Creation                                           │
│  ├─ Personalized: user_id, session_id, account_balance         │
│  ├─ Execution: entry_zone, stop_loss, take_profit, lot_size    │
│  └─ NEVER CACHED: Fresh execution for each user                 │
│                                                                   │
│  Entry Monitoring & Validation                                   │
│  ├─ Real-time: Current price, timeout progress, conditions      │
│  ├─ User-specific: Risk tolerance, goal progress, exposure      │
│  └─ NEVER CACHED: Live monitoring per user                      │
│                                                                   │
│  Trade Execution                                                 │
│  ├─ Personalized: Position size, actual entry price             │
│  ├─ User-specific: Balance updates, P&L calculations            │
│  └─ NEVER CACHED: Unique trade per user                         │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Handoff Boundary: Critical Design Principles

### What Gets Cached (Market-Wide Intelligence)

**Omega Brains** analyze market conditions and vote:
- **Input**: Candles, indicators, market state
- **Output**: BUY/SELL/NO_TRADE vote + confidence
- **Cached**: YES (shared across all users for same market state)
- **File**: `shared-intelligence-coordinator.ts` → `getOmegaIntelligence()`

**Alpha Strategic Decisions** synthesize Omega votes:
- **Input**: Omega votes, market context
- **Output**: Market bias, conviction, direction, R:R range
- **Cached**: YES (shared across all users for same Omega consensus)
- **File**: `shared-intelligence-coordinator.ts` → `getAlphaStrategicInsight()`

**Alpha Scout** detects market changes:
- **Input**: Previous scan state, current market snapshot
- **Output**: Improvement score, should reconvene flag
- **Cached**: YES (shared market change detection)
- **File**: `shared-intelligence-coordinator.ts` → `getScoutState()`

### What NEVER Gets Cached (User-Specific Execution)

**Entry Intent Creation** personalizes execution:
- **Input**: Alpha decision + user context (balance, risk mode, goal)
- **Output**: Entry zone, timeout, max wait, invalidation price
- **Cached**: NO (user-specific, created fresh every time)
- **File**: `entry-planner.ts` → `createEntryIntent()`

**Entry Monitoring** tracks real-time conditions:
- **Input**: Intent, current price, candle data
- **Output**: Should execute, wait, or cancel
- **Cached**: NO (real-time, per-user monitoring)
- **File**: `entry-planner.ts` → `validateEntryConditions()`

**Trade Execution** creates actual trades:
- **Input**: Intent, actual entry price, user balance
- **Output**: Position size, SL/TP, trade record
- **Cached**: NO (unique trade per user)
- **File**: `entry-execution-coordinator.ts` → `executeFromIntent()`

---

## Why This Boundary Matters

### ✅ Correct: Caching Alpha's Strategic Decision

Alpha analyzes EURUSD on 15m timeframe with specific Omega votes:
- Omega Trend: BUY (85% confidence)
- Omega Reversal: SELL (60% confidence)
- Alpha Decision: BUY bias, 72% conviction, suggested 1.5:1 R:R

**This is cached** because:
- Same market state = same strategic insight
- 100 users analyzing EURUSD 15m → 1 LLM call, 99 cache hits
- Saves ~$0.01 per user = ~$1.00 total

### ❌ Wrong: Caching User-Specific Execution

User A: $10,000 balance, conservative risk, $100 goal
User B: $5,000 balance, aggressive risk, $500 goal

**Both users get same Alpha decision (BUY, 72% conviction), but:**
- User A: 0.03 lots, tight entry zone, 1 minute timeout
- User B: 0.08 lots, wider entry zone, 3 minute timeout

**This is NOT cached** because:
- Different balances → different position sizes
- Different risk modes → different chase thresholds
- Different goals → different urgency levels

---

## Data Flow Example

### Step 1: Omega Brains Analyze Market (Cached)

```typescript
// shared-intelligence-coordinator.ts
const omegaVotes = await sharedIntelligenceCoordinator.getAllOmegaIntelligence(
  'EURUSD',
  '15m',
  candles,
  brainFetchers
);
// Result cached by: EURUSD + 15m + market_state_hash
// TTL: 10 minutes
// Saves: ~$0.001 per user (12 brains × $0.0001 each)
```

### Step 2: Alpha Synthesizes Strategy (Cached)

```typescript
// shared-intelligence-coordinator.ts
const alphaInsight = await sharedIntelligenceCoordinator.getAlphaStrategicInsight(
  'EURUSD',
  '15m',
  omegaVotes,
  fetchFreshAlphaFn
);
// Result cached by: EURUSD + 15m + omega_votes_hash
// TTL: 15 minutes
// Saves: ~$0.01 per user (Alpha strategic call)
```

### Step 3: Entry Intent Created (NOT Cached)

```typescript
// entry-execution-coordinator.ts
const { intentId } = await EntryExecutionCoordinator.handleAlphaDecision(
  userId,           // ← USER-SPECIFIC
  sessionId,        // ← USER-SPECIFIC
  alphaDecision,    // From cached Alpha (market-wide)
  symbol
);
// Result: Fresh entry intent for THIS user
// NOT cached: Position size, risk %, goal progress all unique
```

### Step 4: Entry Monitored (NOT Cached)

```typescript
// entry-planner.ts
const validation = await EntryPlannerService.validateEntryConditions(
  intent,           // ← USER-SPECIFIC (includes user balance, risk mode)
  currentPrice,     // ← REAL-TIME (market price)
  candleData,       // Market data (same for all users)
  marketConditions
);
// Result: Execute/wait/cancel decision for THIS user
// NOT cached: Real-time price, user-specific timeout progress
```

### Step 5: Trade Executed (NOT Cached)

```typescript
// entry-execution-coordinator.ts
const { tradeId } = await EntryExecutionCoordinator.executeFromIntent(
  intentId,         // ← USER-SPECIFIC
  actualEntryPrice  // ← REAL-TIME
);
// Result: Actual trade record for THIS user
// NOT cached: Unique position, SL/TP adjusted for slippage
```

---

## Cost Savings Analysis

### With Caching (Current System)

For 100 users analyzing EURUSD 15m simultaneously:
- **Omega Brains**: 1 LLM call, 99 cache hits
  - Cost: 1 × $0.001 = $0.001
  - Savings: 99 × $0.001 = $0.099
- **Alpha Strategic**: 1 LLM call, 99 cache hits
  - Cost: 1 × $0.01 = $0.01
  - Savings: 99 × $0.01 = $0.99
- **Entry Intent**: 100 fresh creations (never cached)
  - Cost: $0 (no LLM calls, just database)
- **Total Cost**: $0.011 for 100 users
- **Total Savings**: ~$1.09 (99% cache hit rate)

### Without Caching (Broken System)

For 100 users analyzing EURUSD 15m simultaneously:
- **Omega Brains**: 100 × 12 brains × $0.0001 = $0.12
- **Alpha Strategic**: 100 × $0.01 = $1.00
- **Total Cost**: $1.12 for 100 users
- **Savings**: $0 (no caching)

**Difference**: Caching saves ~$1.11 per 100 users (99% cost reduction)

---

## Security Boundaries

### NEVER Mix User Data into Cache Keys

❌ **WRONG** (leaks user data across cache):
```typescript
const cacheKey = `alpha:${symbol}:${timeframe}:${userId}:${accountBalance}`;
// BAD: User A's cached decision would never hit for User B
// WORSE: If cache key collision, User B might get User A's position size!
```

✅ **CORRECT** (market data only in cache):
```typescript
const cacheKey = `alpha:${symbol}:${timeframe}:${omegaVotesHash}`;
// GOOD: Same market state = same cache for all users
// User-specific execution happens AFTER cache lookup
```

### Validate User Ownership at Execution

All entry intents and trades MUST validate user ownership:

```typescript
// entry-execution-coordinator.ts (line 94-98)
const { data: intent, error } = await supabase
  .from('entry_intents')
  .select('*, goal_sessions(*)')
  .eq('id', intentId)
  .single();

// CRITICAL: Intent includes user_id and session_id
// These are validated by RLS policies to prevent cross-user access
```

---

## File References

### Cache Layer (Market-Wide)
- `src/services/shared-intelligence-coordinator.ts` - 3-tier cache coordinator
- `src/services/cache-key-generator.ts` - Market state hashing
- `src/services/price-drift-detector.ts` - Cache invalidation logic

### Entry Intent Layer (User-Specific)
- `src/services/entry-planner.ts` - Entry intent creation and validation
- `src/services/entry-execution-coordinator.ts` - User trade execution
- `src/utils/entry-validation-helpers.ts` - SSOT validation logic

### Boundary Documentation
- `docs/CACHE_AND_ENTRY_INTENT_ARCHITECTURE.md` - This file
- `docs/SINGLE_SOURCE_OF_TRUTH_SYSTEM.md` - SSOT principles

---

## Testing the Boundary

### Test 1: Same Market, Different Users

```typescript
// User A
const alphaA = await getAlphaDecision('EURUSD', '15m', candles);
// Cache MISS: First user, Alpha called

// User B (1 second later, same market state)
const alphaB = await getAlphaDecision('EURUSD', '15m', candles);
// Cache HIT: Same market state, reuse Alpha decision

// Validate: alphaA === alphaB (strategic decision is same)

// User A Intent
const intentA = await createEntryIntent(userA, alphaA);
// Fresh: User A's balance, risk mode, goal

// User B Intent
const intentB = await createEntryIntent(userB, alphaB);
// Fresh: User B's balance, risk mode, goal

// Validate: intentA !== intentB (execution is different)
```

### Test 2: Market Changes, Cache Invalidates

```typescript
// Time: 10:00 AM, EURUSD = 1.0850
const alpha1 = await getAlphaDecision('EURUSD', '15m', candles1);
// Cache MISS: New market state

// Time: 10:01 AM, EURUSD = 1.0851 (within ATR tolerance)
const alpha2 = await getAlphaDecision('EURUSD', '15m', candles2);
// Cache HIT: Price drift within tolerance, reuse cached decision

// Time: 10:05 AM, EURUSD = 1.0870 (significant move)
const alpha3 = await getAlphaDecision('EURUSD', '15m', candles3);
// Cache MISS: Price drift exceeds ATR threshold, fetch fresh
```

### Test 3: Cross-User Data Isolation

```typescript
// User A creates intent with $100 goal
const intentA = await createEntryIntent(userA, alphaDecision, {
  goalAmount: 100,
  accountBalance: 5000,
  riskMode: 'conservative'
});

// User B tries to access User A's intent
const { data } = await supabase
  .from('entry_intents')
  .select('*')
  .eq('id', intentA.id)
  .eq('user_id', userB.id); // ← RLS blocks this

// Result: data === null (RLS prevents cross-user access)
```

---

## Summary

| Layer | Content | Cached? | User-Specific? | File |
|-------|---------|---------|----------------|------|
| Omega Votes | Market intelligence | ✅ Yes | ❌ No | `shared-intelligence-coordinator.ts` |
| Alpha Strategic | Directional bias | ✅ Yes | ❌ No | `shared-intelligence-coordinator.ts` |
| Alpha Scout | Market changes | ✅ Yes | ❌ No | `shared-intelligence-coordinator.ts` |
| Entry Intent | Execution plan | ❌ No | ✅ Yes | `entry-planner.ts` |
| Entry Monitoring | Real-time validation | ❌ No | ✅ Yes | `entry-planner.ts` |
| Trade Execution | Actual trade | ❌ No | ✅ Yes | `entry-execution-coordinator.ts` |

**Golden Rule**: If it contains `user_id`, `account_balance`, `goal_amount`, or `position_size`, **NEVER cache it**.

---

## Maintenance Checklist

When adding new features:
- [ ] Does this data depend on market conditions only? → Cache it
- [ ] Does this data include user-specific info? → Don't cache it
- [ ] Is this execution-specific (price, timing)? → Don't cache it
- [ ] Can this be shared across users safely? → Consider caching
- [ ] Does caching save LLM costs? → Probably worth it
- [ ] Could cache collisions cause cross-user bugs? → Don't cache it

**When in doubt, don't cache it.** Real-time execution correctness > cost savings.
