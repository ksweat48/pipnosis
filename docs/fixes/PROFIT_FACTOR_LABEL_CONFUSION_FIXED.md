# Profit Factor Label Confusion - Fixed

## Problem Identified

The UI displayed two different profit factor metrics with misleading labels, causing confusion:

### Before Fix:

**Performance Progressing Section:**
- Label: "Profit Factor Range"
- Value: "0.14 - 20.07, Avg: 1.97 | 19.93 spread"
- **Actual Timeframe**: Last 30 backtest sessions
- **Purpose**: Detect performance plateaus

**Current Skill Level Section:**
- Label: "Profit Factor (daily rolling)" ❌ **MISLEADING!**
- Value: "8.86 / 1.20"
- **Actual Timeframe**: Last 10 backtest sessions (rolling average)
- **Purpose**: Skill level advancement criteria

### The Confusion:

1. **"Daily rolling" was incorrect** - it's actually a 10-session rolling average
2. **Two different timeframes** (30-session vs 10-session) were not clearly distinguished
3. **Users couldn't tell** why the numbers were so different

## Solution Implemented

### 1. Fixed Misleading Labels

**Changed in Current Skill Level Section:**
- ❌ OLD: "Win Rate (daily rolling)"
- ✅ NEW: "Win Rate (10-session avg)"

- ❌ OLD: "Profit Factor (daily rolling)"
- ✅ NEW: "Profit Factor (10-session avg)"

- ❌ OLD: "Consistency (daily)"
- ✅ NEW: "Consistency (10-session)"

### 2. Added Explanatory Tooltips

**Current Skill Level Section (10-session metrics):**
- Added ⓘ icon next to each metric
- Hover tooltip: "Average win rate over your last 10 completed backtest sessions. Updates after each session."
- Hover tooltip: "Average profit factor over your last 10 completed backtest sessions. Updates after each session."
- Hover tooltip: "Win rate spread over last 10 sessions. Lower spread = more consistent performance. Updates after each session."

**Performance Progressing Section (30-session metrics):**
- Added Info icon with hover tooltips
- Hover tooltip: "Min to max win rate across your last 30 backtest sessions. Used to detect if performance is stuck in a narrow range (plateau)."
- Hover tooltip: "Min to max profit factor across your last 30 backtest sessions. Shows your performance volatility for plateau detection."

## Technical Details

### Two Different Metrics Explained:

| Metric | Timeframe | Source | Purpose | Calculation |
|--------|-----------|--------|---------|-------------|
| **Performance Progressing** | 30 sessions | `plateau-detector.ts` | Plateau detection | Min/Max/Avg of last 30 sessions |
| **Skill Level Requirements** | 10 sessions | `ai_skill_progression` table | Level advancement | Rolling average of last 10 sessions |

### Why Two Different Timeframes?

**30-Session Window (Performance Progressing):**
- Longer view to catch sustained plateaus
- Shows if you're stuck in a narrow performance range
- Triggers exploration mode when plateau detected

**10-Session Window (Current Skill Level):**
- Shorter view for faster skill progression
- Must consistently meet thresholds to advance
- Prevents lucky streaks from inflating skill level

### Code Changes:

**Files Modified:**
1. `src/components/AILearningProgressDashboard.tsx` - Fixed "daily rolling" labels to "10-session avg"
2. `src/components/PlateauBreakthroughDashboard.tsx` - Added tooltips explaining 30-session metrics

## After Fix:

### Current Skill Level Section Now Shows:
```
Requirements for Next Level (updates daily)

Win Rate (10-session avg) ⓘ
51.4% / 65%
Need +13.6%

Profit Factor (10-session avg) ⓘ
8.86 / 1.20
✓ Met

Consistency (10-session) ⓘ
0.0% / ±35%
In progress
```

### Performance Progressing Section Now Shows:
```
Performance Progressing
AI continues to improve

Win Rate Range ⓘ
16.7% - 75.0%
58.3% spread

Profit Factor Range ⓘ
0.14 - 20.07
Avg: 1.97 | 19.93 spread
```

**Hover tooltips explain exactly what each metric measures!**

## User Benefits

### Before:
- ❌ "Why does it say 'daily' when I run backtests?"
- ❌ "Why are there two profit factors?"
- ❌ "Is one measuring weeks and the other days?"
- ❌ Confusion about what metrics mean

### After:
- ✅ Clear labels: "10-session avg" vs "30-session range"
- ✅ Tooltips explain purpose of each metric
- ✅ Users understand the difference
- ✅ No more confusion about timeframes

## Testing

Build completed successfully:
```
✓ 1719 modules transformed.
✓ built in 43.06s
```

All labels updated, tooltips added, no errors.

## Summary

**Problem**: Misleading "daily rolling" label when metrics are actually session-based

**Solution**:
- Fixed all labels to say "10-session avg" instead of "daily rolling"
- Added tooltips explaining 30-session vs 10-session metrics
- Made it clear what each metric measures and why

**Result**: Users now understand that:
1. **Skill Level Requirements** = Last 10 sessions (for faster progression)
2. **Performance Progressing** = Last 30 sessions (for plateau detection)
3. Neither metric is "daily" - they're both session-based
4. Each metric serves a different purpose in the learning system
