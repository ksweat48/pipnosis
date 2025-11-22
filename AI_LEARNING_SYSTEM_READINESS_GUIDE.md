# AI Learning System Readiness Guide

**Last Updated**: 2025-11-22

This guide ensures your AI learning system is fully operational before running backtests.

---

## Quick Start

**Run the automated readiness check:**

```bash
node scripts/verify-ai-readiness.cjs
```

**Expected Output:**
```
🎉 OVERALL STATUS: ✅ HEALTHY - READY FOR BACKTEST!

All critical systems are operational.
The AI has full access to all data needed for learning.
```

---

## What This Checks

### ✅ Critical Systems (Must Pass)

1. **Database Connection** - Can connect to Supabase
2. **Critical Tables** - All 8 core AI learning tables exist and are accessible
3. **Data Access** - User can read/write to learning tables (if TEST_USER_ID provided)

### ⚠️ Optional Systems (Nice-to-Have)

1. **KPI Tables** - Performance metrics dashboards
2. **Plateau Detection** - Breakthrough triggering system
3. **Daily Meta Analysis** - Advanced aggregated insights

---

## Critical Tables Required

These **8 tables** are essential for AI learning:

| Table | Purpose | What AI Stores |
|-------|---------|----------------|
| `ai_learning_insights` | Pattern discoveries | "EURUSD trends up after news events" |
| `ai_skill_progression` | Skill level tracking | Current level, win rate, progress |
| `ai_session_learnings` | Daily summaries | What I learned today |
| `ai_pattern_ev_tracking` | Pattern effectiveness | This pattern has 65% win rate |
| `synthetic_backtest_sessions` | Backtest records | Session metadata, results |
| `synthetic_backtest_trades` | Individual trades | Entry, exit, PnL for each trade |
| `ai_trade_analysis` | Trade-by-trade analysis | Why this trade won/lost |
| `ai_performance_evolution` | Historical tracking | How I'm improving over time |

**If ANY of these are missing, AI learning will NOT work.**

---

## How to Use the Readiness Check

### Basic Usage (No User ID)

```bash
node scripts/verify-ai-readiness.cjs
```

**Checks:**
- Database connection
- All critical tables exist
- All optional tables exist

**Does NOT check:**
- User-specific data access
- Existing backtest data

### Advanced Usage (With User ID)

Add your user ID to `.env`:

```bash
TEST_USER_ID=your-uuid-here
```

Then run:

```bash
node scripts/verify-ai-readiness.cjs
```

**Additional Checks:**
- Can user access ai_skill_progression?
- Can user access ai_learning_insights?
- Does user have existing backtest sessions?
- Are RLS policies working correctly?

---

## Interpreting Results

### 🎉 HEALTHY - Ready for Backtest

```
✅ Database Connection:   OK
✅ Critical Tables:       OK (8/8)
✅ Optional Tables:       OK (6/6)
✅ User Data Access:      OK
```

**Action**: Proceed with backtesting! All systems operational.

### ⚠️ WARNINGS - Partial Success

```
✅ Database Connection:   OK
✅ Critical Tables:       OK (8/8)
⚠️  Optional Tables:       PARTIAL (3/6)
✅ User Data Access:      OK
```

**Warnings:**
- Optional tables missing: plateau_detection_log, breakthrough_experiments

**Action**: You can proceed, but some features won't work:
- Plateau detection disabled
- Breakthrough mode unavailable
- Some KPI metrics missing

### 🚨 CRITICAL ISSUES - Do Not Proceed

```
❌ Database Connection:   FAILED
❌ Critical Tables:       FAILED (5/8)
⚠️  Optional Tables:       PARTIAL (2/6)
```

**Critical Issues:**
1. [Connection] Cannot connect to Supabase database
   Fix: Check VITE_SUPABASE_URL and VITE_SUPABASE_SERVICE_ROLE_KEY in .env

2. [Schema] Missing critical tables: ai_learning_insights, ai_skill_progression, ai_pattern_ev_tracking
   Fix: Run missing migrations or check RLS policies

**Action**: DO NOT RUN BACKTEST. Fix all critical issues first.

---

## Common Issues and Fixes

### Issue 1: Missing Tables

**Symptom:**
```
❌ ai_learning_insights - NOT ACCESSIBLE
❌ ai_skill_progression - NOT ACCESSIBLE
```

