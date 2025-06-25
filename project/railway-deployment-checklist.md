# 🚀 Railway Deployment Checklist for Pipnosis

## ✅ STEP 1: Deploy Backend to Railway

### 1. Go to Railway
- Visit [railway.app](https://railway.app)
- Sign up/login with GitHub

### 2. Create New Project
- Click **"New Project"**
- Select **"Deploy from GitHub repo"**
- Choose your **pipnosis repository**

### 3. Configure Root Directory
**CRITICAL**: Set Root Directory to:
```
/server
```
This tells Railway where your backend code lives.

### 4. Set Environment Variables
Add these in Railway's environment section:

| Variable | Value | Notes |
|----------|-------|-------|
| `OPENAI_API_KEY` | `sk-proj-Bc...` | Your actual OpenAI key |
| `SUPABASE_URL` | `https://xyz.supabase.co` | From Supabase dashboard |
| `SUPABASE_SERVICE_ROLE_KEY` | `supabase_secret_key` | Service role key |
| `PORT` | `3001` | Railway will override this |
| `NODE_ENV` | `production` | Enables production mode |

### 5. Deploy & Get URL
Railway will give you a URL like:
```
https://pipnosis-backend-production.up.railway.app
```

## ✅ STEP 2: Update Frontend Configuration

Once you have your Railway URL, update the frontend:

### Update API Configuration
In `src/services/api.ts`, replace line 16:
```javascript
return 'https://YOUR-RAILWAY-URL.up.railway.app/api'; // Replace with actual URL
```

Example:
```javascript
return 'https://pipnosis-backend-production.up.railway.app/api';
```

## ✅ STEP 3: Test Backend Deployment

Visit these URLs to verify:
- `https://your-railway-url.up.railway.app/api/health`
- `https://your-railway-url.up.railway.app/api/market-data`

Expected response from health endpoint:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "version": "2.0.0",
  "services": {
    "supabase": "connected",
    "mt5": "disconnected",
    "ai": "connected"
  }
}
```

## ✅ STEP 4: Rebuild & Deploy Frontend

After updating the API URL:
```bash
npm run build
git add .
git commit -m "Update API URL for Railway backend"
git push origin main
```

Netlify will auto-deploy your updated frontend.

## ✅ STEP 5: Verify Full Connection

1. Visit `https://pipnosis.com`
2. Check "Backend Status" - should show "Backend Connected"
3. Try the AI prompt feature
4. Check market data loads properly

## 🔧 Troubleshooting

### Backend Issues:
- **Build fails**: Check Railway logs
- **Environment vars**: Verify all variables are set
- **CORS errors**: Should be handled automatically

### Frontend Issues:
- **Still shows offline**: Clear browser cache
- **API errors**: Check browser network tab
- **Wrong URL**: Verify API URL in code matches Railway URL

## 📋 Quick Commands

Update browserslist (optional):
```bash
npx update-browserslist-db@latest
```

Check Railway logs:
```bash
# In Railway dashboard, go to your project > Deployments > View Logs
```

Test API locally:
```bash
curl https://your-railway-url.up.railway.app/api/health
```