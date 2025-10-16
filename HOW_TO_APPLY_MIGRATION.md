# How to Apply the Consolidated Database Migration

## Overview
This guide will walk you through applying the consolidated database migration to your Supabase database to enable the Auto Trading feature.

## Prerequisites
- Access to your Supabase Dashboard
- A Supabase account with a project already created
- Your Pipnosis application is already configured with Supabase credentials

## Step-by-Step Instructions

### Step 1: Open the Consolidated Migration File
1. Open the file `CONSOLIDATED_MIGRATION.sql` in your project root directory
2. Copy the ENTIRE contents of the file (Ctrl+A, Ctrl+C or Cmd+A, Cmd+C)

### Step 2: Access Supabase SQL Editor
1. Go to https://supabase.com/dashboard
2. Log in to your account
3. Select your Pipnosis project
4. Click on **SQL Editor** in the left sidebar (the icon looks like `</>`)

### Step 3: Create a New Query
1. Click the **"New query"** button in the SQL Editor
2. You'll see an empty SQL editor window

### Step 4: Paste and Run the Migration
1. Paste the entire contents of `CONSOLIDATED_MIGRATION.sql` into the editor
2. Click the **"Run"** button (or press Ctrl+Enter / Cmd+Enter)
3. Wait for the script to complete (should take 5-15 seconds)
4. You should see success messages in the Results panel

### Step 5: Verify Tables Were Created
1. Click on **Table Editor** in the left sidebar
2. You should now see these tables:
   - `user_profiles`
   - `trading_prompts`
   - `trade_records`
   - `journal_entries`
   - `trading_sessions`
   - `market_data`
   - `market_data_subscriptions`
   - `auto_trading_status` ⭐ (IMPORTANT for auto trading)
   - `user_trading_preferences` ⭐ (IMPORTANT for auto trading)
   - `ai_trade_decisions`
   - `trade_options`
   - `strategy_comparison`
   - `ai_learning_metrics`

### Step 6: Set Your Account as Admin
This is **CRITICAL** for the Auto Trading button to work!

1. In the **Table Editor**, click on the `user_profiles` table
2. Find your user record (search by your email address)
3. Click on the row to edit it
4. Find the `is_admin` column
5. Change the value from `false` to `true`
6. Click **Save** (or press Enter)

### Step 7: Verify the Migration
To confirm everything is set up correctly:

1. Go to the **SQL Editor** again
2. Run this verification query:

```sql
-- Check if critical auto trading tables exist
SELECT
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'auto_trading_status') as auto_trading_status_exists,
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_trading_preferences') as preferences_exists,
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ai_trade_decisions') as ai_decisions_exists;

-- Check your admin status
SELECT id, email, is_admin, account_balance
FROM user_profiles
WHERE is_admin = true;
```

3. You should see:
   - All three tables exist (all values should be `true`)
   - Your user account with `is_admin = true`

### Step 8: Refresh Your Application
1. Go back to your Pipnosis application in the browser
2. Hard refresh the page (Ctrl+Shift+R or Cmd+Shift+R)
3. Clear browser cache if needed (Ctrl+Shift+Delete or Cmd+Shift+Delete)
4. Log in again if necessary

### Step 9: Test Auto Trading Button
1. Navigate to the Auto Trading section in your app
2. You should now see the Auto Trading panel
3. The "Start" button should be enabled and clickable
4. Click "Start" to test if it works

## Expected Results

✅ **Before clicking Start:**
- You should see the Auto Trading panel with status showing "Not Initialized" or "Disabled"
- The "Start" button should be visible and enabled (green)

✅ **After clicking Start:**
- Button should change to "Starting..." with a spinner
- After a few seconds, status should change to "Active - Scanning"
- You should see stats like "Total Trades: 0", "Daily P&L: $0.00", etc.
- Console should NOT show 404 or 409 errors

## Troubleshooting

### Problem: Tables don't appear after running the migration
**Solution:**
- Make sure you copied the ENTIRE SQL script
- Check the Results panel for any error messages
- Try running the script again (it's safe to run multiple times)

### Problem: Auto Trading button still doesn't work
**Solution:**
1. Verify you set `is_admin = true` in your user_profiles record
2. Check browser console for errors (F12 > Console tab)
3. Verify your `.env` file has correct Supabase credentials
4. Try logging out and logging back in

### Problem: Getting "permission denied" errors
**Solution:**
- Make sure you're logged in to your application
- Verify RLS policies were created correctly
- Check that your user ID matches the ID in user_profiles table

### Problem: Console shows "user_trading_preferences not found"
**Solution:**
- The table should be created automatically by the first insert
- Verify the table exists in Table Editor
- Check RLS policies allow INSERT for authenticated users

## What This Migration Does

The consolidated migration script:

1. ✅ Creates all core tables (users, trades, journal, etc.)
2. ✅ Creates market data tables for price caching
3. ✅ Creates auto trading tables (status, preferences)
4. ✅ Creates AI trading brain tables (decisions, options, learning)
5. ✅ Adds all necessary indexes for performance
6. ✅ Sets up Row Level Security (RLS) policies
7. ✅ Creates functions and triggers for automation
8. ✅ Sets up analytics views for admin dashboard

## Security Notes

- All tables have Row Level Security (RLS) enabled
- Users can only access their own data
- Admin users can view all data for analytics
- Market data is publicly readable
- Auto trading requires admin privileges (for testing phase)

## Need Help?

If you encounter issues:
1. Check the browser console for error messages (F12)
2. Look at the Supabase logs in your Dashboard
3. Verify all steps were completed in order
4. Make sure your Supabase project is not paused or sleeping

## Next Steps After Successful Migration

1. ✅ Test the Auto Trading start/stop functionality
2. ✅ Verify trades are being recorded in the database
3. ✅ Check that the AI analysis features work
4. ✅ Monitor the market data tables for live price updates
5. ✅ Review the admin dashboard analytics views

---

**Remember:** The auto trading feature is currently in testing mode and restricted to admin users only. Once you've set your account's `is_admin` field to `true`, you'll have full access to test and use the feature.
