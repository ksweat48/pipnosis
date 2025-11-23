# LLM Trading Diagnostic Guide - Zero Trades Issue

## Problem
Auto-backtest runs but generates **0 trades** consistently across multiple sessions.

## Solution Implemented

### Enhanced Diagnostic Logging System

We've added comprehensive logging throughout the LLM trading pipeline to identify exactly where trades are being blocked.

---

## How to Diagnose

### Step 1: Run One Backtest Day

1. Navigate to `/admin/ai-training`
2. Open browser DevTools Console (F12)
3. Click "Stop & Reset" if currently running
4. Start new backtest
5. Watch console output in real-time

### Step 2: Look for Key Log Messages

#### **Trigger Detection Phase**

```
✅ EXPECTED:
[Event Engine] 🎯 5 trigger(s) detected! Top: momentum_breakout (72%)
[Event Engine] ✅ Trigger validated: momentum_breakout (72%)

❌ BAD SIGN:
[Event Engine] 📊 No triggers detected (EURUSD @ 2025-11-23T...)
```

If you see "No triggers detected" for most candles:
- **Problem**: Trigger detection rules are too strict OR market data is insufficient
- **Fix**: Lower trigger confidence thresholds or check candle data quality

---

#### **Pre-Pipeline Gating**

```
✅ EXPECTED:
[Event Engine] 🚀 Calling 5-Layer LLM Pipeline... (Tokens: 1200/50000)

❌ BAD SIGN:
[Event Engine] ⚠️ Max concurrent trades reached: 3/3
[Event Engine] ⚠️ Token budget exhausted: 50000/50000
[Event Engine] ⚠️ Insufficient candles: 45/50 required
```

If you see these warnings:
- **Max trades**: Working as intended, wait for positions to close
- **Token budget**: Session used all tokens, will reset next session
- **Insufficient candles**: Data quality issue, check historical candles

---

#### **5-Layer Pipeline Execution**

```
✅ GOOD FLOW:
[HARD GATE] ✅ ALLOWED
[LAYER 1] 🔍 Regime Validation...
[LAYER 1] ✅ PASSED - bullish/medium
[LAYER 2] 📊 Setup Quality Scoring...
[LAYER 2] ✅ PASSED - Quality 75/100
[LAYER 3] ⚠️ Mistake Prevention...
[LAYER 3] ✅ PASSED - Risk: MEDIUM
[LAYER 4] 🎯 Confidence Calibration...
[LAYER 4] ✅ 72% → 68% (-4.0%)
[LAYER 5] 🎯 Execution Decision...
[LAYER 5] ✅ BUY

[LLM Backtest] ✅ TRADE #1 EXECUTED
  Direction: BUY
  Entry: 1.08456
  Confidence: 68%
  Trigger Type: momentum_breakout
```

---

#### **Layer Rejection Examples**

**Layer 1 Rejection (Regime):**
```
[LAYER 1] ❌ REJECTED: Market regime is sideways with low volatility.
Required trending conditions for momentum_breakout trigger.
```
**Fix**: Check if fallback mode is working, or regime validator is too strict

---

**Layer 2 Rejection (Setup Quality):**
```
[LAYER 2] ❌ REJECTED: Quality 58/100
Setup lacks strong confluence. Multiple timeframes not aligned.
```
**Fix**: Quality threshold may be too high (default 65), consider lowering to 55-60

---

**Layer 3 Rejection (Mistake Prevention):**
```
[LAYER 3] ❌ HIGH RISK - Mistake prevention triggered
Recent similar patterns resulted in 4/5 losses. High correlation with failing setups.
```
**Fix**: Pattern history may be blocking valid setups, consider clearing avoid_patterns table

---

**Layer 5 Rejection (Execution Brain):**
```
[LAYER 5] ✅ NO_TRADE
Reason: Risk/reward ratio insufficient. Stop loss too wide relative to take profit target.
```
**Fix**: Execution brain may be too conservative, review prompt or adjust RR requirements

---

### Step 3: Check for API Errors

```
❌ BAD SIGN:
[Event Engine] 🔧 LLM disabled or no API key - using rule-based fallback
  useLLM: true, hasApiKey: false

[LLM Regime Validator] No API key, validator disabled
```

