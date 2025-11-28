/*
  # Realtime Diagnostics Helper Function
  
  Creates a helper function to check realtime configuration from the frontend.
*/

CREATE OR REPLACE FUNCTION check_realtime_config()
RETURNS TABLE (
  schema_name text,
  table_name text,
  replica_identity text,
  in_realtime_publication boolean
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 
    n.nspname::text as schema_name,
    c.relname::text as table_name,
    CASE c.relreplident
      WHEN 'd' THEN 'DEFAULT (primary key only)'
      WHEN 'n' THEN 'NOTHING (no replication)'
      WHEN 'f' THEN 'FULL (all columns) ✅'
      WHEN 'i' THEN 'INDEX'
      ELSE 'UNKNOWN'
    END::text as replica_identity,
    EXISTS(
      SELECT 1 FROM pg_publication_tables 
      WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'realtime_prices'
    ) as in_realtime_publication
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' 
  AND c.relname = 'realtime_prices';
$$;

GRANT EXECUTE ON FUNCTION check_realtime_config() TO authenticated;
