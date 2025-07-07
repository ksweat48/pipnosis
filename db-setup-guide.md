# Pipnosis Database Setup Guide

This guide will help you set up the Supabase database for Pipnosis.

## 1. Check Your Environment Variables

First, make sure your `.env` file has the correct Supabase credentials:

```
VITE_SUPABASE_URL=https://elykntifkdaqiafnjosk.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVseWtudGlma2RhcWlhZm5qb3NrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA2NDgyMTMsImV4cCI6MjA2NjIyNDIxM30.itkXsNCqJMTr8r_nFk6u4PpRu2_wt8Q9iMkBSoxnmLU
SUPABASE_URL=https://elykntifkdaqiafnjosk.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVseWtudGlma2RhcWlhZm5qb3NrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MDY0ODIxNCwiZXhwIjoyMDY2MjI0MjE0fQ.lQvhBYkgGGkhPcFZHiJwH7p3GSkFDq2TXcj-8DqtNC8
```

## 2. Run the Database Migration

### Option 1: Using the Supabase Dashboard (Recommended)

1. Go to your [Supabase Dashboard](https://app.supabase.com)
2. Select your project
3. Go to the SQL Editor
4. Create a new query
5. Copy the contents of the latest migration file from `supabase/migrations/20250626070754_divine_marsh.sql`
6. Run the query

### Option 2: Using the Migration Runner Script

Run the migration script:

```bash
node run-database-migration.js
```

Follow the prompts to select which migration to run.

## 3. Verify the Migration

After running the migration, you should see the following tables in your Supabase dashboard:

- `user_profiles`
- `trading_prompts`
- `trade_records`
- `journal_entries`
- `trading_sessions`
- `waitlist`

## 4. Test the Connection

Run the database connection checker:

```bash
node check-db-connection.js
```

This will verify that your application can connect to the database and that the tables exist.

## 5. Restart the Development Server

After setting up the database, restart your development server:

```bash
npm run dev
```

## Troubleshooting

### "Demo Mode" Issue

If your application is still showing "Demo Mode" after setting up the database:

1. Check the browser console for errors
2. Make sure your `.env` file has the correct Supabase credentials
3. Verify that the migration ran successfully
4. Try clearing your browser cache and local storage
5. Restart the development server

### CORS Issues

If you're seeing CORS errors:

1. Make sure your Supabase project has the correct CORS settings
2. Go to Supabase Dashboard → Settings → API → CORS
3. Add `http://localhost:5173` to the allowed origins

### Authentication Issues

If you can't sign in:

1. Make sure you've enabled Email auth in Supabase
2. Go to Supabase Dashboard → Authentication → Providers
3. Enable Email provider
4. For local development, you can disable email confirmation

### Database Connection Issues

If you're still having issues connecting to the database:

1. Check if your IP is allowed in Supabase
2. Go to Supabase Dashboard → Settings → Database → Network Restrictions
3. Add your IP address to the allowed list