/*
  # Add Feedback Notification Trigger

  ## Overview
  Creates a database trigger to automatically notify admins when new feedback is submitted.

  ## Changes
  1. Create function to call Edge Function for feedback notifications
  2. Add trigger on user_feedback INSERT to send notifications

  ## Security
  - Function runs with SECURITY DEFINER to access service role key
  - Only triggers on INSERT operations
  - Sends in-app notifications to admin users
*/

-- Function to notify admins of new feedback via Edge Function
CREATE OR REPLACE FUNCTION notify_admins_of_new_feedback()
RETURNS TRIGGER
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
  feedback_preview text;
  admin_record record;
BEGIN
  -- Create a preview of the message (first 200 characters)
  feedback_preview := substring(NEW.message from 1 for 200);
  IF length(NEW.message) > 200 THEN
    feedback_preview := feedback_preview || '...';
  END IF;

  -- Insert in-app notifications for all admin users
  FOR admin_record IN
    SELECT id, email
    FROM user_profiles
    WHERE is_admin = true
  LOOP
    INSERT INTO notifications (
      user_id,
      type,
      title,
      message,
      metadata,
      priority,
      is_read
    ) VALUES (
      admin_record.id,
      'feedback_new',
      'New ' || NEW.feedback_type || ' from ' || NEW.user_email,
      NEW.subject || E'\n\n' || feedback_preview,
      jsonb_build_object(
        'feedbackId', NEW.id,
        'userEmail', NEW.user_email,
        'feedbackType', NEW.feedback_type,
        'subject', NEW.subject
      ),
      'normal',
      false
    );
  END LOOP;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error but don't fail the insert
    RAISE WARNING 'Error in notify_admins_of_new_feedback: %', SQLERRM;
    RETURN NEW;
END;
$$;

-- Create trigger to notify admins when new feedback is submitted
DROP TRIGGER IF EXISTS trigger_notify_admins_on_new_feedback ON user_feedback;
CREATE TRIGGER trigger_notify_admins_on_new_feedback
  AFTER INSERT ON user_feedback
  FOR EACH ROW
  EXECUTE FUNCTION notify_admins_of_new_feedback();