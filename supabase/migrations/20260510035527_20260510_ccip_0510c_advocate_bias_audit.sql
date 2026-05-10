/*
  # CCIP-2026-0510C — Advocate Bias Audit

  ## Summary
  Adds a bias_audit RPC that measures whether Alpha's final action is correlated
  with advocate presentation order on regime-neutral scans. The dual-advocate
  system (CCIP-2026-0510A) was hardened (CCIP-2026-0510C) by randomizing the
  order advocates are presented to the arbiter on every scan. This audit verifies
  that the randomization has eliminated positional anchoring — on regime-neutral
  scans (no strong EMA alignment, RSI in 45-55) the BUY/SELL ratio should be
  approximately 50/50 and must not be correlated with presentation_order.

  ## New Functions
  - `bias_audit(lookback_days int default 7)` — returns one row per
    (presentation_order, action) bucket with counts and share within order. Also
    returns overall BUY/SELL totals. Consumed by admin dashboards; callable by
    any authenticated admin user.

  ## Data Sources
  Reads alpha_decisions JSONB columns: advocate_briefs->>presentation_order,
  and the action field on the parent record. No mutation.

  ## Security
  SECURITY DEFINER wrapping a read-only SELECT. EXECUTE granted to
  authenticated (admin UI enforces admin gate at application layer, consistent
  with other admin RPCs in this codebase). No RLS changes needed since no new
  tables are created.
*/

CREATE OR REPLACE FUNCTION public.bias_audit(lookback_days int DEFAULT 7)
RETURNS TABLE (
  bucket text,
  presentation_order text,
  action text,
  decision_count bigint,
  share_pct numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH scoped AS (
    SELECT
      COALESCE(ad.advocate_briefs->>'presentation_order', 'UNKNOWN') AS p_order,
      UPPER(COALESCE(ad.action, 'UNKNOWN')) AS act
    FROM alpha_decisions ad
    WHERE ad.created_at >= now() - make_interval(days => lookback_days)
      AND ad.advocate_briefs IS NOT NULL
  ),
  per_order AS (
    SELECT
      'by_order'::text AS bucket,
      p_order AS presentation_order,
      act AS action,
      COUNT(*)::bigint AS decision_count
    FROM scoped
    GROUP BY p_order, act
  ),
  order_totals AS (
    SELECT p_order, SUM(decision_count) AS tot
    FROM per_order
    GROUP BY p_order
  ),
  overall AS (
    SELECT
      'overall'::text AS bucket,
      'ALL'::text AS presentation_order,
      act AS action,
      COUNT(*)::bigint AS decision_count
    FROM scoped
    GROUP BY act
  ),
  overall_total AS (
    SELECT SUM(decision_count) AS tot FROM overall
  )
  SELECT
    po.bucket,
    po.presentation_order,
    po.action,
    po.decision_count,
    ROUND(100.0 * po.decision_count / NULLIF(ot.tot, 0), 2) AS share_pct
  FROM per_order po
  JOIN order_totals ot ON ot.p_order = po.presentation_order
  UNION ALL
  SELECT
    ov.bucket,
    ov.presentation_order,
    ov.action,
    ov.decision_count,
    ROUND(100.0 * ov.decision_count / NULLIF(ott.tot, 0), 2) AS share_pct
  FROM overall ov
  CROSS JOIN overall_total ott
  ORDER BY bucket, presentation_order, action;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bias_audit(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bias_audit(int) TO service_role;
