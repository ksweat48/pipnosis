# Auto-Backtest System - Deployment Checklist

## ✅ Pre-Deployment Checklist

### 1. Database Migration
- [ ] Apply migration: `supabase/migrations/20251111040000_create_auto_backtest_system.sql`
- [ ] Verify tables created:
  - `auto_backtest_controller`
  - `auto_backtest_health_log`
  - `auto_backtest_config`
- [ ] Verify RLS policies are enabled on all tables
- [ ] Verify indexes are created

### 2. Code Verification
- [x] Build completes successfully (`npm run build`)
- [x] No TypeScript errors
- [x] No console errors in development
- [x] All new files created:
  - `src/services/auto-backtest-controller.ts`
  - `src/components/AutoBacktestDashboard.tsx`
- [x] Existing files updated correctly:
  - `src/pages/AITrainingPage.tsx`

### 3. Environment Variables
- [ ] Verify Supabase credentials are set:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
- [ ] No additional environment variables needed

### 4. Supabase Configuration
- [ ] Confirm user authentication is working
- [ ] Confirm RLS policies are enforced
- [ ] Confirm database connection pool is adequate
- [ ] Check Supabase usage limits (auto-backtest will use more queries)

## 🚀 Deployment Steps

### Step 1: Apply Database Migration
```bash
# If using Supabase CLI
supabase db push

# Or manually via Supabase Dashboard:
# 1. Go to SQL Editor
# 2. Paste contents of 20251111040000_create_auto_backtest_system.sql
# 3. Click Run
```

### Step 2: Verify Migration Success
```sql
-- Check tables exist
SELECT table_name
FROM information_schema.tables
WHERE table_name IN (
  'auto_backtest_controller',
  'auto_backtest_health_log',
  'auto_backtest_config'
);

-- Should return 3 rows

-- Check RLS is enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
AND tablename LIKE 'auto_backtest%';

-- All should show rowsecurity = true
```

### Step 3: Build and Deploy Frontend
```bash
# Build the project
npm run build

# Deploy to Netlify (automatic via build hook)
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
```

### Step 4: Wait for Deployment
- [ ] Wait for Netlify deployment to complete (~2-3 minutes)
- [ ] Check Netlify deploy logs for errors
- [ ] Verify deployment succeeded

## 🧪 Post-Deployment Testing

### Test 1: Access the Dashboard
- [ ] Navigate to AI Training & Backtesting Lab
- [ ] Verify new "Auto-Backtest" tab appears with "NEW" badge
- [ ] Click on Auto-Backtest tab
- [ ] Verify dashboard loads without errors

### Test 2: Start Auto-Backtest
- [ ] Click "Start Auto-Backtest" button
- [ ] Verify button changes to "Stop Auto-Backtest"
- [ ] Verify status shows "Running Auto-Backtests"
- [ ] Check browser console for logs (should see `[Auto-Backtest]` messages)
- [ ] Wait 2-3 minutes for first backtest to complete

### Test 3: Monitor Dashboard Updates
- [ ] Verify "Total Backtests Completed" increments after first backtest
- [ ] Verify "Current Cycle" shows 1/100
- [ ] Verify "System Stress" shows a percentage
- [ ] Verify status updates every 3 seconds

### Test 4: Check Session History
- [ ] Navigate to "Run New Backtest" tab
- [ ] Scroll to "Past Backtest Sessions"
- [ ] Verify new session appears with:
  - Session name starting with "Auto-BT-"
  - Green "AUTO" badge
  - Purple "SYNTHETIC" badge
  - Duration in days
  - Risk level badge
  - Number of pairs tested

### Test 5: Live Trade Pause/Resume
- [ ] Start a live demo trade (from Trade page)
- [ ] Return to Auto-Backtest dashboard
- [ ] Within 3-10 seconds, verify status changes to "Paused for Live Trade"
- [ ] Close the live demo trade
- [ ] Within 3-10 seconds, verify status changes back to "Running Auto-Backtests"

### Test 6: Stop Auto-Backtest
- [ ] Click "Stop Auto-Backtest" button
- [ ] Verify status changes to "Stopped"
- [ ] Verify button changes back to "Start Auto-Backtest"
- [ ] Check console logs for clean shutdown message

### Test 7: Database Verification
```sql
-- Check controller state
SELECT * FROM auto_backtest_controller
WHERE user_id = '<your_user_id>'
ORDER BY created_at DESC
LIMIT 1;

-- Should show is_active = false after stopping

-- Check health logs
SELECT * FROM auto_backtest_health_log
WHERE user_id = '<your_user_id>'
ORDER BY logged_at DESC
LIMIT 10;

-- Should show recent health metrics

-- Check config
SELECT * FROM auto_backtest_config
WHERE user_id = '<your_user_id>';

-- Should show default configuration
```

## 🐛 Troubleshooting

### Issue: "Start Auto-Backtest" button doesn't work
**Check:**
- Browser console for errors
- Network tab for failed requests
- User has admin permissions
- Database migration was applied

