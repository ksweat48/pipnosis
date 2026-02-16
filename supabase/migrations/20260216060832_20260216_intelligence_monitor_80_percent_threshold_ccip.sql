/*
  # CCIP: Real-Time Intelligence Monitor - 80% Threshold Filter
  
  ## Summary
  Updated Real-Time Intelligence Monitor UI to show only 80%+ confidence pairs as full cards.
  Pairs below 80% are now shown as a text summary: "(x pairs) heating up".
  
  ## Changes
  1. **Full Card Display Threshold**
     - Old: 70%+ confidence shown as full cards
     - New: 80%+ confidence shown as full cards
     
  2. **Heating Pairs Display**
     - Old: 50-70% pairs shown as full cards in "Heating Up" section
     - New: 50-80% pairs shown as text summary only
     - Format: "X pair(s) heating up - These setups are building momentum but not yet at 80%+ threshold"
  
  3. **Badge Updates**
     - "Ready to Trade" now shows "(80%+)" indicator
     - Setup count badge shows "X Setup(s) Ready (80%+)"
  
  ## Rationale
  - Reduces visual clutter by focusing on highest-probability setups
  - Maintains awareness of developing opportunities without full detail
  - Alpha monitors all pairs automatically regardless of display
  
  ## UI Component Modified
  - src/components/SessionIntelligenceMonitor.tsx
  
  ## Database Impact
  - No schema changes
  - No data changes
  - UI filter only - all data still calculated and stored
  
  ## Security
  - No RLS changes
  - No permissions changes
*/

INSERT INTO governance_change_log (entity_type, entity_id, operation, old_value, new_value, reason, metadata)
VALUES (
  'system_configuration',
  gen_random_uuid(),
  'configuration_update',
  '{"component": "session_intelligence_monitor", "threshold": "70%", "heating_display": "full_cards"}'::jsonb,
  '{"component": "session_intelligence_monitor", "threshold": "80%", "heating_display": "text_summary"}'::jsonb,
  'CCIP: Updated Real-Time Intelligence Monitor to only show 80%+ pairs as full cards. Below 80% shown as text summary to reduce clutter.',
  '{"ccip_tier": "ui_improvement", "affected_files": ["src/components/SessionIntelligenceMonitor.tsx"], "user_impact": "medium", "breaking_change": false}'::jsonb
);
