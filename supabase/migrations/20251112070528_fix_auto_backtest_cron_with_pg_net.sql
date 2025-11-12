/*
  # Fix Auto-Backtest Cron Jobs to Use pg_net
  
  1. Problem Identified
    - The http extension cannot resolve the Supabase hostname from within the database
    - This causes "Could not resolve host" errors when cron jobs try to call Edge Functions
    
  2. Solution
    - Replace http extension calls with pg_net.http_post
    - pg_net is async and designed for Supabase's network environment
    - This allows database functions to call Edge Functions successfully
    
  3. Changes
    - Update invoke_auto_backtest_runner() to use pg_net
    - Update invoke_auto_backtest_executor() to use pg_net
    - Both functions now make async HTTP calls that work within Supabase
*/

-- Drop and recreate invoke_auto_backtest_runner with pg_net
CREATE OR REPLACE FUNCTION invoke_auto_backtest_runner()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  function_url text;
  service_key text;
  supabase_url text;
  request_id bigint;
BEGIN
  -- Get configuration from table
  SELECT value INTO supabase_url FROM public.edge_function_config WHERE key = 'supabase_url';
  SELECT value INTO service_key FROM public.edge_function_config WHERE key = 'service_role_key';
  
  IF supabase_url IS NULL OR service_key IS NULL THEN
    RAISE WARNING 'Supabase URL or service key not configured in edge_function_config table';
    RETURN;
  END IF;
  
  function_url := supabase_url || '/functions/v1/auto-backtest-runner';

  BEGIN
    -- Use pg_net for async HTTP requests (works with Supabase networking)
    SELECT INTO request_id net.http_post(
      url := function_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_key
      ),
      body := '{}'::jsonb
    );
    
    RAISE NOTICE 'Auto-backtest runner triggered (request_id: %)', request_id;
    
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Exception in auto-backtest runner: %', SQLERRM;
  END;
END;
$$;

-- Drop and recreate invoke_auto_backtest_executor with pg_net
CREATE OR REPLACE FUNCTION invoke_auto_backtest_executor()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  function_url text;
  service_key text;
  supabase_url text;
  request_id bigint;
BEGIN
  -- Get configuration from table
  SELECT value INTO supabase_url FROM public.edge_function_config WHERE key = 'supabase_url';
  SELECT value INTO service_key FROM public.edge_function_config WHERE key = 'service_role_key';
  
  IF supabase_url IS NULL OR service_key IS NULL THEN
    RAISE WARNING 'Supabase URL or service key not configured in edge_function_config table';
    RETURN;
  END IF;
  
  function_url := supabase_url || '/functions/v1/auto-backtest-executor';

  BEGIN
    -- Use pg_net for async HTTP requests (works with Supabase networking)
    SELECT INTO request_id net.http_post(
      url := function_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_key
      ),
      body := '{}'::jsonb
    );
    
    RAISE NOTICE 'Auto-backtest executor triggered (request_id: %)', request_id;
    
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Exception in auto-backtest executor: %', SQLERRM;
  END;
END;
$$;

COMMENT ON FUNCTION invoke_auto_backtest_runner() IS 'Triggers the auto-backtest-runner Edge Function using pg_net (async HTTP)';
COMMENT ON FUNCTION invoke_auto_backtest_executor() IS 'Triggers the auto-backtest-executor Edge Function using pg_net (async HTTP)';