**Solution:**
- Refresh page
- Clear browser cache
- Check Supabase connection
- Verify admin status in `user_profiles` table

### Issue: Dashboard shows "No auto-backtest session active"
**Check:**
- Controller initialization succeeded
- Database permissions are correct
- No RLS policy blocking access

**Solution:**
- Check browser console for initialization errors
- Verify RLS policies allow user access
- Try stopping and restarting

### Issue: Status stuck on "Running" but no backtests completing
**Check:**
- Browser console for synthetic data generation errors
- Supabase logs for query errors
- Network connectivity

**Solution:**
- Stop and restart auto-backtest
- Check Supabase usage limits
- Verify synthetic data generation is working

### Issue: Constant cooldowns being triggered
**Check:**
- Database response times in health logs
- Supabase dashboard for performance issues
- Current database load

**Solution:**
- Adjust cooldown thresholds in `auto_backtest_config`
- Wait for Supabase load to decrease
- Consider upgrading Supabase plan if consistently overloaded

## 📊 Monitoring

### Key Metrics to Watch (First 24 Hours)
- **Total backtests completed**: Should reach 200-400
- **System stress average**: Should stay below 60%
- **Error rate**: Should be below 5%
- **Cooldown frequency**: 1-2 scheduled cooldowns (every 100 tests)
- **Live trade pauses**: Should correctly pause/resume

### Database Queries to Monitor Health
```sql
-- Total backtests by user
SELECT user_id, SUM(total_backtests_completed) as total
FROM auto_backtest_controller
GROUP BY user_id;

-- Recent health metrics
SELECT
  AVG(stress_score) as avg_stress,
  AVG(database_response_ms) as avg_db_time,
  AVG(error_rate_percent) as avg_error_rate
FROM auto_backtest_health_log
WHERE logged_at > NOW() - INTERVAL '1 hour';

-- Active controllers
SELECT user_id, status, total_backtests_completed, current_cycle_count
FROM auto_backtest_controller
WHERE is_active = true;
```

## 🎯 Success Criteria

### Immediate (First Hour)
- [x] Deployment completes without errors
- [ ] Dashboard loads correctly
- [ ] Can start/stop auto-backtest
- [ ] First backtest completes successfully
- [ ] Session history updates

### Short Term (First Day)
- [ ] 200+ backtests completed
- [ ] System stress remains manageable (< 70% average)
- [ ] Live trade pause/resume works correctly
- [ ] Cooldowns trigger and resume as expected
- [ ] No critical errors in logs

### Long Term (First Week)
- [ ] 1,500+ backtests completed
- [ ] AI skill progression increasing
- [ ] Pattern library growing
- [ ] No system failures or crashes
- [ ] Users reporting successful training

## 📝 Rollback Plan

### If Critical Issues Occur

#### Option 1: Disable Auto-Backtest (Soft Rollback)
```sql
-- Disable auto-backtest for all users
UPDATE auto_backtest_controller
SET is_active = false, status = 'stopped';
```
- Auto-backtest tab still visible but won't start
- No data loss
- Can re-enable after fixing issues

#### Option 2: Hide Tab (Medium Rollback)
- Revert changes to `src/pages/AITrainingPage.tsx`
- Remove "Auto-Backtest" tab
- Keep backend and database intact
- Can re-add tab after fixes

#### Option 3: Full Rollback
```sql
-- Drop tables (CAUTION: Data loss!)
DROP TABLE IF EXISTS auto_backtest_health_log;
DROP TABLE IF EXISTS auto_backtest_controller;
DROP TABLE IF EXISTS auto_backtest_config;
```
- Remove all auto-backtest code
- Delete database migration
- Restore previous version
- Last resort only

## 🎉 Launch Day Communication

### User Announcement Template
```
🚀 NEW FEATURE: Intelligent Auto-Backtest System

We're excited to announce the Auto-Backtest System - an autonomous AI training engine that runs continuous synthetic backtests to rapidly accelerate AI learning!

Key Features:
✅ Runs 100 backtests per cycle, then auto-cooldown for 15 min
✅ Automatically pauses during live trades
✅ Smart health monitoring and dynamic cooldowns
✅ Randomized test parameters for diverse learning
✅ Real-time dashboard with metrics and status

How to Use:
1. Navigate to AI Training & Backtesting Lab
2. Click the new "Auto-Backtest" tab
3. Click "Start Auto-Backtest"
4. Let it train your AI automatically!

Perfect for overnight training or when you're away from your desk. The system runs autonomously and protects itself from overload.

Try it out and watch your AI learn faster than ever! 🎓⚡
```

## ✅ Final Checklist

- [ ] Database migration applied successfully
- [ ] Build deployed to production
- [ ] Post-deployment tests completed
- [ ] First user successfully ran auto-backtest
- [ ] Monitoring dashboards configured
- [ ] Documentation accessible to users
- [ ] Support team briefed on new feature
- [ ] Rollback plan documented and ready

---

**When all items are checked, the Auto-Backtest System is officially live! 🎉**