**Cause**: Migrations not applied

**Fix**:
1. Check Supabase Dashboard → Database → Migrations
2. Verify these migrations are applied:
   - `20251108120000_create_ai_learning_system.sql`
   - `20251109120000_create_ai_skill_tracking_system.sql`
3. If missing, apply migrations from `supabase/migrations/` folder

### Issue 2: RLS Access Denied

**Symptom:**
```
❌ ai_learning_insights - ACCESS DENIED: permission denied for table ai_learning_insights
```

**Cause**: Row Level Security (RLS) policies blocking access

**Fix**:
1. Using Supabase Dashboard, go to Database → Tables
2. Find `ai_learning_insights` table
3. Check "Policies" tab
4. Verify policy exists: "Users can insert own learning data"
5. If missing, run migration: `20251108120000_create_ai_learning_system.sql`

### Issue 3: Connection Failed

**Symptom:**
```
❌ Database connection failed: Invalid API key
```

**Cause**: Missing or incorrect Supabase credentials

**Fix**:
1. Check `.env` file exists in project root
2. Verify it contains:
   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   VITE_SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ```
3. Get keys from Supabase Dashboard → Settings → API

### Issue 4: User Has No Data (Warning)

**Symptom:**
```
⚠️  ai_skill_progression - NO DATA (normal before first backtest)
```

**Cause**: User hasn't run any backtests yet

**Status**: **NORMAL** - This is expected before first backtest

**Action**: None required. Data will populate after first backtest.

---

## What Happens During First Backtest

After running your first backtest, the following data flow occurs:

```
1. Backtest Runs
   ↓
2. Creates synthetic_backtest_sessions record
   ↓
3. Creates synthetic_backtest_trades records (one per trade)
   ↓
4. Triggers AI Learning Engine
   ↓
5. AI Analyzes Each Trade → Writes to ai_trade_analysis
   ↓
6. AI Discovers Patterns → Writes to ai_learning_insights
   ↓
7. AI Updates Pattern Effectiveness → Writes to ai_pattern_ev_tracking
   ↓
8. AI Generates Session Summary → Writes to ai_session_learnings
   ↓
9. AI Updates Skill Level → Updates ai_skill_progression
   ↓
10. AI Tracks Performance → Writes to ai_performance_evolution
```

**Validation After First Backtest:**

Re-run the readiness check:

```bash
node scripts/verify-ai-readiness.cjs
```

**Expected Changes:**
- `ai_skill_progression` - NOW HAS DATA (skill level, trades count)
- `ai_learning_insights` - Should have 3-10 insights
- `ai_trade_analysis` - Should match number of trades
- `ai_session_learnings` - Should have 1 summary

---

## Manual Verification (SQL Queries)

If you prefer SQL, you can run these queries in Supabase SQL Editor:

### Check All Critical Tables Exist

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN (
  'ai_learning_insights',
  'ai_skill_progression',
  'ai_session_learnings',
  'ai_pattern_ev_tracking',
  'synthetic_backtest_sessions',
  'synthetic_backtest_trades',
  'ai_trade_analysis',
  'ai_performance_evolution'
)
ORDER BY table_name;
```

**Expected**: 8 rows returned

### Check User Skill Progression

```sql
SELECT
  current_skill_level,
  total_trades_analyzed,
  current_win_rate,
  current_profit_factor,
  total_backtests_completed,
  updated_at
FROM ai_skill_progression
WHERE user_id = 'your-user-id-here';
```

**Expected**:
- Before first backtest: 0 rows
- After first backtest: 1 row with data

### Check Learning Insights

```sql
SELECT
  COUNT(*) as total_insights,
  COUNT(CASE WHEN insight_type = 'winning_pattern' THEN 1 END) as winning_patterns,
  COUNT(CASE WHEN insight_type = 'losing_pattern' THEN 1 END) as losing_patterns,
  MAX(created_at) as last_insight_date
FROM ai_learning_insights
WHERE user_id = 'your-user-id-here';
```

**Expected**:
- Before first backtest: 0 insights
- After first backtest: 3-10 insights

---

## Advanced Diagnostics

For detailed diagnostics, use the built-in verification script:

```bash
# In Supabase SQL Editor, run:
# VERIFY_AI_LEARNING_TRACKING.sql
```