If you see these:
- **Problem**: OPENAI_API_KEY not set or invalid
- **Fix**: Verify environment variable in Netlify settings
- **Note**: You showed the key IS set, so this shouldn't be the issue

---

### Step 4: Query Database for Detailed Analysis

Run the diagnostic SQL script:

```bash
# Open Supabase SQL Editor and run:
cat scripts/diagnostics/diagnose-llm-trading-issue.sql
```

Key queries:
1. **Pipeline executions** - Shows where trades are failing
2. **Layer-by-layer rejection rates** - Identifies the blocking layer
3. **Abort reasons** - Most common rejection explanations
4. **Recent backtest sessions** - Confirms trigger detection rate

---

## Expected Outcomes & Fixes

### Scenario A: No Triggers Detected
**Symptom**:
```
[LLM Backtest] Candles with No Triggers: 850 (95.5%)
[LLM Backtest] Triggers Detected: 40
```

**Diagnosis**: Trigger detection rules are too conservative

**Fix**:
1. Check `trigger-detection-rules.ts`
2. Lower confidence thresholds from 70% → 60%
3. Review VWAP distance requirements
4. Check if ATR-based volatility filter is too strict

---

### Scenario B: All Triggers Blocked at Layer 1
**Symptom**:
```sql
-- Query #2 shows:
layer_1 | Regime Validator | abort | false | 45 | ...
```

**Diagnosis**: Regime validator rejecting all market conditions

**Fix**:
1. Check if `llmRegimeValidator.isEnabled()` returns false
2. Verify fallback validation returns `regime_ok: true`
3. Review regime validation prompt for over-conservative language
4. Temporarily disable Layer 1: `eventBasedLLMEngine.set5LayerPipeline(false)`

---

### Scenario C: Blocked at Layer 2 (Setup Quality)
**Symptom**:
```sql
-- Query #2 shows:
layer_2 | Setup Quality | reject | false | 38 | ...
```

**Diagnosis**: Setup quality scorer rejecting most setups

**Fix**:
1. Lower quality threshold from 65 → 55 in `execute5LayerPipeline()`
2. Review `llmSetupQuality` scoring criteria
3. Check if prompt is too demanding about confluence

---

### Scenario D: Blocked at Layer 3 (Mistake Prevention)
**Symptom**:
```sql
-- Query #4 shows:
abort_layer: 3 | abort_reason: "High risk - pattern matches 5 recent losses" | 22
```

**Diagnosis**: Mistake prevention is blocking based on historical losses

**Fix**:
1. Query `avoid_patterns` table for high-loss patterns
2. Consider clearing historical pattern data for fresh learning
3. Adjust loss rate threshold in mistake prevention
4. Add "learning mode" flag to be more permissive early on

---

### Scenario E: Reaches Layer 5, Always NO_TRADE
**Symptom**:
```sql
-- Query #1 shows:
final_decision: NO_TRADE | 18 executions
```

**Diagnosis**: Final execution brain rejecting valid setups

**Fix**:
1. Review execution brain prompt in `executeSingleLLMCall()`
2. Check if confidence requirements are too high
3. Verify stop loss / take profit calculations
4. Consider adjusting risk/reward minimum ratio

---

### Scenario F: LLM API Calls Failing
**Symptom**:
```
[Event Engine] ❌ API Error: 401 Unauthorized
```

**Diagnosis**: OpenAI API key invalid or expired

**Fix**:
1. Verify `VITE_OPENAI_API_KEY` in Netlify environment variables
2. Test key with curl:
   ```bash
   curl https://api.openai.com/v1/models \
     -H "Authorization: Bearer $OPENAI_API_KEY"
   ```
3. Check OpenAI account has credits
4. Ensure key has access to gpt-4o model

---

## Quick Reference: Console Log Patterns

