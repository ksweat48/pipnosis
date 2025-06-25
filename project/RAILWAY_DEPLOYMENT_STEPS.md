# 🚀 Deploy Pipnosis Backend to Railway - Step by Step

## 🎯 STEP 1: Deploy to Railway

### 1. Go to Railway
- Visit [railway.app](https://railway.app)
- Click **"Login"** and sign in with GitHub

### 2. Create New Project
- Click **"New Project"** (big purple button)
- Select **"Deploy from GitHub repo"**
- Choose your **pipnosis repository** from the list

### 3. ⚠️ CRITICAL: Set Root Directory
**This is the most important step!**

After selecting your repo:
- Railway will show deployment settings
- Find **"Root Directory"** setting
- Set it to: `/server`
- This tells Railway your backend code is in the `/server` folder

### 4. Set Environment Variables
Click **"Variables"** tab and add these:

| Variable Name | Value | Where to Get It |
|---------------|-------|-----------------|
| `OPENAI_API_KEY` | `sk-proj-Bc...` | Your OpenAI API key |
| `SUPABASE_URL` | `https://xyz.supabase.co` | Supabase Dashboard → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGc...` | Supabase Dashboard → Settings → API |
| `NODE_ENV` | `production` | Type exactly: production |

### 5. Deploy
- Click **"Deploy"**
- Railway will automatically build and deploy
- Wait for deployment to complete (2-3 minutes)
- You'll get a URL like: `https://pipnosis-backend-production.up.railway.app`

## 🎯 STEP 2: Get Your Railway URL

After deployment completes:
1. Go to your Railway project dashboard
2. Click **"Settings"** tab
3. Find **"Domains"** section
4. Copy the generated URL (looks like: `https://xyz.up.railway.app`)

## 🎯 STEP 3: Test Your Backend

Visit these URLs to verify deployment:

**Health Check:**
```
https://YOUR-RAILWAY-URL.up.railway.app/api/health
```

**Market Data:**
```
https://YOUR-RAILWAY-URL.up.railway.app/api/market-data
```

Expected health response:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "version": "2.0.0",
  "services": {
    "supabase": "connected",
    "ai": "connected"
  }
}
```

## 🎯 STEP 4: Update Frontend (I'll do this for you)

Once you give me your Railway URL, I'll:
1. Update the API configuration
2. Push the changes to GitHub
3. Netlify will auto-deploy the updated frontend

## 🔧 Troubleshooting

### If deployment fails:
1. Check Railway logs (Deployments → View Logs)
2. Verify Root Directory is set to `/server`
3. Ensure all environment variables are set

### If backend starts but APIs fail:
1. Check environment variables are correct
2. Verify Supabase credentials
3. Check Railway logs for errors

## 📞 Next Steps

1. **Deploy to Railway** (follow steps above)
2. **Send me your Railway URL**
3. **I'll update the frontend configuration**
4. **Test the full system**

Your Railway URL will look like:
`https://pipnosis-backend-production.up.railway.app`

Once you have this URL, send it to me and I'll complete the frontend integration!