This comprehensive SQL script checks:
- Overall skill progression status
- Recent learning activity
- Trade analysis completeness
- Performance evolution tracking
- Session learning summaries
- Confidence accuracy calibration
- Learning progress summary

**Location**: `VERIFY_AI_LEARNING_TRACKING.sql` in project root

---

## Pre-Backtest Checklist

Before starting your backtesting session:

- [ ] Run `node scripts/verify-ai-readiness.cjs`
- [ ] Verify: ✅ HEALTHY status
- [ ] All critical tables accessible (8/8)
- [ ] Database connection working
- [ ] User data access confirmed (if applicable)
- [ ] No critical issues reported
- [ ] Environment variables set correctly

**If all checks pass: YOU ARE READY TO BACKTEST!**

---

## Post-Backtest Validation

After completing your first backtest:

- [ ] Re-run `node scripts/verify-ai-readiness.cjs`
- [ ] Check: `ai_skill_progression` has data
- [ ] Check: `ai_learning_insights` count > 0
- [ ] Check: `ai_trade_analysis` count matches trades
- [ ] Check: `ai_session_learnings` has 1 summary
- [ ] Verify: `updated_at` timestamps are recent
- [ ] Visit AI Learning Center to see insights

**If all checks pass: AI IS LEARNING SUCCESSFULLY!**

---

## System Architecture Overview

Your AI learning system has **3 validation layers**:

### Layer 1: Pre-Flight Check (This Script)
- Validates tables exist
- Checks database access
- Verifies no blocking issues
- **Run before backtesting**

### Layer 2: Runtime Validators (TypeScript)
- `ai-data-access-validator.ts` - Real-time access checks
- `ai-learning-health-check.ts` - System health monitoring
- `learning-pipeline-health-check.ts` - Pipeline stage tracking
- **Run automatically during backtests**

### Layer 3: Post-Session Verification (SQL)
- `VERIFY_AI_LEARNING_TRACKING.sql` - Comprehensive data audit
- Checks all learning data populated
- Validates data quality
- **Run after backtests to confirm learning**

---

## Troubleshooting

### "I ran the script but got permission errors"

**Solution**: Use service role key instead of anon key

In `.env`:
```bash
# Use service role key for admin operations
VITE_SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

### "Some optional tables are missing"

**Impact**: Non-critical. Some KPI dashboards won't display data.

**Action**: You can proceed with backtesting. Optional features include:
- Plateau detection visualizations
- Breakthrough experiment tracking
- Advanced KPI metrics

**Fix (optional)**: Apply these migrations:
- `20251114120000_add_plateau_breakthrough_system.sql`
- `20251120013825_create_comprehensive_kpi_system.sql`

### "Validation passes but AI isn't learning"

**Symptoms**:
- Backtest completes successfully
- But `ai_learning_insights` stays empty
- `ai_skill_progression` not updating

**Diagnostic Steps**:
1. Check browser console for errors
2. Check `ai_trade_analysis` table - should have data
3. Check `synthetic_backtest_trades` table - verify trades exist
4. Look for errors in AI Learning Engine logs

**Common Causes**:
- Trade count too low (< 5 trades)
- All trades broke even (no winners/losers to learn from)
- JavaScript errors preventing learning engine from running

---

## Getting Help

If validation fails and you can't resolve it:

1. **Review Error Messages**: Script provides specific fixes
2. **Check Migration Files**: Verify all migrations applied
3. **Review RLS Policies**: Ensure user has access
4. **Check Browser Console**: Look for runtime errors
5. **Run SQL Diagnostics**: Use `VERIFY_AI_LEARNING_TRACKING.sql`

---

## Summary

**This readiness check ensures:**
✅ All critical AI learning tables exist
✅ Database connection is working
✅ User can access their data
✅ No RLS policy blocks
✅ System is ready for AI learning

**After passing validation:**
- Your AI can store pattern discoveries
- Skill level will track automatically
- Learning happens after each session
- Performance improves over time

**Run this check before EVERY major backtest run to ensure system health.**

---

**Quick Commands Reference:**

```bash
# Run readiness check
node scripts/verify-ai-readiness.cjs

# Run with user ID validation
TEST_USER_ID=your-user-id node scripts/verify-ai-readiness.cjs

# Check from any directory
node /path/to/project/scripts/verify-ai-readiness.cjs
```

---

**Exit Codes:**
- `0` - All checks passed, ready for backtest
- `1` - Critical issues found, do not proceed
