# 🚀 Deploy Pipnosis Backend to Railway

## Step 1: Prepare Your Repository

First, make sure your code is pushed to GitHub with the correct structure:

```
your-repo/
├── server/           # Backend code
│   ├── package.json
│   ├── index.js
│   └── ...
├── src/             # Frontend code
├── package.json     # Root package.json
└── README.md
```

## Step 2: Deploy to Railway

### 1. Go to Railway
- Visit [railway.app](https://railway.app)
- Sign up/login with GitHub

### 2. Create New Project
- Click "New Project"
- Select "Deploy from GitHub repo"
- Choose your repository

### 3. Configure Root Directory
Since your backend is in `/server`, set:
```
Root Directory: /server
```

### 4. Set Environment Variables
Add these environment variables in Railway:

| Variable | Value |
|----------|-------|
| `OPENAI_API_KEY` | `sk-proj-Bc...` (your actual key) |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service role key |
| `PORT` | `3001` |
| `NODE_ENV` | `production` |

### 5. Deploy
Railway will automatically:
- Install dependencies (`npm install`)
- Start your server (`npm start`)
- Provide a live URL like `https://pipnosis-backend.up.railway.app`

## Step 3: Update Frontend Configuration

Once deployed, update your frontend to use the new backend URL.

## Step 4: Test Your Deployment

Test these endpoints:
- `https://your-app.up.railway.app/api/health`
- `https://your-app.up.railway.app/api/market-data`

## Step 5: Update Netlify Frontend

After Railway deployment, update your frontend environment variables and redeploy.

## Troubleshooting

### Common Issues:
1. **Build fails**: Check package.json in `/server` directory
2. **Environment variables**: Make sure all required vars are set
3. **CORS errors**: Railway should handle CORS automatically
4. **Port issues**: Railway automatically assigns PORT, but your app should use `process.env.PORT`

### Logs:
Check Railway logs for any deployment issues.