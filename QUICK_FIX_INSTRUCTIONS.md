# QUICK FIX: EV Calculator Database Error

## The Problem
Your EV Calculator is broken with this error:
```
400 Bad Request - Could not find the 'avg_loss_amount' column
```

## The Solution (2 Minutes)

### Open Supabase Dashboard
1. Go to your Supabase project
2. Click "SQL Editor" in the left sidebar

### Run the Fix Migration
1. Copy the contents of this file:
   ```
   supabase/migrations/20251115000000_fix_ai_pattern_ev_tracking_schema.sql
   ```
2. Paste into Supabase SQL Editor
3. Click "Run"

### You Should See
```
✅ Schema verification passed! All critical columns present.
```

### Refresh Your App
The 400 errors should be gone and EV tracking will work!

---

## Optional: Run Diagnostic First
If you want to see the current broken state first:

1. Copy contents of: `supabase/migrations/DIAGNOSTIC_check_ai_pattern_ev_tracking.sql`
2. Paste into Supabase SQL Editor
3. Click "Run"
4. Review the results showing missing columns

---

## What This Fixes
- Adds missing `user_id` column
- Fixes column names: `win_probability`, `avg_win_amount`, `avg_loss_amount`
- Adds `volatility_regime` column
- Adds pattern tracking columns
- Recreates proper indexes and RLS policies

## Safety
- Automatically backs up any existing data
- Safe to run multiple times
- Includes verification step

---

**For detailed explanation, see:** `supabase/migrations/README_FIX_EV_CALCULATOR.md`
