/*
  ═══════════════════════════════════════════════════════════════════════════
  CCIP EMERGENCY FIX - Restore cleanup_orphaned_intents function
  ═══════════════════════════════════════════════════════════════════════════

  The previous migration dropped this function with CASCADE.
  This migration restores it with the correct SECURITY DEFINER pattern.

  AUTHORITY: EntryIntentAuthority
  RESPONSIBILITY: Mark abandoned intents as expired_no_entry
  CCIP: Logged to governance_change_log
*/

-- Restore the cleanup_orphaned_intents function
CREATE OR REPLACE FUNCTION cleanup_orphaned_intents(
  p_session_id uuid,
  p_reason text DEFAULT 'unspecified_cleanup'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count_affected INTEGER := 0;
  v_affected_intents UUID[] := ARRAY[]::uuid[];
BEGIN
  -- AUTHORITY: EntryIntentAuthority
  -- RESPONSIBILITY: Mark abandoned intents as expired_no_entry
  -- CRITICAL: Uses correct enum value 'expired_no_entry' (NOT 'expired')

  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'p_session_id cannot be null',
      'affected_count', 0
    );
  END IF;

  -- Mark stale monitoring intents as expired_no_entry
  UPDATE entry_intents
  SET
    status = 'expired_no_entry',
    expired_reason = p_reason,
    updated_at = NOW()
  WHERE
    session_id = p_session_id
    AND status = 'monitoring'
    AND created_at < (NOW() - INTERVAL '5 minutes')
  RETURNING id INTO v_affected_intents;

  GET DIAGNOSTICS v_count_affected = ROW_COUNT;

  RAISE LOG '[cleanup_orphaned_intents] Session % affected: %, reason: %',
    p_session_id, v_count_affected, p_reason;

  RETURN jsonb_build_object(
    'success', TRUE,
    'affected_count', v_count_affected,
    'affected_ids', v_affected_intents,
    'reason', p_reason
  );

EXCEPTION WHEN OTHERS THEN
  RAISE LOG '[cleanup_orphaned_intents] Error: %', SQLERRM;
  RETURN jsonb_build_object(
    'success', FALSE,
    'error', SQLERRM,
    'affected_count', 0
  );
END $$;

DO $$
BEGIN
  INSERT INTO governance_change_log (
    entity_type,
    entity_id,
    operation,
    reason,
    metadata
  ) VALUES (
    'entry_intents',
    '00000000-0000-0000-0000-000000000000'::uuid,
    'field_update',
    'CCIP emergency fix - restored cleanup_orphaned_intents function',
    jsonb_build_object(
      'migration', '20260130_ccip_restore_cleanup_orphaned_intents_function',
      'reason', 'Previous migration dropped function, this restores it',
      'is_security_definer', true
    )
  );
  
  RAISE NOTICE '✅ cleanup_orphaned_intents function restored';
  RAISE NOTICE '✅ Governance audit logged';
END $$;
