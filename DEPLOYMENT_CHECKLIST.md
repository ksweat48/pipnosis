# Deployment Checklist for Automated Refresh System

## Pre-Deployment

- [x] Database schema created (refresh_schedules, refresh_history tables)
- [x] RLS policies configured for security
- [x] Database functions created for schedule management
- [x] Default schedules inserted (EURUSD, GBPUSD, XAUUSD)
- [x] Refresh service implemented for serverless environment
- [x] Manual refresh function implemented with batch support
- [x] Scheduled daily refresh function created
- [x] Admin interface built and integrated
- [x] Build verified successfully

## Deployment Steps

### 1. Set Environment Variables in Netlify

Go to Netlify Dashboard > Site Settings > Environment Variables and add:

```
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_from_supabase
ADMIN_REFRESH_KEY=your_secure_random_key_here
```

**Getting the Service Role Key:**
1. Go to Supabase Dashboard
2. Click Settings > API
3. Copy the `service_role` key (NOT the anon key)
4. Keep this secret and never commit to git

**Creating a Secure Admin Key:**
```bash
# Generate a secure random key (Linux/Mac)
openssl rand -base64 32

# Or use any secure random string generator
```

### 2. Deploy to Netlify

Deploy using the build hook:

```bash
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
```

Or push to your connected repository.

### 3. Verify Deployment

After deployment, check:

**Functions Deployed:**
- [ ] `refresh-candles` function exists
- [ ] `scheduled-refresh` function exists
- [ ] Function timeout is 600 seconds (10 minutes)

**Scheduled Function Configuration:**
- [ ] Schedule is set to `0 2 * * *` (daily at 2 AM UTC)
- [ ] Function shows as "Scheduled" in Netlify dashboard

**Database Access:**
- [ ] Test query to refresh_schedules table succeeds
- [ ] Default schedules are visible
- [ ] Service role can insert into refresh_history

### 4. Test Manual Refresh

Test single refresh:

```bash
curl -X POST "https://your-app.netlify.app/.netlify/functions/refresh-candles?symbol=EURUSD&timeframe=5m&daysBack=3&adminKey=YOUR_ADMIN_KEY"
```

Expected response:
```json
{
  "status": "completed",
  "mode": "single",
  "candlesSaved": 864
}
```

Test batch refresh:

```bash
curl -X POST "https://your-app.netlify.app/.netlify/functions/refresh-candles?mode=batch&adminKey=YOUR_ADMIN_KEY"
```

Expected response:
```json
{
  "status": "completed",
  "mode": "batch",
  "successful": 9
}
```

### 5. Test Admin Interface

1. [ ] Log in as admin user
2. [ ] Navigate to Admin Dashboard
3. [ ] Click "Refresh Schedules" tab
4. [ ] Verify default schedules are visible
5. [ ] Test manual refresh button
6. [ ] Test adding a new schedule
7. [ ] Test enabling/disabling a schedule
8. [ ] Check refresh history updates

### 6. Verify Scheduled Execution

**Option A: Wait for scheduled run**
- Wait until 2:00 AM UTC next day
- Check function logs in Netlify
- Verify refresh_history table has new entries

**Option B: Manually trigger scheduled function**
```bash
curl -X POST "https://your-app.netlify.app/.netlify/functions/scheduled-refresh"
```

Check results in:
- Netlify function logs
- Admin interface refresh history
- Database refresh_history table

## Post-Deployment

### Monitor First 48 Hours

- [ ] Check function logs after first scheduled run
- [ ] Verify data is being saved to historical_candles table
- [ ] Monitor for any errors in refresh_history
- [ ] Check MetaApi usage/rate limits
- [ ] Verify all 9 default schedules complete successfully

### Performance Tuning

If you experience issues:

**Timeout Issues:**
- Reduce `days_back` for 5m timeframes
- Split large schedules into smaller chunks
- Consider running refreshes at different times

**Rate Limiting:**
- The system has built-in delays (500ms between chunks)
- If still hitting limits, disable some schedules
- Increase delays in refresh-service.ts if needed

**Memory Issues:**
- MetaApi SDK is large (~1.2MB)
- Consider code splitting if needed
- Current chunks are optimized for serverless

## Security Verification

- [ ] Service role key is NOT in client-side code
- [ ] Admin key is NOT committed to repository
- [ ] RLS policies prevent non-admins from managing schedules
- [ ] Only service role can write to refresh_history
- [ ] Function endpoints require admin authentication

## Rollback Plan

If issues occur:

1. Disable scheduled function in Netlify Dashboard
2. Disable all schedules in Admin Interface
3. Revert to previous deployment if needed
4. Check logs to identify root cause

## Success Criteria

System is working correctly when:

- [x] Build completes without errors
- [ ] Manual refresh saves candles to database
- [ ] Batch refresh processes all schedules
- [ ] Scheduled function runs daily at 2 AM UTC
- [ ] Admin interface shows schedules and history
- [ ] No errors in function logs
- [ ] historical_candles table is being populated
- [ ] Refresh history tracks all operations

## Support Resources

- **Function Logs:** Netlify Dashboard > Functions > [function name]
- **Database Logs:** Supabase Dashboard > Database > Logs
- **Admin Interface:** Your App > Admin Dashboard > Refresh Schedules
- **Documentation:** See REFRESH_SYSTEM_GUIDE.md

## Contact Information

For deployment issues:
1. Check Netlify function logs first
2. Review database migration status
3. Verify environment variables are set
4. Test MetaApi connection separately
