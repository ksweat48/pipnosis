# Goal Feasibility Tracking Database Insert Fix

## Problem
Database insertion was failing with a NOT NULL constraint violation:
```
null value in column "adjusted_goal" of relation "goal_feasibility_tracking" violates not-null constraint
```

## Root Cause
The `goal_feasibility_tracking` insertion code in `goal-session-live-engine.ts` assumed the proposal object always had an `adjustedGoal` property. However, the proposal can be one of two types:

1. **DownshiftProposal** - Has `adjustedGoal`, `originalGoal`, `reasonsForDownshift` (array)
2. **ReducedGoalProposal** - Has `reducedGoal`, `reason` (string), but NO `adjustedGoal` or `originalGoal`

When a `ReducedGoalProposal` was received, the code tried to access `adjustedGoal` which didn't exist, resulting in `null` being inserted into the database.

## Solution
Modified the insertion code in `src/services/goal-session-live-engine.ts` (lines 1617-1684) to:

1. **Detect proposal type** using property existence checks
2. **Map properties correctly**:
   - For `DownshiftProposal`: Use `adjustedGoal` and `originalGoal` directly
   - For `ReducedGoalProposal`: Use `reducedGoal` as `adjustedGoal`, use `config.goalAmount` as `originalGoal`
3. **Handle reasons array**:
   - For `DownshiftProposal`: Use `reasonsForDownshift` array
   - For `ReducedGoalProposal`: Wrap single `reason` string in array
4. **Add proposal type to error logging** for better diagnostics

## Changes Made
- **File**: `src/services/goal-session-live-engine.ts`
- **Lines**: 1617-1684
- **Type**: Runtime type checking and property mapping

## Testing
- Build verification: PASSED
- Deployed to production via Netlify build hook

## Impact
- Fixes database insertion errors during goal feasibility tracking
- Maintains data integrity for both proposal types
- Improves error logging for future diagnostics
- No breaking changes to existing functionality

## SSOT Compliance
This fix maintains Single Source of Truth principles by:
- Not duplicating the proposal type definitions
- Using runtime type checking to handle union types correctly
- Preserving the original type system architecture
