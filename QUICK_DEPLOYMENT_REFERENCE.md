# Quick Deployment Reference - Netlify Function Reliability Upgrade

## Pre-Deployment Checklist

- [x] All code changes committed
- [ ] Database migration applied to Supabase
- [ ] Environment variables verified in Netlify
- [ ] Build completed successfully locally

---

## 1. Apply Database Migration

**Supabase Dashboard Method:**

1. Go to https://supabase.com/dashboard/project/YOUR_PROJECT_ID
2. Navigate to SQL Editor
3. Copy contents of `/supabase/migrations/20251024_040000_add_function_monitoring_tables.sql`
4. Paste and run the migration
5. Verify tables created:
   ```sql
   \dt function_*
   ```

**Expected Tables:**
- `function_execution_logs`
- `function_health_metrics`

---

## 2. Verify Environment Variables

**Netlify Dashboard:**
1. Go to Site settings > Environment variables
2. Verify these exist:
   - ✅ `METAAPI_ADMIN_TOKEN`
   - ✅ `METAAPI_ACCOUNT_ID`
   - ✅ `METAAPI_REGION` (or defaults to 'new-york')
   - ✅ `SUPABASE_URL`
   - ✅ `SUPABASE_SERVICE_ROLE_KEY`

**Important:** Use `SUPABASE_SERVICE_ROLE_KEY` (not `SUPABASE_SERVICE_ROLE`)

---

## 3. Deploy to Netlify

**Using Your Build Hook:**
```bash
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
```

**Or via Git:**
```bash
git add .
git commit -m "Fix 500/502 errors and add function monitoring"
git push origin main
```

---

## 4. Post-Deployment Testing

### Test Token Generation (Should NOT return 500/502)
```bash
curl -X POST https://YOUR_SITE.netlify.app/.netlify/functions/get-metaapi-token
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "token": "...",
    "cached": false,
    "generationTimeMs": 1234
  },
  "timestamp": "2025-10-24T..."
}
```

**No More:**
- ❌ 500 Internal Server Error
- ❌ 502 Bad Gateway

### Test Account Verification
```bash
curl -X POST https://YOUR_SITE.netlify.app/.netlify/functions/verify-metaapi-account \
  -H "Content-Type: application/json" \
  -d '{"token":"YOUR_TOKEN","accountId":"YOUR_ACCOUNT_ID","region":"new-york"}'
```

### Test Full MetaAPI Suite
```bash
curl -X POST https://YOUR_SITE.netlify.app/.netlify/functions/test-metaapi-token \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## 5. Monitor Function Health

### Check Recent Executions
```sql
-- In Supabase SQL Editor
SELECT
  function_name,
  status_code,
  execution_time_ms,
  timestamp
FROM function_execution_logs
ORDER BY timestamp DESC
LIMIT 20;
```

### Check Error Rate
```sql
SELECT * FROM recent_function_errors
ORDER BY timestamp DESC;
```

### Check Success Rates
```sql
SELECT
  function_name,
  total_calls,
  success_count,
  failure_count,
  ROUND(100.0 * success_count / NULLIF(total_calls, 0), 2) as success_rate_percent,
  avg_response_time_ms
FROM function_health_summary
ORDER BY total_calls DESC;
```

---

## Troubleshooting

### Issue: Still getting 500/502 errors

**Check Netlify Function Logs:**
1. Netlify Dashboard > Functions tab
2. Click on `get-metaapi-token`
3. View recent logs
4. Look for error messages

**Common Causes:**
- Environment variables not set correctly
- MetaAPI service is down
- Region mismatch (check METAAPI_REGION)

**Fix:**
```bash
# Verify environment variables are set
netlify env:list

# Check function logs
netlify functions:log get-metaapi-token
```

### Issue: Database logging not working

**Check Supabase Connection:**
```sql
-- Verify tables exist
SELECT tablename FROM pg_tables
WHERE tablename LIKE 'function_%';

-- Check if logs are being written
SELECT COUNT(*) FROM function_execution_logs;
```

**Common Causes:**
- Migration not applied
- `SUPABASE_SERVICE_ROLE_KEY` not set
- RLS policies blocking service role

**Fix:**
1. Re-run the migration SQL
2. Double-check environment variable name
3. Verify service role in Supabase Dashboard > Settings > API

### Issue: Build failures

**Check Build Log:**
```bash
# If deploying via git
# Check Netlify dashboard > Deploys > [Latest deploy] > Deploy log

# If deploying locally
npm run build
```

**Common Causes:**
- Missing dependencies in `/netlify/functions/package.json`
- TypeScript compilation errors
- Import path issues

**Fix:**
```bash
# Reinstall dependencies
cd netlify/functions
npm install

# Rebuild project
cd ../..
npm run build
```

---

## Rollback Instructions

If you need to rollback:

### Via Netlify Dashboard
1. Go to Deploys tab
2. Find previous successful deploy
3. Click "Publish deploy"

### Via Git
```bash
git revert HEAD
git push origin main
```

**Note:** Database tables can remain (non-breaking change)

---

## Success Indicators

✅ **All Systems Operational:**
- get-metaapi-token returns 200 status
- Token caching works (check `cached: true` in responses)
- Function logs appear in Supabase `function_execution_logs`
- Health metrics update in `function_health_metrics`
- No 500/502 errors in Netlify function logs

---

## Quick Reference: Function Endpoints

- `POST /.netlify/functions/get-metaapi-token` - Generate MetaAPI token
- `POST /.netlify/functions/verify-metaapi-account` - Verify account access
- `POST /.netlify/functions/test-metaapi-token` - Test token generation flow
- `POST /.netlify/functions/analyze-market` - Trigger market analysis
- `POST /.netlify/functions/refresh-candles` - Manual data refresh
- `POST /.netlify/functions/scheduled-refresh` - Daily scheduled refresh

---

## Support

For issues or questions:
1. Check function execution logs in Supabase
2. Review Netlify function logs
3. Verify all environment variables are set
4. Check MetaAPI service status
5. Review the detailed implementation guide: `NETLIFY_FUNCTION_RELIABILITY_UPGRADE.md`
