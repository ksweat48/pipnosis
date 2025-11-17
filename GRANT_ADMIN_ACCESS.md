# Grant Admin Access - Quick Guide

This guide explains how to grant admin access to users for the AI Training Lab page.

## Problem

The AI Training Lab page shows "Access Denied" because the current user doesn't have admin privileges.

## Solution

A migration has been created to automatically grant admin access and create user profiles.

### Option 1: Apply the Migration (Recommended)

The migration file is located at:
```
supabase/migrations/20251117000000_grant_admin_access_and_auto_profile.sql
```

This migration will:
1. Grant admin access to all existing users
2. Create missing user profiles for users without one
3. Set up automatic profile creation for new users
4. Create helper functions for admin checks

**To apply the migration:**

If you're using Supabase CLI:
```bash
supabase db push
```

Or apply it directly in the Supabase Dashboard:
1. Go to your Supabase project dashboard
2. Navigate to SQL Editor
3. Copy and paste the contents of the migration file
4. Run the query

### Option 2: Manual SQL Query

If you just need to grant admin to a specific user, run this in your Supabase SQL Editor:

```sql
-- Replace 'your-email@example.com' with the actual email
UPDATE user_profiles
SET is_admin = true
WHERE email = 'your-email@example.com';
```

Or grant admin to all users:

```sql
UPDATE user_profiles
SET is_admin = true;
```

### Option 3: Create Missing Profile

If a user doesn't have a profile at all, create one:

```sql
-- Replace the UUID and email with actual values
INSERT INTO user_profiles (id, email, is_admin, plan_type, account_balance)
VALUES (
  'user-uuid-here'::uuid,
  'user-email@example.com',
  true,
  'beta',
  10000.00
)
ON CONFLICT (id) DO UPDATE
SET is_admin = true;
```

## Automatic Profile Creation

The migration also sets up automatic profile creation for new users. Every time a new user signs up, a profile will be automatically created with:
- Admin access: `true` (for development)
- Plan type: `beta`
- Initial balance: $10,000

## Verification

After applying the migration:

1. Refresh the AI Training Lab page
2. Or click the "Retry Access Check" button
3. You should now have access to the page

Check the browser console for detailed logging:
- Look for `[AI Training]` messages
- Verify no errors are shown

## For Production

**Important:** For production environments, modify the migration to:

1. Set `is_admin = false` by default in the `handle_new_user()` function
2. Only grant admin to specific email addresses:

```sql
UPDATE user_profiles
SET is_admin = true
WHERE email IN (
  'admin1@example.com',
  'admin2@example.com'
);
```

## Troubleshooting

If you still see "Access Denied":

1. Check the browser console for error messages
2. Verify the user_profiles table exists in your database
3. Confirm the migration ran successfully
4. Try clicking "Retry Access Check" button
5. Log out and log back in

## Additional Features

The improved page now includes:
- Better error handling when profile doesn't exist
- Automatic profile creation on first access
- Retry button to recheck admin status
- Detailed console logging for debugging
- Helpful error messages with actionable guidance
