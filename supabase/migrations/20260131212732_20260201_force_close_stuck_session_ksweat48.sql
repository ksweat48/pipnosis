/*
  # Force Close Stuck Session for ksweat48@gmail.com

  ## Summary
  User ksweat48@gmail.com has a stuck session in "scanning" state that won't close via normal UI mechanisms.
  Session closure is failing due to schema issues. This migration forcefully closes the session.

  ## Actions
  1. Mark goal session as 'user_stopped' with completed_at timestamp
  2. Verify the closure
*/

-- Force stop the stuck goal session
UPDATE public.goal_sessions
SET 
  status = 'user_stopped',
  completed_at = NOW(),
  updated_at = NOW()
WHERE id = 'e3982e21-c53d-403c-85c5-5f27fc118193'
  AND user_id = '91905a02-cf9e-4537-9920-98a4b790830a';

-- Verify closure
SELECT 
  'Session Force Closed Successfully' as result,
  'e3982e21-c53d-403c-85c5-5f27fc118193' as session_id,
  'ksweat48@gmail.com' as user_email,
  gs.status as final_status,
  gs.completed_at as closed_at
FROM goal_sessions gs
WHERE id = 'e3982e21-c53d-403c-85c5-5f27fc118193';
