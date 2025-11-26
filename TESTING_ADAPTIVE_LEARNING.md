# Testing Adaptive Learning System - Quick Guide

## What To Test

### Test 1: Session 4 (Previously Blocked)
**Goal**: Verify that Session 4 now executes trades instead of being blocked

**Steps:**
1. Start AI Training page
2. Run Session 4 backtest (Day 4)
3. Watch console logs

**Expected Results:**
- ✅ Trades execute (not 0 trades)
- ✅ See log: `[LAYER 3] ✨ ADAPTIVE LEARNING APPLIED`
- ✅ See log: `Similarity: X.XX (age factor: X.XX)`
- ✅ See parameter adjustments in logs
- ✅ Session completes with P&L data

**What Previously Happened:**
```
[LAYER 3] 🚫 BLOCKED: Blocking due to similar patterns exceeding the threshold of 5.
Result: 0 trades
```

**What Should Happen Now:**
```
[LAYER 3] ✨ ADAPTIVE LEARNING APPLIED
  Similarity: 0.48 (age factor: 0.80)
  Risk: 2.0% → 1.6%; Confidence: -2.4 pts
[LAYER 3] ✅ ADJUSTED - Risk: medium
Result: Multiple trades with adjusted parameters
```

---

### Test 2: Critical Safety Blocks (Still Work)
**Goal**: Verify that genuinely dangerous scenarios still block

**Steps:**
1. Check database for patterns with 90%+ loss rate
2. If found, verify those still block trades
3. In live trading (not backtest), verify 5+ consecutive losses blocks

**Expected Results:**
- ✅ Extremely dangerous patterns (90%+ loss) still block
- ✅ See log: `[LLM Layer 3] 🚨 CRITICAL SAFETY BLOCK`
- ✅ Trade does NOT execute for critical dangers

---

### Test 3: Adaptation Effectiveness Tracking
**Goal**: Verify adaptations are being recorded in database

**Steps:**
1. After running a session with adaptations
2. Query database:
```sql
SELECT * FROM adaptation_effectiveness
WHERE user_id = 'your-user-id'
ORDER BY created_at DESC
LIMIT 10;
```

**Expected Results:**
- ✅ Records exist for adapted trades
- ✅ `similarity_score`, `weighted_similarity`, `age_factor` populated
- ✅ `adjusted_params` contains risk/SL/TP adjustments
- ✅ `outcome` is 'pending' until trade closes

---

### Test 4: Parameter Adjustments Applied
**Goal**: Verify adjusted parameters are actually used in trades

**Steps:**
1. Run a session that triggers adaptations
2. Check trade execution logs
3. Verify risk percentage matches adjusted value

**Expected in Logs:**
```
[LAYER 3] ✨ ADAPTIVE ADJUSTMENTS APPLIED
  Confidence: 75 → 73
[Layer 5] Risk per trade: 1.6% (adjusted from 2.0%)
```

---

### Test 5: Pattern Age Decay
**Goal**: Verify old patterns have less influence

**Test Scenario:**
- Pattern A: 2 days old, confidence 80%
- Pattern B: 25 days old, confidence 80%

**Expected Behavior:**
- Pattern A: High weight (~0.93 age factor)
- Pattern B: Lower weight (~0.17 age factor)
- Older patterns cause smaller adjustments

---

## Console Logs to Watch

### Successful Adaptation:
```
[LLM Layer 3 - Mistake Prevention] 🛡️ Checking for mistakes on GBPUSD
[LLM Layer 3] ✨ ADAPTIVE LEARNING APPLIED
  Similarity: 0.48 (age factor: 0.80)
  Risk: 2.0% → 1.6%; SL: widened by 15%; Confidence: -2.4 pts
[LAYER 3] ✅ ADJUSTED - Risk: medium
[LAYER 3] ✨ ADAPTIVE ADJUSTMENTS APPLIED
  Confidence: 75 → 73
```

### Critical Safety Block (Still Works):
```
[LLM Layer 3] 🚨 CRITICAL SAFETY BLOCK: Pattern "Brexit news trades" has proven extremely dangerous (92% loss rate over 12 trades)
[LAYER 3] 🚫 BLOCKED: Critical safety block
```

### No Patterns (Normal Flow):
```
[LLM Layer 3 - Mistake Prevention] 🛡️ Checking for mistakes on EURUSD
[LAYER 3] ✅ ALLOW - Risk: low
```

---

## Database Queries for Validation

### Check Adaptation Records:
```sql
SELECT
  pattern_id,
  adaptation_type,
  similarity_score,
  weighted_similarity,
  age_factor,
  outcome,
  created_at
FROM adaptation_effectiveness
WHERE user_id = 'your-user-id'
ORDER BY created_at DESC
LIMIT 20;
```

### Check Pattern Ages:
```sql
SELECT
  insight_title,
  confidence_score,
  EXTRACT(DAY FROM (NOW() - created_at)) as age_days,
  created_at
FROM ai_learning_insights
WHERE user_id = 'your-user-id'
  AND insight_type = 'losing_pattern'
ORDER BY created_at DESC;
```

### Check Recent Session Results:
```sql
SELECT
  session_name,
  win_rate,
  total_trades,
  profit_loss,
  created_at
FROM synthetic_backtest_sessions
WHERE user_id = 'your-user-id'
ORDER BY created_at DESC
LIMIT 10;
```

---

## Success Criteria

### ✅ Phase 1 is successful if:
1. **Session 4 executes trades** (not 0)
2. **Adaptations are logged** clearly in console
3. **Parameters are adjusted** correctly (risk, SL, TP, confidence)
4. **Critical blocks still work** for dangerous patterns
5. **Database records adaptations** in `adaptation_effectiveness` table
6. **No TypeScript errors** in build
7. **No runtime errors** in browser console

### 🚨 Issues to watch for:
- Trades still blocked with "similar patterns > 5"
- No adaptation logs appearing
- All trades being blocked (safety override too aggressive)
- No records in `adaptation_effectiveness` table
- Build errors or runtime errors

---

## Rollback Plan (If Needed)

If something goes wrong, you can quickly rollback:

1. **Restore old prompt:**
```typescript
// In llm-prompt-compressor.ts, line 153
- Block if similar > 5 OR corr_risk=true OR consec > 3.
```

2. **Disable adaptive engine:**
```typescript
// In llm-mistake-prevention.ts
const ENABLE_ADAPTIVE = false; // Set to false
if (!ENABLE_ADAPTIVE) {
  // Use old blocking logic
}
```

3. **Redeploy:**
```bash
npm run build
```

---

## Next Steps After Validation

Once Phase 1 is validated (1-2 weeks):

1. **Analyze effectiveness data**
   - Which adaptations improved outcomes?
   - What adjustment factors work best?
   - Any patterns that need stricter handling?

2. **Tune parameters**
   - Adjust risk reduction factors
   - Refine age decay curve
   - Optimize similarity thresholds

3. **Extend to other layers** (Phase 2)
   - Layer 1: Regime-based adaptations
   - Layer 2: Setup quality adjustments
   - Layer 4: Advanced confidence calibration

---

## Support Resources

- **Implementation Doc**: `PHASE_1_ADAPTIVE_LEARNING_COMPLETE.md`
- **Original Issue**: Session 4 had 0 trades due to Layer 3 blocking
- **Console Logs**: Watch for `[LAYER 3]` and `[LLM Layer 3]` messages
- **Database Table**: `adaptation_effectiveness`
