# Quick Start: Fix Your OpenAI API Key (5 Minutes)

## Why This Happened
OpenAI detected your API key in public documentation files and disabled it for security. This is **good** - it protects you from unauthorized usage and billing.

---

## Fix It Now (5 Steps)

### Step 1: Get New API Key (1 min)
```
1. Visit: https://platform.openai.com/api-keys
2. Click "Create new secret key"
3. Name it: "Pipnosis Trading - Secure"
4. COPY THE KEY (you won't see it again!)
```

---

### Step 2: Add to Netlify (2 min)
```
1. Go to: https://app.netlify.com/
2. Select your site
3. Site settings → Environment variables
4. Click "Add a variable"

   Key:   OPENAI_API_KEY
   Value: [paste your new key]

5. Scopes: ✓ Production ✓ Branch deploys
6. Click "Create variable"
```

**IMPORTANT**: Use `OPENAI_API_KEY` (NOT `VITE_OPENAI_API_KEY`)

---

### Step 3: Update Local .env (30 sec)
```bash
# Edit .env file (line 20)
OPENAI_API_KEY=sk-proj-YOUR_NEW_KEY_HERE
```

**DO NOT** add `VITE_OPENAI_API_KEY` - this exposes keys to browser!

---

### Step 4: Deploy (1 min)
```bash
# Option 1: Auto-deploy via Git
git add .
git commit -m "Secure API key architecture"
git push

# Option 2: Manual trigger
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
```

---

### Step 5: Delete Old Key (30 sec)
```
1. Visit: https://platform.openai.com/api-keys
2. Find old compromised key
3. Click "Delete"
```

---

## Test It Works

1. Open your site
2. Try AI market analysis feature
3. Check browser console (no errors)
4. Verify in OpenAI dashboard (usage appears)

---

## What We Fixed

✅ **Removed exposed keys** from documentation
✅ **Created secure proxy** (keys stay on backend)
✅ **Refactored AI services** to use secure architecture
✅ **Updated .env.example** with security notices
✅ **Built production bundle** with fixes

---

## Security Improvements

**Before** (Insecure):
```typescript
// Frontend had direct access to API key
const key = import.meta.env.VITE_OPENAI_API_KEY; // EXPOSED
fetch('https://api.openai.com/...', {
  headers: { Authorization: `Bearer ${key}` }
});
```

**After** (Secure):
```typescript
// Frontend calls secure proxy function
import { openAIClient } from '@/services/openai-client';
await openAIClient.complete(prompt); // KEY PROTECTED
```

**New Architecture**:
```
Frontend → Netlify Function → OpenAI API
(no key)    (has key)
```

---

## Files Created

1. **netlify/functions/openai-chat.ts** - Secure proxy function
2. **src/services/openai-client.ts** - Centralized secure client
3. **OPENAI_API_KEY_SECURITY_FIX_COMPLETE.md** - Full documentation

---

## Need Help?

**See full guide**: `OPENAI_API_KEY_SECURITY_FIX_COMPLETE.md`

**Still stuck?**
1. Check Netlify Function logs
2. Check browser console for errors
3. Verify environment variable is set
4. Test new key in OpenAI playground

---

## Done! ✅

Your API key is now secure and will never be exposed again. The new architecture protects your keys while maintaining all AI functionality.
