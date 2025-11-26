# Quick Start: AI Engine Reset

## Execute Data Cleanup (5 minutes)

### Step 1: Open Supabase SQL Editor
1. Go to your Supabase dashboard: https://supabase.com/dashboard
2. Select your project
3. Click "SQL Editor" in the left sidebar

### Step 2: Run Cleanup Script
1. Open the file `EXECUTE_AI_DATA_CLEANUP.sql` from your project root
2. Copy the entire contents
3. Paste into Supabase SQL Editor
4. Click "Run"
5. Wait for completion (should take 10-30 seconds)

### Step 3: Verify Results
The verification query at the end will show:
```
All tables should have 0 remaining_rows
```

### Step 4: Check Admin Dashboard
1. Navigate to your Admin Dashboard
2. Go to "Data Management" → "AI Training Data" tab
3. You should see: "Ready for New GPT-4 AI System"
4. All counters should show 0

## What's Been Reset

✅ All backtest sessions and results
✅ All AI learning insights and patterns
✅ All skill progression data
✅ All GPT-4o usage tracking
✅ All predictions and recommendations

## What's Preserved

✅ User accounts
✅ Market data and candles
✅ Chart preferences
✅ System settings

## You're Ready!

Start running new backtests with your GPT-4 AI engine. The system will automatically populate with fresh data.

---

**Need help?** Check `AI_ENGINE_RESET_COMPLETE.md` for detailed documentation.
