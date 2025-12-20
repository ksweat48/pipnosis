# MetaAPI Account Switch - COMPLETE ✅

**Date**: 2025-12-02
**Status**: ✅ Code Deployed - **AWAITING YOUR ENV VAR UPDATES**
**New Primary Account**: `28867898-bcc5-4a8d-969f-1acc6073eae2`
**Fallback Account**: `169ff8dd-bb46-4618-91b4-28f696fba223`

---

## 🎉 What Was Implemented

### ✅ Smart Fallback System
- **Automatic failover** when primary account fails (401/403/404/503/504 errors)
- **Smart recovery** - retries primary every 5 minutes when on fallback
- **Performance tracking** for both accounts
- **Zero downtime** - seamless switching

### ✅ Files Created
1. `src/services/metaapi-account-manager.ts` - Core account management logic
2. `netlify/functions/metaapi-health-check.ts` - Health monitoring endpoint
3. `METAAPI_ACCOUNT_MANAGEMENT.md` - Complete documentation
4. `METAAPI_ACCOUNT_SWITCH_COMPLETE.md` - This file

### ✅ Files Updated
1. `netlify/functions/continuous-price-collector.ts` - Uses account manager
2. `netlify/functions/fill-candle-gaps.ts` - Uses account manager
3. `netlify/functions/get-live-price.ts` - Uses account manager
4. `netlify/functions/verify-metaapi-account.ts` - Uses account manager
5. `.env` - Updated with new primary + fallback IDs
6. `.env.example` - Documented fallback configuration

### ✅ Deployed to Production
- Build completed successfully
- Deployed to Netlify via build hook
- All functions updated with fallback logic

---

## ⚠️ CRITICAL: What YOU Must Do Now

The code is deployed, but **your environment variables are not updated yet**. The system will continue using the old account until you update these:

### Step 1: Update Netlify Environment Variables (REQUIRED)

**Navigate to**: Netlify Dashboard → Your Site → Site Configuration → Environment Variables

**Add/Update these TWO variables:**

```
Variable name: METAAPI_ACCOUNT_ID
Value: 28867898-bcc5-4a8d-969f-1acc6073eae2
Scopes: All (✓ Production, ✓ Deploy previews, ✓ Branch deploys)
```

```
Variable name: METAAPI_ACCOUNT_ID_FALLBACK
Value: 169ff8dd-bb46-4618-91b4-28f696fba223
Scopes: All (✓ Production, ✓ Deploy previews, ✓ Branch deploys)
```

**How to do it:**
1. Go to https://app.netlify.com/
2. Select your "pipnosis" site
3. Click "Site configuration" in left menu
4. Click "Environment variables"
5. Find `METAAPI_ACCOUNT_ID` and click "Edit"
6. Change value to `28867898-bcc5-4a8d-969f-1acc6073eae2`
7. Click "Add a variable" button
8. Add `METAAPI_ACCOUNT_ID_FALLBACK` with value `169ff8dd-bb46-4618-91b4-28f696fba223`
9. Make sure both have "Production" scope checked
10. Click "Save"

### Step 2: Update Supabase Environment Variables (If Using Edge Functions)

**Navigate to**: Supabase Dashboard → Project Settings → Edge Functions

**Add the same two variables:**

```
METAAPI_ACCOUNT_ID = 28867898-bcc5-4a8d-969f-1acc6073eae2
METAAPI_ACCOUNT_ID_FALLBACK = 169ff8dd-bb46-4618-91b4-28f696fba223
```

### Step 3: Trigger Redeploy (Optional but Recommended)

After updating environment variables in Netlify:

**Option A: Wait (5-60 minutes)**
- Functions will pick up new values on next cold start
- This happens automatically

**Option B: Force Immediate Update (Recommended)**
- Go to Netlify Dashboard → Deploys
- Click "Trigger deploy" → "Clear cache and deploy site"
- Functions will restart with new values immediately

---

## 🔍 How to Verify It's Working

### Verification Step 1: Check Function Logs (After 5 Minutes)

**Navigate to**: Netlify Dashboard → Functions → continuous-price-collector → Logs

**Look for:**
```
[PriceCollector:exec_123] Using MetaAPI Account: 28867898...
```

✅ **If you see `28867898...`** → New primary account is active!
❌ **If you see `169ff8dd...`** → Still using old account (env vars not updated)

### Verification Step 2: Check Health Endpoint

**Open in browser or curl:**
```bash
curl https://pipnosis.com/.netlify/functions/metaapi-health-check
```

**Look for:**
```json
{
  "currentActive": "primary",
  "primary": {
    "accountId": "28867898-bcc5-4a8d-969f-1acc6073eae2",
    "status": "healthy"
  }
}
```

### Verification Step 3: Check Data is Still Flowing

1. Go to Admin Dashboard → Data Management
2. Check Server-Side Polling Monitor
3. Should show recent activity
4. Price data should be flowing normally

---

## 🚀 How the Fallback System Works

### Normal Operation
```
Every request → Uses PRIMARY (28867898-...) → Success ✅
```

### When Primary Fails
```
Request 1 → PRIMARY fails (401/403/404) → Mark as failed (count: 1)
Request 2 → PRIMARY fails again → Mark as failed (count: 2)
Request 3 → SWITCH TO FALLBACK (169ff8dd-...) → Use fallback ⚠️
```

### Recovery
```
5 minutes pass → Test PRIMARY → Success ✅ → SWITCH BACK TO PRIMARY
```

### Error Codes that Trigger Fallback
- **401** - Unauthorized (invalid credentials)
- **403** - Forbidden (no permissions)
- **404** - Not Found (account not deployed)
- **503** - Service Unavailable (MetaAPI down)
- **504** - Gateway Timeout (MetaAPI not responding)

