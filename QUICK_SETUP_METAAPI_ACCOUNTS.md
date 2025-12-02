# Quick Setup: MetaAPI Account Switch

## ⚡ What You Need to Do (5 Minutes)

### Step 1: Update Netlify (REQUIRED)

1. Go to: https://app.netlify.com/
2. Select your "pipnosis" site
3. Click "Site configuration" → "Environment variables"
4. Update these TWO variables:

```
METAAPI_ACCOUNT_ID = 28867898-bcc5-4a8d-969f-1acc6073eae2
METAAPI_ACCOUNT_ID_FALLBACK = 169ff8dd-bb46-4618-91b4-28f696fba223
```

5. Make sure "Production" scope is checked for both
6. Click "Save"

### Step 2: Update Supabase (Optional)

1. Go to: https://supabase.com/dashboard/project/_
2. Select your project
3. Click "Project Settings" → "Edge Functions"
4. Add the same TWO variables as above

### Step 3: Verify (After 5 Minutes)

Check logs show new account:
```
[PriceCollector] Using MetaAPI Account: 28867898...
```

Check health endpoint:
```bash
curl https://pipnosis.com/.netlify/functions/metaapi-health-check
```

Should show:
```json
{
  "currentActive": "primary",
  "primary": {
    "accountId": "28867898-bcc5-4a8d-969f-1acc6073eae2"
  }
}
```

---

## 📋 Your Accounts

**Primary (NEW LIVE)**
- ID: `28867898-bcc5-4a8d-969f-1acc6073eae2`
- Purpose: Main production account
- Region: london

**Fallback (OLD)**
- ID: `169ff8dd-bb46-4618-91b4-28f696fba223`
- Purpose: Backup if primary fails
- Region: london

---

## 🎯 How It Works

**Normal**: Uses PRIMARY account
**Primary Fails 2x**: Switches to FALLBACK
**Every 5 min**: Tests if PRIMARY recovered
**PRIMARY Works**: Switches back to PRIMARY

---

## 🔍 Monitor

**Health Check**:
https://pipnosis.com/.netlify/functions/metaapi-health-check

**Function Logs**:
Netlify Dashboard → Functions → continuous-price-collector → Logs

---

## ✅ Done!

After updating env vars, your system will:
- ✅ Use new primary account
- ✅ Fall back to old if needed
- ✅ Recover automatically
- ✅ Track both accounts

**Full docs**: See `METAAPI_ACCOUNT_MANAGEMENT.md`