### ✅ Healthy Backtest
```
[LLM Backtest] Starting candle processing loop (950 candles)...
[Event Engine] 🎯 3 trigger(s) detected! Top: vwap_bounce (68%)
[Event Engine] 🚀 Calling 5-Layer LLM Pipeline...
[LAYER 1] ✅ PASSED - bullish/medium
[LAYER 2] ✅ PASSED - Quality 72/100
[LAYER 3] ✅ PASSED - Risk: MEDIUM
[LAYER 4] ✅ 68% → 65% (-3.0%)
[LAYER 5] ✅ SELL
[LLM Backtest] ✅ TRADE #1 EXECUTED

[LLM Backtest] Progress: 100/950 candles | Triggers: 8 (6 validated) | LLM Calls: 6 | Trades: 1
[LLM Backtest] Progress: 200/950 candles | Triggers: 15 (11 validated) | LLM Calls: 11 | Trades: 2
...
```

### ❌ Unhealthy Backtest (No Triggers)
```
[LLM Backtest] Starting candle processing loop (950 candles)...
[Event Engine] 📊 No triggers detected
[Event Engine] 📊 No triggers detected
[Event Engine] 📊 No triggers detected
...
[LLM Backtest] Progress: 950/950 candles | Triggers: 0 (0 validated) | LLM Calls: 0 | Trades: 0
```

### ❌ Unhealthy Backtest (All Rejected at Layer 1)
```
[Event Engine] 🎯 2 trigger(s) detected! Top: momentum_breakout (74%)
[Event Engine] 🚀 Calling 5-Layer LLM Pipeline...
[LAYER 1] ❌ REJECTED: Sideways regime unsuitable for momentum trades
[Event Engine] 🎯 1 trigger(s) detected! Top: vwap_bounce (66%)
[Event Engine] 🚀 Calling 5-Layer LLM Pipeline...
[LAYER 1] ❌ REJECTED: Low volatility environment
...
[LLM Backtest] Progress: 950/950 candles | Triggers: 42 (38 validated) | LLM Calls: 38 | Trades: 0
```

---

## Developer Mode Logging

The system now **automatically enables developer mode** during backtests for comprehensive logging.

### Manual Enable (if needed)
```sql
INSERT INTO developer_mode_settings (user_id, enabled, log_all_layers, log_to_console, log_to_database)
VALUES ('[your-user-id]', true, true, true, true)
ON CONFLICT (user_id) DO UPDATE
SET enabled = true, log_all_layers = true, updated_at = NOW();
```

### Verify Developer Mode
```sql
SELECT * FROM developer_mode_settings WHERE user_id = '[your-user-id]';
```

Should show:
- `enabled: true`
- `log_all_layers: true`
- `log_to_console: true`
- `log_to_database: true`

---

## What Changed in This Fix

### 1. Enhanced Console Logging
- Every candle now logs if triggers detected or not
- LLM pipeline calls clearly marked with 🚀
- Each layer logs PASS/REJECT with reasons
- Trade executions prominently displayed
- Progress updates every 100 candles

### 2. Auto-Enable Developer Mode
- Backtest automatically enables developer mode
- No manual configuration needed
- All layer decisions logged to database
- Pipeline execution logs captured

### 3. Diagnostic Counters
- Track triggers detected vs validated
- Count LLM calls made
- Monitor trades generated
- Calculate rejection rates

### 4. Diagnostic SQL Queries
- Ready-to-run queries for post-backtest analysis
- Layer-by-layer rejection breakdown
- Most common abort reasons
- Token usage tracking

---

## Next Steps

1. **Run one backtest with console open**
2. **Identify first point of failure** (triggers, layer 1, layer 2, etc.)
3. **Run diagnostic SQL queries** for detailed breakdown
4. **Apply targeted fix** based on findings
5. **Re-test and iterate**

---

## Success Indicators

**Immediate (within 1 backtest):**
- ✅ See trigger detection messages (5-10+ per 100 candles)
- ✅ See Layer 1-5 execution logs
- ✅ At least 1 trade executed

**Short-term (within 3 backtests):**
- ✅ Consistent trigger detection (10+ per day)
- ✅ Mix of PASS and REJECT at each layer
- ✅ 2-5 trades per backtest day

**Long-term (full month backtest):**
- ✅ 20+ trades generated
- ✅ Win rate above 35%
- ✅ Clear AI learning progression

---

## Contact Points

If you still see 0 trades after following this guide, provide:
1. **Full console log** from one backtest day
2. **Results of diagnostic SQL queries**
3. **Screenshot of developer mode settings table**

The issue will be immediately obvious from the logs!
