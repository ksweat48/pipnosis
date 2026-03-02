/*
  # CCIP SSOT Governance: Trade Close Modal & Audio Authority

  ## Change Control Intent (CCIP 2026-03-02)

  Documents the SSOT authority boundaries established for trade-close UI feedback
  (modal popup + audio) after a duplicate modal + duplicate sound + ReferenceError
  crash were found in production on every manual trade close.

  ## Bugs Fixed
  1. showGoalAchievedRef was referenced but never declared in GoalSessionDashboard
     → ReferenceError crash on every trade close
  2. GoalSessionDashboard AND RealtimeTradeNotificationListener both showed a modal
     → user saw 2 popups, ~3-5 seconds apart
  3. RealtimeTradeNotificationListener played audio before calling showDialog, AND
     useGlobalDialog played audio again when dialog rendered
     → user heard 2 sounds within 2 seconds

  ## SSOT Authority (post-fix)
  - Trade close modal: RealtimeTradeNotificationListener → globalDialogManager → useGlobalDialog
  - Audio on trade close: useGlobalDialog on dialog render (sole owner)
  - Session state reload: GoalSessionDashboard.loadSessionData() only

  ## Files Changed (frontend only)
  1. GoalSessionDashboard.tsx
     - Added showGoalAchievedRef = useRef(false) declaration
     - Removed setShowTradeClosedAction + audioAlertService from realtime handler
     - Handler now only calls loadSessionData()
  2. realtime-trade-notification-listener.ts
     - Removed audioAlertService calls for stop_loss_hit, take_profit_hit, trade_closed
*/

INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  metadata
)
VALUES (
  'system_configuration',
  gen_random_uuid(),
  'ccip_migration_applied',
  '{"issue": "duplicate modal + duplicate sound + showGoalAchievedRef crash on trade close", "violating_paths": ["GoalSessionDashboard.realtimeHandler", "RealtimeTradeNotificationListener pre-dialog audio"]}'::jsonb,
  '{"modal_authority": "RealtimeTradeNotificationListener→globalDialogManager→useGlobalDialog", "audio_authority": "useGlobalDialog render only", "session_reload": "GoalSessionDashboard.loadSessionData"}'::jsonb,
  'CCIP 2026-03-02 TRADE-CLOSE-MODAL-AUDIO-SSOT: Fixed 3 bugs on trade close — duplicate modal, duplicate sound, showGoalAchievedRef ReferenceError.',
  '{"ccip_ref": "20260302-trade-close-modal-audio-ssot", "bugs_fixed": ["duplicate_modal", "duplicate_sound", "showGoalAchievedRef_undefined"]}'::jsonb
);
