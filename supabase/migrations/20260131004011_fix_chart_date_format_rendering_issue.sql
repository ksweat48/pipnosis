/*
  # Fix Platform-Wide Mastery Chart Date Format Rendering

  1. Problem Analysis
    - Platform-Wide Pipnosis Evolution chart showed stats but no chart lines
    - Root cause: Date format mismatch between API and chart library
    - RPC returned dates as "2026-01-30" (string, date-only)
    - lightweight-charts library requires ISO datetime or Unix timestamp
    - Component passed raw date strings with `as any` type cast (code smell)
    - Chart silently failed to render lines (no error messages)

  2. SSOT Architecture Fix
    - Centralized date normalization in mastery-curve-service.ts
    - Added private normalizeDateForChart() method
    - Converts "YYYY-MM-DD" to "YYYY-MM-DDTHH:MM:SSZ" format
    - Applied to both RPC path (platform-wide) and table query path (user-specific)
    - Single authoritative conversion point ensures consistency

  3. Governance & CCIP Compliance
    - Data transformation fix (not business logic change)
    - No database changes required
    - Non-breaking change: date format is internal, not exposed to users
    - Backwards compatible: existing dates without time are converted on-the-fly
    - Deterministic: same input always produces same output

  4. Change Flow
    Service Layer (SSOT Authority)
      ├─ RPC path: get_platform_mastery_curve_data() → normalizeDateForChart()
      └─ Table path: fetchPerformanceEvolution() → mergeDataByDate() → normalizeDateForChart()
    Hook Layer
      └─ useM asteryCurve() passthrough (no transformation needed)
    Component Layer
      └─ PipnosisMasteryCurve: uses date directly as chart time value
         Result: { time: "2026-01-30T00:00:00Z", value: masteryScore } ✓

  5. Verification
    - Type safe: date field remains string type
    - Format safe: ISO 8601 compliant, UTC timezone
    - Chart compatible: lightweight-charts accepts ISO datetime strings
    - No data loss: time component set to 00:00:00 (start of day)

  6. Impact Assessment
    - Backend: No changes (RPC already returns correct structure)
    - Database: No schema changes
    - Frontend: Service layer normalization only
    - Users: Transparent - chart now renders correctly
    - Performance: Minimal overhead (string manipulation only)
*/

-- No database changes required for this governance fix
-- This is a frontend data transformation issue resolved in service layer
-- Migration serves as audit trail and documentation for CCIP compliance

DO $$
BEGIN
  INSERT INTO ccip_change_log (change_type, affected_systems, description, implemented_at)
  VALUES (
    'DATA_TRANSFORMATION_FIX',
    ARRAY['frontend', 'mastery-curve-service'],
    'Fixed chart date format: "YYYY-MM-DD" → "YYYY-MM-DDTHH:MM:SSZ" for lightweight-charts compatibility. Centralized normalization in service layer (SSOT). No breaking changes. Non-database fix.',
    NOW()
  );
EXCEPTION WHEN undefined_table THEN
  -- ccip_change_log table may not exist in all environments
  RAISE NOTICE 'CCIP change log not available, but fix documented in code comments';
END $$;
