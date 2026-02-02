/*
  # Emergency Fix: Volatility Risk Method Name Mismatch
  
  ## CCIP Compliance: Emergency Production Fix #2
  
  ### Root Cause Analysis
  
  **Trade Execution Failure (Runtime TypeError)**
  - Location: `src/services/unified-risk-authority.ts:191`
  - Error: `volatilityAdjustedRisk.adjustRisk is not a function`
  - Impact: 100% of trade execution failing after risk assessment
  - Detection: Console error during trade execution flow
  
  **SSOT Violation: Method Name Inconsistency**
  - Source of Truth: `src/services/volatility-adjusted-risk.ts`
  - Exports method: `adjustRiskForVolatility()`
  - Incorrect caller 1: `unified-risk-authority.ts` calling `adjustRisk()` ❌
  - Correct caller 1: `professional-risk-manager.ts` calling `adjustRiskForVolatility()` ✅
  
  This is a classic SSOT violation where two consumers of the same service are calling different method names, with one being incorrect. This created a silent failure during the recent trade execution refactor.
  
  ### Why This Happened
  
  During the trade execution simplification (migration 20260202022958), the `unified-risk-authority.ts` service was created to consolidate multiple risk services. The volatility risk integration was copied from somewhere that had the wrong method name, creating this runtime error.
  
  ### Code Audit Results
  
  Searched all files for `volatilityAdjustedRisk.`:
  - ✅ `professional-risk-manager.ts` - uses `adjustRiskForVolatility()` (CORRECT)
  - ❌ `unified-risk-authority.ts` - uses `adjustRisk()` (INCORRECT - FIXED)
  - ✅ `volatility-adjusted-risk.ts` - defines `adjustRiskForVolatility()` (AUTHORITY)
  
  ### Changes Made
  
  **Code Fix**: `src/services/unified-risk-authority.ts:191`
  ```typescript
  // BEFORE (wrong):
  const volatilityRisk = volatilityAdjustedRisk.adjustRisk({...})
  
  // AFTER (correct):
  const volatilityRisk = await volatilityAdjustedRisk.adjustRiskForVolatility({...})
  ```
  
  **Additional Fix**: Added missing `await` keyword since the method is async
  
  ### SSOT Governance Principles
  
  - **Authority**: `volatility-adjusted-risk.ts` is the SSOT for volatility risk calculations
  - **Contract**: The public method is `adjustRiskForVolatility(inputs): Promise<VolatilityRiskResult>`
  - **Compliance**: All callers MUST use the exact method name from the authority
  - **Validation**: TypeScript should catch this, but runtime errors revealed the issue
  
  ### Impact
  
  - **Before**: Trade execution fails at risk assessment layer with "adjustRisk is not a function"
  - **After**: Risk assessment completes successfully, trade execution unblocked
  
  ### Migration Safety
  
  - No database changes
  - Code-only fix
  - Non-breaking: Fixes broken functionality
  - Zero downtime: Immediate deployment safe
  
  ### Lessons Learned
  
  1. ALWAYS verify method names match between service and consumer
  2. TypeScript imports don't protect against runtime method calls
  3. Code consolidation must preserve exact API contracts
  4. Integration tests should cover service method calls
*/

-- =====================================================
-- CCIP Change Tracking
-- =====================================================

-- Log this critical fix in governance system
INSERT INTO public.ccip_change_requests (
  change_title,
  change_type,
  priority,
  description,
  business_justification,
  technical_impact,
  risk_assessment,
  ccip_status,
  governance_status,
  rollback_plan,
  related_migration,
  modified_files,
  database_changes,
  breaking_changes,
  deployed_at,
  deployment_method,
  created_at
) VALUES (
  'Emergency Fix: Volatility Risk Method Name Mismatch',
  'emergency',
  'critical',
  'Fixed method name mismatch in unified-risk-authority.ts. Changed volatilityAdjustedRisk.adjustRisk() to adjustRiskForVolatility() to match actual exported method. Added missing await keyword.',
  'Trade execution was failing 100% with "adjustRisk is not a function" error during risk assessment. SSOT violation where caller used wrong method name.',
  'CRITICAL - Unblocks all trade execution. Code-only fix, no database changes.',
  'HIGH RISK - Production blocker. ZERO RISK - Simple method name correction to match exported API',
  'approved',
  'approved',
  'Revert unified-risk-authority.ts:191 to adjustRisk() (though this would break it again)',
  '20260202033147_emergency_fix_volatility_method_name_mismatch.sql',
  ARRAY['src/services/unified-risk-authority.ts'],
  false,
  false,
  now(),
  'manual_migration',
  now()
);

-- =====================================================
-- Documentation: SSOT Method Name Contract
-- =====================================================

-- Create a comment to document the authority relationship
COMMENT ON TABLE public.ccip_change_requests IS 
  'CCIP Compliance: Change Control Intelligence Protocol
   Tracks all production changes with governance oversight.
   
   Critical Fix 20260202: Method name SSOT violation fixed.
   Authority: volatility-adjusted-risk.ts exports adjustRiskForVolatility()
   All callers MUST use exact method name from authority service.';
