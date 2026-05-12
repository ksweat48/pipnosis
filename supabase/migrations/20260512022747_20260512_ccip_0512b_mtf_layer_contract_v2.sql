/*
  # CCIP-2026-0512B — MTF Layer Contract (amendment record)

  ## Summary
  Records the MTF Layer Contract as an engineering amendment. The active
  doctrine row remains CCIP-2026-0512A Raw-Data Doctrine. This row captures
  the specific fetch-pipeline and prompt-format contract that implements
  0512A for multi-timeframe data. Stored inactive so the single-active
  constraint is preserved; 0512A remains the SSOT.
*/

INSERT INTO alpha_engineering_doctrine (
  ccip_reference,
  ratified_at,
  doctrine_text,
  active,
  supersedes
)
SELECT
  'CCIP-2026-0512B-MTF-LAYER-CONTRACT',
  now(),
  $DOC$
CCIP-2026-0512B — MTF LAYER CONTRACT (amendment to CCIP-2026-0512A Raw-Data Doctrine)

Ratified 2026-05-12. Implements the specific MTF fetch-pipeline and
prompt-format obligations required by the active Raw-Data Doctrine row
(CCIP-2026-0512A). 0512A remains the SSOT active doctrine.

1. SINGLE FETCH AUTHORITY
   MarketDataService.getCandles is the sole authorized candle-fetch path
   for any code that feeds Alpha's prompt or the multi-timeframe pattern
   intelligence sensor. Legacy paths MUST NOT be invoked from
   prompt-building or Alpha-facing sensor code.

2. SSOT LOOKBACK WINDOWS
   MTF lookback windows live in src/config/timeframe-hierarchy.ts as
   MTF_LOOKBACK_WINDOWS, accessed via getMTFLookbackWindows(). No inline
   magic numbers for candle counts in prompt builders or sensors.
   MICRO_INTRADAY window: HTF=50, MTF=60, LTF=60.

3. LAYER SYMMETRY
   H1 (HTF), M15 (MTF), M5 (LTF), and D1 are all delivered as raw columnar
   OHLC tables (oldest→newest) plus raw numeric readings. No layer served
   exclusively as pre-computed verdicts or narrative interpretation.

4. PROMPT CONTENT
   All MTF blocks emit only raw readings: prices, pip distances, booleans,
   consecutive-candle counts, BOS/sweep flags. No DIRECTION RULE block, no
   tailwind/counter-trend framing, no MANDATORY procedural wrappers, no
   INSTITUTIONAL LEVEL RULES, no magnetic-pull or structurally-weak
   verdicts, no Expect-rejection narratives.

5. ENFORCEMENT
   Build-time audit scripts/audit-alpha-identity.cjs scans
   coordinator-alpha.ts and multi-timeframe-pattern-intelligence.ts for
   the forbidden tokens. Violations block the build.
  $DOC$,
  false,
  (SELECT id FROM alpha_engineering_doctrine WHERE ccip_reference = 'CCIP-2026-0512A' LIMIT 1)
WHERE NOT EXISTS (
  SELECT 1 FROM alpha_engineering_doctrine
  WHERE ccip_reference = 'CCIP-2026-0512B-MTF-LAYER-CONTRACT'
);