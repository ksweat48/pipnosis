# AI Learning System - Quick Reference Card

**ONE-PAGE CHEAT SHEET FOR PRE-BACKTEST VALIDATION**

---

## ⚡ Quick Start

```bash
# Run automated check
node scripts/verify-ai-readiness.cjs

# Expected output
🎉 OVERALL STATUS: ✅ HEALTHY - READY FOR BACKTEST!
```

**If you see this ↑ you're good to go!**

---

## 🎯 What Gets Checked

| Check | What It Does | Critical? |
|-------|-------------|-----------|
| Database Connection | Can connect to Supabase | YES |
| Critical Tables (8) | AI learning tables exist | YES |
| Optional Tables (6) | KPI/plateau tables exist | NO |
| User Data Access | Can read/write learning data | YES* |

*Only if TEST_USER_ID is set in .env

---

## 📋 Critical Tables (Must Exist)

1. ✅ `ai_learning_insights` - Pattern discoveries
2. ✅ `ai_skill_progression` - Skill tracking
3. ✅ `ai_session_learnings` - Daily summaries
4. ✅ `ai_pattern_ev_tracking` - Pattern effectiveness
5. ✅ `synthetic_backtest_sessions` - Backtest records
6. ✅ `synthetic_backtest_trades` - Trade records
7. ✅ `ai_trade_analysis` - Trade-by-trade analysis
8. ✅ `ai_performance_evolution` - Historical tracking

**Missing ANY = AI cannot learn!**

---

## 🚦 Status Indicators

### 🎉 HEALTHY - Ready to Backtest
```
✅ Database Connection:   OK
✅ Critical Tables:       OK (8/8)
✅ User Data Access:      OK
```
**Action**: Start backtesting!

### ⚠️ WARNINGS - Proceed with Caution
```
✅ Database Connection:   OK
✅ Critical Tables:       OK (8/8)
⚠️  Optional Tables:       PARTIAL (3/6)
```
**Action**: Can proceed, some KPIs won't work

### 🚨 CRITICAL - Do Not Proceed
```
❌ Database Connection:   FAILED
❌ Critical Tables:       FAILED (5/8)
```
**Action**: Fix issues, re-run check

---

## 🔧 Common Fixes

### Missing Tables
**Error**: `❌ ai_learning_insights - NOT ACCESSIBLE`

**Fix**: Apply migrations in Supabase Dashboard

### Access Denied
**Error**: `❌ ACCESS DENIED: permission denied`

**Fix**: Check RLS policies, use service role key

### Connection Failed
**Error**: `❌ Database connection failed`

**Fix**: Check `.env` for VITE_SUPABASE_URL and keys

### No Data (Warning)
**Error**: `⚠️ NO DATA (normal before first backtest)`

**Status**: NORMAL - Will populate after first backtest

---

## 📊 Data Flow After First Backtest

```
Backtest → Sessions Table → Trades Table
    ↓
AI Learning Engine
    ↓
├─ Trade Analysis
├─ Pattern Discovery
├─ Pattern Effectiveness
├─ Session Summary
├─ Skill Update
└─ Performance Tracking
```

**Validate After**: Re-run script, check data populated

---

## 🛠️ Advanced Usage

### With User ID
```bash
# Add to .env
TEST_USER_ID=your-uuid-here

# Run check
node scripts/verify-ai-readiness.cjs
```

### SQL Verification
```sql
-- Check all tables exist
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN (
  'ai_learning_insights',
  'ai_skill_progression',
  'synthetic_backtest_sessions'
);
-- Should return 3 rows
```

---

## ✅ Pre-Backtest Checklist

- [ ] Run `node scripts/verify-ai-readiness.cjs`
- [ ] Status: ✅ HEALTHY
- [ ] Critical tables: 8/8
- [ ] No critical issues
- [ ] .env configured

**ALL CHECKED? START BACKTESTING!**

---

## 📈 Post-Backtest Validation

- [ ] Re-run readiness check
- [ ] `ai_skill_progression` has data
- [ ] `ai_learning_insights` > 0
- [ ] `ai_session_learnings` has entry
- [ ] Check AI Learning Center

**ALL CHECKED? AI IS LEARNING!**

---

## 🆘 When to Run This Check

1. ✅ **Before first backtest** - Ensure system ready
2. ✅ **After migrations** - Verify changes applied
3. ✅ **After deployment** - Confirm production setup
4. ✅ **When errors occur** - Diagnose issues
5. ✅ **Regular health checks** - Monthly validation

---

## 📖 Full Documentation

- **Complete Guide**: `AI_LEARNING_SYSTEM_READINESS_GUIDE.md`
- **SQL Verification**: `VERIFY_AI_LEARNING_TRACKING.sql`
- **Diagnostic Script**: `scripts/verify-ai-readiness.cjs`

---

## 🎯 Bottom Line

**Green = Go**
```
🎉 OVERALL STATUS: ✅ HEALTHY
```

**Red = Stop**
```
🚨 OVERALL STATUS: ❌ CRITICAL ISSUES
```

**Run the check. Trust the check. Follow the check.**

---

*Quick Reference v1.0 - 2025-11-22*
