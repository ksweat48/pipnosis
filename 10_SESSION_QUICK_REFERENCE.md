# 10-Session Learning Cycle - Quick Reference

## What It Does

Every 10 single-day trading sessions, the LLM brain automatically:
1. Analyzes the last 10 sessions as a rolling window
2. Extracts key learnings (what worked, what didn't)
3. Identifies best/worst performing setups
4. Generates actionable recommendations
5. Queues and applies improvements immediately
6. Runs consistency validation (WR spread, PF average)

## Learning Schedule

### In a 30-Day Cycle:

**Day 10:** Analyze sessions 1-10 → Apply improvements
**Day 20:** Analyze sessions 11-20 → Apply improvements (cumulative)
**Day 30:** Analyze sessions 21-30 → Apply improvements (cumulative)

### Key Points:
- All improvements are cumulative (day 20 includes day 10 learnings)
- Next 30-day cycle starts with ALL previous learnings
- AI gets smarter every 10 sessions instead of every 30

## Files Modified

### 1. `src/services/simple-auto-backtest-service.ts`
- Changed learning trigger from 30 sessions to 10
- Added cycle tracking (which cycle, day in cycle)
- New method: `triggerLLMLearningCycle()`
- New method: `runConsistencyValidation()`

### 2. `src/services/session-learning-generator.ts`
- New method: `generateRolling10SessionLearning()`
- Analyzes 10-session windows
- Saves with cycle metadata

### 3. `supabase/migrations/20251119000000_add_metadata_to_session_learnings.sql`
- Added `metadata` jsonb column
- Tracks cycle number, session range, cycle type

## Console Output

### When Learning Triggers (Every 10th Day):

```
[Auto-Backtest] ========== DAY 10/30 (Cycle 1, Day 10/10) ==========
[Auto-Backtest] Day 10 complete
[Auto-Backtest] ========== 10-SESSION LEARNING CYCLE COMPLETE ==========
[Auto-Backtest] 🧠 Triggering LLM Brain to analyze last 10 sessions...
[Auto-Backtest] Sessions analyzed: 1 through 10

[Session Learning] 🧠 Generating 10-session rolling window learning (Sessions 1-10)
[Session Learning] Analyzing 150 trades across 10 sessions
[Session Learning] ✅ 10-session learning complete
[Session Learning]   - 5 key learnings extracted
[Session Learning]   - 8 recommendations generated
[Session Learning]   - Improvements queued for immediate application

[Auto-Backtest] 🎯 Running consistency validation...
[Auto-Backtest] Consistency Validation Results:
  - Passed: ✅ YES
  - WR Spread: 5.23% (Max: 8.00%)
  - PF Average: 1.85 (Min: 1.50)

[Auto-Backtest] ✅ LLM learning complete - improvements applied
[Auto-Backtest] Continuing with next 10-session cycle...
```

## Database Verification

### Check Recent Learning Cycles:

```sql
SELECT
  session_date,
  metadata->>'learning_cycle' as cycle,
  metadata->>'session_range' as range,
  key_learnings,
  actionable_recommendations
FROM ai_session_learnings
WHERE user_id = '<your_user_id>'
  AND metadata->>'cycle_type' = '10_session_rolling_window'
ORDER BY session_date DESC
LIMIT 5;
```

### Expected Results:
```
session_date | cycle | range   | key_learnings (count) | recommendations (count)
-------------|-------|---------|----------------------|------------------------
2025-11-19   |   3   | 21-30   |          6          |           9
2025-11-19   |   2   | 11-20   |          5          |           8
2025-11-19   |   1   |  1-10   |          5          |           7
```

## How to Monitor

### Watch for These Logs:
1. Day count: "DAY X/30 (Cycle Y, Day Z/10)"
2. Learning trigger: "10-SESSION LEARNING CYCLE COMPLETE"
3. Analysis: "Analyzing X trades across 10 sessions"
4. Validation: "Consistency Validation Results"
5. Completion: "LLM learning complete - improvements applied"

### Key Metrics to Track:
- Number of key learnings extracted per cycle
- Number of recommendations generated
- Consistency validation pass/fail status
- WR spread and PF average trends
- Best/worst setup identification

## Troubleshooting

### If Learning Doesn't Trigger at Day 10:

1. **Check Auto-Backtest is Running:**
   ```sql
   SELECT is_running, current_day_in_month
   FROM auto_backtest_global_state
   WHERE user_id = '<your_user_id>';
   ```

2. **Check Session Count:**
   ```sql
   SELECT COUNT(*) FROM synthetic_backtest_sessions
   WHERE user_id = '<your_user_id>'
     AND execution_mode = 'AUTO'
     AND created_at >= now() - interval '30 days';
   ```

3. **Check Learning Records:**
   ```sql
   SELECT * FROM ai_session_learnings
   WHERE user_id = '<your_user_id>'
   ORDER BY created_at DESC
   LIMIT 5;
   ```

### Common Issues:
- **No trades in sessions:** Learning skipped (expected behavior)
- **Database timeout:** Adaptive throttling will slow down
- **Missing metadata:** Run new migration

## Benefits Recap

### Before (30-Day Cycle):
- AI learned once every 30 days
- Waited until end of month to apply improvements
- No intermediate adaptation

### After (10-Session Cycles):
- AI learns 3 times per month (days 10, 20, 30)
- Improvements applied immediately
- Faster iteration and adaptation
- Cumulative learning compounds over time
- Better consistency tracking alignment

## Next Steps

### After Implementation:
1. ✅ Database migration applied
2. ✅ Code changes deployed
3. ✅ Build verified
4. ⏳ Monitor first 10-session cycle
5. ⏳ Verify learning triggers at day 10, 20, 30
6. ⏳ Check consistency validation results
7. ⏳ Confirm improvements are applied and carried forward

### Success Indicators:
- Learning logs appear every 10 sessions
- Metadata properly stored in database
- Consistency validation runs automatically
- Key learnings and recommendations generated
- AI performance improves within each 30-day cycle
- Cumulative improvements visible across cycles

## Documentation

See full details in: `10_SESSION_LEARNING_CYCLE_IMPLEMENTATION.md`
