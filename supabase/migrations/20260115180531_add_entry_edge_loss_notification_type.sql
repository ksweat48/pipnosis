/*
  # Add Entry Edge Loss Notification Type

  Updates the notification type constraint to include 'entry_edge_loss' for the new modal system.
*/

-- Add 'entry_edge_loss' to pending_user_modals modal_type constraint
DO $$
BEGIN
  -- Drop existing constraint
  ALTER TABLE pending_user_modals DROP CONSTRAINT IF EXISTS pending_user_modals_modal_type_check;
  
  -- Recreate with new type
  ALTER TABLE pending_user_modals ADD CONSTRAINT pending_user_modals_modal_type_check 
    CHECK (modal_type IN (
      'trade_closed', 
      'goal_achieved', 
      'session_update', 
      'continuation', 
      'session_ended',
      'entry_edge_loss'
    ));
END $$;