### Error Codes that DON'T Trigger Fallback
- **429** - Rate Limit (temporary, retry same account)
- **500** - Server Error (may be transient)
- **Network Timeout** - Connection issue (retry same account)

---

## 📊 Monitoring

### Health Check Endpoint

**URL**: `https://pipnosis.com/.netlify/functions/metaapi-health-check`

**What it shows:**
- Which account is currently active (primary or fallback)
- Health status of both accounts
- Success/failure rates
- Last switch time
- Consecutive failure counts

### Manual Reset to Primary

If needed, you can force switch back to primary:

```bash
curl -X POST https://pipnosis.com/.netlify/functions/metaapi-health-check?action=reset
```

---

## 📝 Summary of Changes

### What Changed in Code
1. **Account Manager Service** - Central logic for account selection
2. **Netlify Functions** - All now use account manager instead of direct env vars
3. **Smart Fallback** - Automatic switching on specific error codes
4. **Health Monitoring** - Real-time status via HTTP endpoint
5. **Recovery Logic** - Automatic retry of primary every 5 minutes

### What Didn't Change
- MetaAPI token (same for both accounts)
- Region (london for both)
- Function schedules (still every 1 min and 5 min)
- Database schema
- UI/Frontend (for now)

### What's Deferred to Future
- UI dashboard component showing account status
- Integration into Admin Dashboard
- Email alerts on account switching
- Historical switching logs
- Supabase edge function updates (not critical)

---

## ⚡ Quick Start Checklist

After updating environment variables in Netlify:

- [ ] 1. Updated `METAAPI_ACCOUNT_ID` in Netlify Dashboard
- [ ] 2. Added `METAAPI_ACCOUNT_ID_FALLBACK` in Netlify Dashboard
- [ ] 3. (Optional) Updated same vars in Supabase Dashboard
- [ ] 4. (Optional) Triggered manual redeploy in Netlify
- [ ] 5. Waited 5 minutes for functions to run
- [ ] 6. Checked function logs show `28867898...`
- [ ] 7. Checked health endpoint shows `"currentActive": "primary"`
- [ ] 8. Verified data is still flowing
- [ ] 9. Tested browser close persistence (no gaps)
- [ ] 10. Bookmarked health endpoint for monitoring

---

## 🆘 Troubleshooting

### Problem: Logs still show old account ID

**Solution:**
1. Verify you updated env vars in **Netlify Dashboard** (not just .env file)
2. Check you're looking at **Production** environment variables
3. Trigger a redeploy: Netlify → Deploys → "Clear cache and deploy site"
4. Wait 5 minutes for functions to restart
5. Check logs again

### Problem: Health endpoint shows errors

**Solution:**
1. Verify new account is deployed in MetaAPI dashboard
2. Check account has proper permissions
3. Test account manually in MetaAPI dashboard
4. Review Netlify function logs for specific errors
5. Verify account ID is correct (no typos)

### Problem: Both accounts failing

**Solution:**
1. Check MetaAPI service status: https://status.metaapi.cloud/
2. Verify both accounts are deployed and active
3. Check MetaAPI token is valid
4. Review function logs for specific error codes
5. Contact MetaAPI support if service issues

---

## 📚 Documentation

Full documentation available in:
- **METAAPI_ACCOUNT_MANAGEMENT.md** - Complete system guide
- **PERSISTENCE_FIX_COMPLETE.md** - Server-side persistence guide
- **SERVER_SIDE_POLLING_DIAGNOSTIC.md** - Troubleshooting guide

---

## ✅ Final Status

### Code: COMPLETE ✅
- Account manager implemented
- Functions updated
- Health endpoint created
- Documentation complete
- Deployed to production

### Configuration: **AWAITING YOUR ACTION** ⚠️
- [ ] Netlify environment variables need updating (YOU must do this)
- [ ] Supabase environment variables need updating (Optional)

### Testing: PENDING ⏳
- After you update env vars:
  - Verify new account appears in logs
  - Check health endpoint shows primary active
  - Test persistence with browser close
  - Monitor for any errors

---

## 🎯 Success Criteria

You'll know it's working when:

1. ✅ Function logs show: `Using MetaAPI Account: 28867898...`
2. ✅ Health endpoint shows: `"currentActive": "primary"`
3. ✅ Health endpoint shows: `"accountId": "28867898-bcc5-4a8d-969f-1acc6073eae2"`
4. ✅ Data continues flowing (no interruptions)
5. ✅ Persistence works (data collected when browser closed)

---

## 🚨 Remember

**The fallback system is now active and will:**
- ✅ Try primary account first
- ✅ Fall back to old account if primary fails
- ✅ Retry primary every 5 minutes
- ✅ Switch back when primary recovers
- ✅ Track performance of both accounts

**But it won't use your new account until you:**
- ⚠️ Update environment variables in Netlify Dashboard
- ⚠️ (Optional) Update environment variables in Supabase Dashboard

**After updating env vars, the system will automatically:**
- 🔄 Start using new primary account
- 🔄 Keep old account as fallback
- 🔄 Monitor both accounts
- 🔄 Switch seamlessly if needed

---

## 📞 Next Steps

1. **NOW**: Update Netlify environment variables
2. **NOW**: Update Supabase environment variables (optional)
3. **5 MIN**: Check function logs for new account ID
4. **10 MIN**: Test health endpoint
5. **15 MIN**: Verify data is flowing
6. **20 MIN**: Test browser close persistence
7. **DAILY**: Monitor health endpoint
8. **WEEKLY**: Review logs for any switches

---

**🎉 Implementation Complete! Update your environment variables and you're all set!**
