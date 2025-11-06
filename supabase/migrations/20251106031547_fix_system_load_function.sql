/*
  # Fix System Load Monitoring Function

  This migration ensures the record_system_load_snapshot function exists.
  The function is needed by the system-load-monitor service to track API usage.
*/

-- Function to record system load snapshot
CREATE OR REPLACE FUNCTION record_system_load_snapshot(
  p_cpu_credits_used integer,
  p_cpu_credits_limit integer,
  p_api_calls_count integer,
  p_active_pairs_count integer,
  p_error_count integer,
  p_request_queue_length integer,
  p_cache_hit_rate numeric,
  p_db_writes_per_minute integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_metric_id uuid;
  v_cpu_usage_percentage numeric;
  v_error_rate numeric;
  v_api_calls_per_second numeric;
BEGIN
  -- Calculate derived metrics
  v_cpu_usage_percentage := ROUND((p_cpu_credits_used::numeric / p_cpu_credits_limit::numeric) * 100, 2);
  v_error_rate := CASE
    WHEN p_api_calls_count > 0 THEN ROUND((p_error_count::numeric / p_api_calls_count::numeric) * 100, 2)
    ELSE 0
  END;
  v_api_calls_per_second := ROUND(p_api_calls_count::numeric / 60, 2);

  -- Insert metric record
  INSERT INTO system_load_metrics (
    cpu_credits_used,
    cpu_credits_limit,
    cpu_usage_percentage,
    api_calls_count,
    api_calls_per_second,
    active_pairs_count,
    error_count,
    error_rate,
    request_queue_length,
    cache_hit_rate,
    db_writes_per_minute
  ) VALUES (
    p_cpu_credits_used,
    p_cpu_credits_limit,
    v_cpu_usage_percentage,
    p_api_calls_count,
    v_api_calls_per_second,
    p_active_pairs_count,
    p_error_count,
    v_error_rate,
    p_request_queue_length,
    p_cache_hit_rate,
    p_db_writes_per_minute
  )
  RETURNING id INTO v_metric_id;

  -- Check for alert conditions
  PERFORM check_system_load_thresholds(v_metric_id);

  RETURN v_metric_id;
END;
$$;

-- Function to check thresholds and create alerts
CREATE OR REPLACE FUNCTION check_system_load_thresholds(p_metric_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_metric record;
  v_existing_alert record;
BEGIN
  -- Get the metric
  SELECT * INTO v_metric
  FROM system_load_metrics
  WHERE id = p_metric_id;

  -- Check CPU usage threshold (70%, 85%, 95%)
  IF v_metric.cpu_usage_percentage >= 70 THEN
    -- Check if there's already an active alert
    SELECT * INTO v_existing_alert
    FROM system_load_alerts
    WHERE alert_type = 'cpu_usage_high'
      AND NOT resolved
      AND created_at > now() - interval '15 minutes'
    ORDER BY created_at DESC
    LIMIT 1;

    -- Only create new alert if no recent unresolved alert exists
    IF v_existing_alert IS NULL THEN
      INSERT INTO system_load_alerts (
        alert_type,
        severity,
        threshold_value,
        actual_value,
        message,
        metadata
      ) VALUES (
        'cpu_usage_high',
        CASE
          WHEN v_metric.cpu_usage_percentage >= 95 THEN 'critical'
          WHEN v_metric.cpu_usage_percentage >= 85 THEN 'warning'
          ELSE 'info'
        END,
        CASE
          WHEN v_metric.cpu_usage_percentage >= 95 THEN 95
          WHEN v_metric.cpu_usage_percentage >= 85 THEN 85
          ELSE 70
        END,
        v_metric.cpu_usage_percentage,
        format('MetaAPI CPU usage at %s%% (threshold: %s%%)',
          v_metric.cpu_usage_percentage,
          CASE
            WHEN v_metric.cpu_usage_percentage >= 95 THEN '95'
            WHEN v_metric.cpu_usage_percentage >= 85 THEN '85'
            ELSE '70'
          END
        ),
        jsonb_build_object(
          'metric_id', p_metric_id,
          'cpu_credits_used', v_metric.cpu_credits_used,
          'cpu_credits_limit', v_metric.cpu_credits_limit,
          'api_calls_count', v_metric.api_calls_count,
          'active_pairs', v_metric.active_pairs_count
        )
      );
    END IF;
  END IF;

  -- Check error rate threshold (10%)
  IF v_metric.error_rate >= 10 THEN
    SELECT * INTO v_existing_alert
    FROM system_load_alerts
    WHERE alert_type = 'error_rate_high'
      AND NOT resolved
      AND created_at > now() - interval '15 minutes'
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_existing_alert IS NULL THEN
      INSERT INTO system_load_alerts (
        alert_type,
        severity,
        threshold_value,
        actual_value,
        message,
        metadata
      ) VALUES (
        'error_rate_high',
        'warning',
        10,
        v_metric.error_rate,
        format('High error rate detected: %s%% of API calls failing', v_metric.error_rate),
        jsonb_build_object(
          'metric_id', p_metric_id,
          'error_count', v_metric.error_count,
          'api_calls_count', v_metric.api_calls_count
        )
      );
    END IF;
  END IF;

  -- Auto-resolve alerts if conditions have improved
  UPDATE system_load_alerts
  SET resolved = true,
      resolved_at = now()
  WHERE alert_type = 'cpu_usage_high'
    AND NOT resolved
    AND v_metric.cpu_usage_percentage < 60;

  UPDATE system_load_alerts
  SET resolved = true,
      resolved_at = now()
  WHERE alert_type = 'error_rate_high'
    AND NOT resolved
    AND v_metric.error_rate < 5;
END;
$$;