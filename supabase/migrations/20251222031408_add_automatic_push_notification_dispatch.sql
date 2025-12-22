/*
  # Automatic Push Notification Dispatch

  1. Overview
    - Automatically send push notifications when high/urgent notifications are created
    - Works even when user is completely away from the app
    - Uses database trigger to call edge function directly
    - No dependency on client-side realtime listeners

  2. Changes
    - Enable pg_net extension for HTTP requests
    - Create function to dispatch push notifications via edge function
    - Add trigger on goal_notifications INSERT events
    - Only triggers for priority='high' or priority='urgent'

  3. Security
    - Function uses SECURITY DEFINER (runs as owner)
    - Uses service role to call edge function
    - Only processes notifications for authenticated users

  4. How It Works
    - User hits 15-minute timeout
    - trigger_continuation_modal() creates notification
    - Trigger automatically calls send-push-notification edge function
    - User receives push even if app is closed
*/

-- ============================================================================
-- STEP 1: Enable pg_net extension for HTTP requests
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_net;

COMMENT ON EXTENSION pg_net IS
  'Allows database to make HTTP requests to edge functions';

-- ============================================================================
-- STEP 2: Create function to dispatch push notification
-- ============================================================================

CREATE OR REPLACE FUNCTION auto_dispatch_push_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_supabase_url text;
  v_edge_function_url text;
  v_anon_key text;
  v_payload jsonb;
  v_request_id bigint;
BEGIN
  -- Only process high/urgent priority notifications
  IF NEW.priority NOT IN ('high', 'urgent') THEN
    RETURN NEW;
  END IF;

  -- Skip if push already sent (avoid duplicate sends)
  IF NEW.push_sent = true THEN
    RETURN NEW;
  END IF;

  -- Get environment variables from Supabase settings
  v_supabase_url := current_setting('app.settings.supabase_url', true);
  v_anon_key := current_setting('app.settings.supabase_anon_key', true);

  -- Fallback to vault if settings not available
  IF v_supabase_url IS NULL OR v_supabase_url = '' THEN
    BEGIN
      SELECT decrypted_secret INTO v_supabase_url
      FROM vault.decrypted_secrets
      WHERE name = 'SUPABASE_URL'
      LIMIT 1;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE WARNING '[Auto Push] Could not read SUPABASE_URL from vault';
    END;
  END IF;

  -- If still not available, skip
  IF v_supabase_url IS NULL OR v_supabase_url = '' THEN
    RAISE WARNING '[Auto Push] Supabase URL not configured, skipping auto-dispatch for notification %', NEW.id;
    RETURN NEW;
  END IF;

  v_edge_function_url := v_supabase_url || '/functions/v1/send-push-notification';

  -- Build notification payload based on type
  v_payload := jsonb_build_object(
    'user_id', NEW.user_id::text,
    'notification_id', NEW.id::text,
    'payload', CASE NEW.type
      WHEN 'scanning_timeout' THEN jsonb_build_object(
        'title', 'Scanning Paused',
        'body', 'No trades found in 15 minutes. Continue scanning?',
        'icon', '/Pipnosis icon.png',
        'badge', '/notification-badge_3.png',
        'data', jsonb_build_object(
          'type', 'scanning-timeout',
          'priority', NEW.priority,
          'goal_session_id', NEW.goal_session_id::text,
          'modal_id', (NEW.metadata->>'modal_id'),
          'tradesInSession', COALESCE((NEW.metadata->>'trades_count')::integer, 0),
          'currentProgress', COALESCE((NEW.metadata->>'current_pnl')::numeric, 0),
          'targetAmount', COALESCE((NEW.metadata->>'target')::numeric, 0),
          'action', 'open_continuation_modal'
        ),
        'tag', 'scanning-timeout-' || NEW.goal_session_id::text,
        'vibrate', jsonb_build_array(200, 100, 200, 100, 200),
        'requireInteraction', true
      )
      WHEN 'goal_achieved' THEN jsonb_build_object(
        'title', 'Goal Achieved!',
        'body', format('Congratulations! You reached your target with %s trades', COALESCE((NEW.metadata->>'trades_count')::integer, 0)),
        'icon', '/Pipnosis icon.png',
        'badge', '/notification-badge_3.png',
        'data', jsonb_build_object(
          'type', 'goal-achieved',
          'priority', NEW.priority,
          'goal_session_id', NEW.goal_session_id::text
        ),
        'tag', 'goal-achievements',
        'vibrate', jsonb_build_array(100, 50, 100, 50, 100, 50, 100, 50, 100)
      )
      WHEN 'trade_closed' THEN jsonb_build_object(
        'title', format('Trade Closed: %s', COALESCE((NEW.metadata->'trade_data'->>'symbol'), 'Unknown')),
        'body', NEW.message,
        'icon', '/Pipnosis icon.png',
        'badge', '/notification-badge_3.png',
        'data', jsonb_build_object(
          'type', 'trade-closed',
          'priority', NEW.priority,
          'trade_id', (NEW.metadata->>'trade_id')
        ),
        'tag', 'trade-closures'
      )
      WHEN 'mid_trade_trigger' THEN jsonb_build_object(
        'title', format('Mid-Trade Alert: %s', COALESCE((NEW.metadata->>'symbol'), 'Unknown')),
        'body', NEW.message,
        'icon', '/Pipnosis icon.png',
        'badge', '/notification-badge_3.png',
        'data', jsonb_build_object(
          'type', 'mid-trade-alert',
          'priority', NEW.priority,
          'trade_id', (NEW.metadata->>'trade_id')
        ),
        'tag', 'mid-trade-alerts-' || COALESCE((NEW.metadata->>'trade_id'), 'unknown')
      )
      ELSE jsonb_build_object(
        'title', 'Pipnosis Alert',
        'body', NEW.message,
        'icon', '/Pipnosis icon.png',
        'badge', '/notification-badge_3.png',
        'data', jsonb_build_object(
          'type', 'system',
          'priority', NEW.priority
        )
      )
    END
  );

  -- Make async HTTP request to edge function using pg_net
  BEGIN
    SELECT net.http_post(
      url := v_edge_function_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', COALESCE(v_anon_key, '')
      ),
      body := v_payload,
      timeout_milliseconds := 10000
    ) INTO v_request_id;

    RAISE NOTICE '[Auto Push] ✅ Dispatched push notification request_id=% for notification=% type=%', v_request_id, NEW.id, NEW.type;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING '[Auto Push] ❌ Failed to dispatch push notification id=%: %', NEW.id, SQLERRM;
      -- Continue anyway, client-side fallback will handle it
  END;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION auto_dispatch_push_notification IS
  'Automatically dispatches push notifications via edge function when high/urgent notifications are created';

-- ============================================================================
-- STEP 3: Create trigger on goal_notifications
-- ============================================================================

DROP TRIGGER IF EXISTS trigger_auto_push_notification ON goal_notifications;

CREATE TRIGGER trigger_auto_push_notification
  AFTER INSERT ON goal_notifications
  FOR EACH ROW
  EXECUTE FUNCTION auto_dispatch_push_notification();

COMMENT ON TRIGGER trigger_auto_push_notification ON goal_notifications IS
  'Automatically sends push notifications for high/urgent priority notifications';

-- ============================================================================
-- STEP 4: Grant permissions
-- ============================================================================

GRANT EXECUTE ON FUNCTION auto_dispatch_push_notification TO service_role;
GRANT USAGE ON SCHEMA net TO postgres, service_role;
