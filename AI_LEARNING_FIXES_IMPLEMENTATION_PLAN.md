# AI Learning System - Critical Fixes Implementation Plan

## Issues Diagnosed

### ✅ Issue 6: Backtest Loop DOES Continue
**Status:** ALREADY WORKING
- Code at line 822-832 correctly continues to next month
- Loop does NOT stop after 30 days
- **No fix needed**

### ✅ Issue: KPI Aggregation IS Called
**Status:** ALREADY WORKING
- Line 704: `kpiAggregator.updateAllKPIs()` called after each day
- **No fix needed**

### ❌ Issue 2, 3, 4: KPI Tables Empty - ROOT CAUSE FOUND
**Problem:** Source data tables are empty
- `llm_layer_kpis` needs `llm_layer_decision_log` → EMPTY
- `avoid_pattern_kpis` needs `avoid_pattern_enforcement_log` → EMPTY
- `strategy_evolution_kpis` needs pattern discovery data → EMPTY

**Root Cause:** These logging tables aren't populated during synthetic backtests

**Fix Strategy:**
1. **Option A**: Create mock/synthetic log entries during backtests
2. **Option B**: Hide these KPI sections when no data exists
3. **Option C**: Label as "Available only during live trading"

**Recommendation:** Option C (honest labeling) + Option B (hide empty sections)

### ❌ Issue 1: Live Trading Stats During Backtests
**Fix:** Hide the section when auto-backtest is running

### ❌ Issue 5: Too Many Breakeven Trades
**Fix:** Adjust stop loss placement logic

### ❌ Issue 7: Only Shows Day 7
**Need to investigate:** Check if all reflections are being created

### ❌ Issue 9: Add P&L Requirements
**Fix:** Add profitability validation to skill progression

## Implementation Priority

### Phase 1: Quick Wins (30 min)
1. Hide live trading stats during backtests (Issue 1)
2. Hide empty KPI sections with helpful messages (Issues 2,3,4)
3. Increase reflection query limit (Issue 7)

### Phase 2: Trading Logic (30 min)
4. Adjust stop loss for breakeven issue (Issue 5)

### Phase 3: Feature Enhancement (30 min)
5. Add P&L requirements to leveling (Issue 9)

### Phase 4: Diagnostic (15 min)
6. Verify learning pipeline is working (Issue 8)
7. Create diagnostic queries

## Files to Modify

1. **src/components/AILearningProgressDashboard.tsx**
   - Hide live trading section during backtests

2. **src/pages/AILearningCenterPage.tsx**
   - Add "No Data" placeholders for empty KPI sections
   - Label sections appropriately

3. **src/components/AIThoughtStreamOverview.tsx**
   - Increase reflection query limit from 30 to 90

4. **src/services/synthetic-backtesting-engine.ts**
   - Adjust stop loss placement

5. **src/services/ai-skill-tracker.ts**
   - Add P&L validation for level ups

