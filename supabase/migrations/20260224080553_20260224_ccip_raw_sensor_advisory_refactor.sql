/*
  # CCIP Governance: Raw Sensor Advisory Refactor (2026-02-24)

  ## Summary
  Records the CCIP-governed architectural refactor that stripped all pre-synthesized
  verdict labels from advisory services, enforcing that Alpha is the sole authority
  for interpreting raw measurements into trading decisions.

  ## Changes Recorded

  ### MicroRegimeClassifier (src/services/micro-regime-classifier.ts)
  - REMOVED: confidenceModifier, tradingAdjustment, behavioralExpectation, description
  - All 8 classifiers now return only: { regime, confidence, direction, indicators }

  ### AdversarialDetector (src/services/adversarial-detector.ts)
  - REMOVED: level, recommended_action, notes verdict fields
  - REMOVED: classifyLevel(), determineAction(), generateNotes() methods
  - ADDED: avg_candle_range (raw measurement), whipsaw_flip_count (raw count)

  ### Omega-7 MarketContextBrain (src/brains/omega7-market-context.ts)
  - ADDED: regime_snapshot as primary output field
  - DEPRECATED: sentiment, usd_strength, volatility, bias verdict fields

  ### SentimentAggregator (src/services/sentiment-aggregator.ts)
  - ADDED: regime_snapshot to AggregatedSentiment interface
  - DEPRECATED: sentiment, usd_strength, volatility, bias verdict fields

  ### AlphaIntelligenceAggregator (src/services/alpha-intelligence-aggregator.ts)
  - All pre-computed rates replaced with raw counts
  - All recommendation strings and boolean verdict fields removed

  ### coordinator-alpha.ts prompt builders
  - microRegimeContext: removed confidenceModifier, description, tradingAdjustment,
    behavioralExpectation; exposes only raw sensor readings
  - buildAdvisoryContext: replaced verdict labels with raw measurements
  - buildIntelligenceContext: replaced computed rates with raw counts

  ## CCIP Principle
  Alpha Final Authority: advisory services are sensors, not judges.
*/

INSERT INTO governance_change_log (
  id,
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  requester_id,
  metadata,
  created_at
)
VALUES (
  gen_random_uuid(),
  'alpha_coordinator',
  gen_random_uuid(),
  'ccip_migration_applied',
  jsonb_build_object(
    'pattern', 'pre_synthesized_verdicts_in_alpha_prompt',
    'fields_removed', ARRAY[
      'MicroRegimeClassification.confidenceModifier',
      'MicroRegimeClassification.tradingAdjustment',
      'MicroRegimeClassification.behavioralExpectation',
      'AdversarialSignal.level',
      'AdversarialSignal.recommended_action',
      'AdversarialSignal.notes',
      'decisionMetrics.winRate',
      'decisionMetrics.profitFactor',
      'tp1Learning.recommendation',
      'tp1Learning.closeEarlyWinRate',
      'tp1Learning.holdToTP2WinRate',
      'counterfactualInsights.earlyExitRecommended',
      'counterfactualInsights.holdLongerRecommended',
      'counterfactualInsights.topRecommendation',
      'metaInsights.actionableAdjustment',
      'overrideHistory.successRate'
    ]
  ),
  jsonb_build_object(
    'pattern', 'raw_sensor_observations_only',
    'fields_added', ARRAY[
      'AdversarialSignal.avg_candle_range',
      'AdversarialSignal.whipsaw_flip_count',
      'MarketContextOutput.regime_snapshot',
      'AggregatedSentiment.regime_snapshot',
      'overrideHistory.resolvedOverrides',
      'overrideHistory.successfulOverrides',
      'decisionMetrics.totalWins',
      'decisionMetrics.totalLosses',
      'decisionMetrics.totalProfitR',
      'decisionMetrics.totalLossR',
      'decisionMetrics.overrideResolved',
      'decisionMetrics.overrideSuccessful',
      'decisionMetrics.consensusResolved',
      'decisionMetrics.consensusSuccessful',
      'counterfactualInsights.earlyExitCount',
      'counterfactualInsights.holdLongerCount',
      'counterfactualInsights.totalSampled',
      'tp1Learning.closeEarlyWins',
      'tp1Learning.closeEarlyTotal',
      'tp1Learning.holdToTP2Wins',
      'tp1Learning.holdToTP2Total'
    ],
    'files_changed', ARRAY[
      'src/services/micro-regime-classifier.ts',
      'src/services/adversarial-detector.ts',
      'src/brains/omega7-market-context.ts',
      'src/services/sentiment-aggregator.ts',
      'src/services/alpha-intelligence-aggregator.ts',
      'src/brains/coordinator-alpha.ts'
    ],
    'ccip_date', '2026-02-24',
    'principle', 'Alpha Final Authority: advisory services are sensors, not judges',
    'ssot_compliance', true
  ),
  'CCIP 2026-02-24: Raw sensor advisory refactor. Alpha is the sole authority for interpreting raw measurements into trading decisions. Advisory services are sensors, not judges.',
  NULL,
  jsonb_build_object(
    'ccip_date', '2026-02-24',
    'principle', 'Alpha Final Authority',
    'ssot_compliance', true
  ),
  now()
);
