/*
  # CCIP Change Tracking: Fix goal_ai_conversations SSOT Violations

  ## Change Description
  This migration tracks the enforcement of SSOT (Single Source of Truth) for goal_ai_conversations table.

  ## Root Cause Analysis
  Multiple application services were directly inserting into goal_ai_conversations, bypassing RLS and RPC,
  causing 403 Forbidden errors and UUID validation errors.

  ## Violations Found
  1. `reward-engine.ts` line 61: Passing empty string '' instead of null for session_id
  2. `goal-session-manager.ts` line 402: Direct INSERT bypassing RPC
  3. `mid-trade-alert-executor.ts` lines 190, 247, 301: Direct INSERTs bypassing RPC

  ## Governance Actions
  - All writes MUST use SystemTableRPCWrapper.createGoalAIConversation()
  - Empty string UUIDs replaced with null for optional parameters
  - Direct INSERT operations removed from application code

  ## Compliance Status
  - SSOT: ✅ Enforced via RPC wrapper authority
  - CCIP: ✅ Tracked in governance_authority_registry
  - Migration: ✅ Documented in this migration

  ## Affected Services
  - src/services/reward-engine.ts
  - src/services/goal-session-manager.ts
  - src/services/mid-trade-alert-executor.ts
*/

-- Register the SSOT authority for goal_ai_conversations
INSERT INTO governance_authority_registry (
  authority_name,
  responsibility,
  owned_functions,
  owned_tables,
  description
) VALUES (
  'GoalAIConversationAuthority',
  'Single authority for all goal_ai_conversations writes. NO direct INSERTs allowed.',
  ARRAY['create_goal_ai_conversation'],
  ARRAY['goal_ai_conversations'],
  'SSOT ENFORCEMENT: All goal_ai_conversations writes MUST use create_goal_ai_conversation RPC. Direct INSERTs bypass RLS and fail with 403. Application code must call SystemTableRPCWrapper.createGoalAIConversation(). CCIP Date: 2026-01-30, Protocol: v1'
)
ON CONFLICT (authority_name) DO UPDATE SET
  responsibility = EXCLUDED.responsibility,
  owned_functions = EXCLUDED.owned_functions,
  owned_tables = EXCLUDED.owned_tables,
  description = EXCLUDED.description,
  updated_at = NOW();

-- Add comment documenting the SSOT authority
COMMENT ON TABLE goal_ai_conversations IS
'SSOT AUTHORITY: SystemTableRPCWrapper.createGoalAIConversation()
All writes MUST use the RPC function create_goal_ai_conversation.
Direct INSERTs are FORBIDDEN and will fail due to RLS policies.
CCIP Date: 2026-01-30
CCIP Protocol: v1 - SSOT Enforcement';
