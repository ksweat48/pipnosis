/*
  # CCIP: Crypto LLM Weekend Bypass Governance

  ## Title
  Crypto Symbol Bypass for LLM Weekend Shutdown Gate

  ## Summary
  Fixes a critical bug where BTCUSD and ETHUSD (24/7 crypto markets) were blocked
  by the weekend shutdown gate in openai-client.ts, preventing all AI trade evaluation
  during forex market close even though crypto never closes.

  ## Problem
  The weekend protection service sets LLM_API_DISABLED=true at Friday market close.
  The isLLMDisabled() check in openai-client.ts was symbol-agnostic — it blocked
  ALL LLM calls regardless of whether the symbol is a 24/7 market.

  Result: Smart Goal sessions correctly filtered to crypto-only (BTCUSD, ETHUSD)
  during weekends, but then ALL those crypto evaluations failed with:
  "LLM APIs are disabled for weekend shutdown. Market reopens Sunday 5 PM EST."

  ## Changes (Frontend Code)

  ### src/services/openai-client.ts
  - Added `symbol?: string` to ChatCompletionOptions interface
  - Weekend shutdown gate now calls is24HourSymbol(options.symbol) when LLM_API_DISABLED
  - Crypto symbols bypass the gate; forex/indices remain blocked as intended

  ### src/brains/coordinator-alpha.ts
  - Passes `symbol: marketContext.symbol` to openAIClient.chat() options

  ### src/brains/midtrade-monitor.ts
  - Passes `symbol: snapshot.sym` to all 4 openAIClient.chat() call sites
  - (periodic_wellness, midtrade_soft, midtrade_hard, midtrade_emergency)

  ### src/services/llm-mid-trade-evaluator.ts
  - Passes `symbol: request.trade.symbol` to openAIClient.chat() options

  ### src/services/llm-strategy-brain.ts
  - Passes `symbol: snapshot.sym` to openAIClient.chat() options

  ## Security
  No RLS changes required — this is a frontend service layer fix only.

  ## SSOT Compliance
  - weekendProtectionService.isLLMDisabled() remains the single authority for the flag
  - is24HourSymbol() in utils/marketHours.ts remains the SSOT for 24/7 symbol classification
  - No duplication of crypto detection logic
*/

-- This migration is a governance audit record only.
-- All changes are in frontend TypeScript files, not database schema.
-- No SQL DDL required.

SELECT 1 AS ccip_crypto_llm_weekend_bypass_governance_recorded;
