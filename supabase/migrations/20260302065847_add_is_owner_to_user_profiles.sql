/*
  # Add is_owner flag to user_profiles

  ## Summary
  Adds an `is_owner` boolean column to `user_profiles` to distinguish
  platform owners from regular admins.

  ## Changes
  - `user_profiles`: new column `is_owner` (boolean, default false)
  - Sets `is_owner = true` for greenmorris.83@gmail.com and ksweat48@gmail.com

  ## Notes
  - No RLS changes required; is_owner is only surfaced through existing
    admin RPC functions which run as security definer.
*/

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS is_owner boolean NOT NULL DEFAULT false;

UPDATE user_profiles
SET is_owner = true
WHERE email IN ('greenmorris.83@gmail.com', 'ksweat48@gmail.com');
