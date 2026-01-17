/*
  # Fix Entry Edge Loss Modal Type Constraint
  
  ## Problem
  The `valid_modal_type` constraint on `pending_user_modals` table does not include
  'entry_edge_loss' as a valid type, causing the `trigger_entry_edge_loss_modal` 
  function to fail silently.
  
  ## Changes
  1. Drop existing constraint
  2. Add new constraint with 'entry_edge_loss' included
  
  ## Impact
  - Enables the edge loss modal system to work correctly
  - No data loss - only modifying constraint
*/

-- Drop the existing constraint
ALTER TABLE pending_user_modals 
DROP CONSTRAINT IF EXISTS valid_modal_type;

-- Add the updated constraint with entry_edge_loss included
ALTER TABLE pending_user_modals 
ADD CONSTRAINT valid_modal_type CHECK (
  modal_type IN (
    'goal_achieved',
    'session_ended', 
    'trade_closed',
    'continuation',
    'entry_edge_loss',
    'mid_trade_alert',
    'system_notification'
  )
);
