# Quick Token Test - TL;DR

## Test Your MetaAPI Token in 3 Steps

### Step 1: Navigate
Go to: `https://pipnosis.netlify.app/test-metaapi-direct`

### Step 2: Enter Token
1. ✅ Check "Use manual token input"
2. 📝 Paste your MetaAPI token
3. 🔒 Token is masked for security

### Step 3: Test
Click **"Test with Manual Token"** button

---

## Results

### 🟢 GREEN LIGHT
**Meaning:** Your token works!

**Next:** If environment test fails, fix Netlify environment variables

### 🔴 RED LIGHT
**Check:**
- Token is correct (no spaces)
- Account ID is correct
- Region matches your account
- Account is deployed in MetaAPI dashboard

---

## Get Your Token

1. Go to: https://app.metaapi.cloud/
2. Navigate: **Account → API Tokens**
3. Copy your token
4. Paste in test page

---

## Common Issues

| Error | Solution |
|-------|----------|
| "Token missing" | Enter token manually |
| "HTTP 401" | Token invalid/expired - get new one |
| "HTTP 404" | Wrong account ID or region |
| "Connection failed" | Try different region |

---

## Token Sources

The test checks 3 sources (in order):
1. **Manual Input** (highest priority)
2. `METAAPI_ADMIN_TOKEN` env var
3. `METAAPI_TOKEN` env var (legacy)

Results show which source was used.

---

## Security Notes

⚠️ Token is:
- Sent via HTTPS (encrypted)
- Never stored
- Never fully logged
- Cleared after test

⚠️ Don't share screenshots with visible tokens

---

## Process of Elimination

| Manual | Environment | Issue |
|--------|-------------|-------|
| 🟢 | 🔴 | Environment variables wrong |
| 🔴 | 🔴 | Token or MetaAPI setup wrong |
| 🟢 | 🟢 | Pipnosis code issue |

---

## After Successful Test

1. Update Netlify environment variable `METAAPI_ADMIN_TOKEN`
2. Trigger new deployment
3. Test with "Environment Variables" button
4. Should now be 🟢 GREEN

---

## Need More Details?

Read: `MANUAL_TOKEN_TEST_GUIDE.md`
