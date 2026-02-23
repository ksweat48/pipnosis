/*
  # CCIP Governance Migration: Broker Ceiling (maxLotSize) Correction — All Instrument Categories

  ## Change Control Intelligence Protocol (CCIP) — Change Record

  ### Title
  Fix maxLotSize broker ceilings for forex, metal, crypto, and energy instruments to support
  account-balance-proportionate lot sizing via getScaledMaxLotSize.

  ### Problem Statement
  The `maxLotSize` field in symbol-registry.ts is a BROKER CEILING — upper bound passed to
  getScaledMaxLotSize() after the formula derives the account-proportionate value:

    derivedMax = (accountBalance × riskPct / 100) / (minReasonableStop × dollarPerPipPerLot)
    effectiveMax = Math.min(derivedMax, maxLotSize)

  Old ceilings were lower than derivedMax for mid-to-large accounts, making the ceiling
  — not the formula — the binding constraint. This silently capped trades.

  ### Math (design target: $500k account, 5% risk = $25,000 risk dollars)
  - Forex  (d/p/l=10, minStop=5):      $25k/$50   = 500  → old  5.0 → new 500.0
  - XAUUSD (d/p/l=1,  minStop=10):     $25k/$10   = 2500 → old 10.0 → new 500.0
  - BTCUSD (d/p/l=1,  minStop=50):     $25k/$50   = 500  → old 10.0 → new 500.0
  - ETHUSD (d/p/l=1,  minStop=50):     $25k/$50   = 500  → old 100  → new 500.0
  - USOIL/UKOIL (d/p/l=10, minStop=10): $25k/$100 = 250  → old 10.0 → new 250.0
  - Indices (d/p/l=100, minStop=10):    $25k/$1000 = 25  → 500.0 ✅ unchanged

  ### SSOT Authority
  getScaledMaxLotSize() in symbol-registry.ts is the sole authority for dynamic lot ceilings.

  ### Tables Modified
  - governance_change_log: INSERT 5 audit records (operation = 'configuration_update')
*/

DO $$
DECLARE
  v_admin_id uuid;
  v_batch_id uuid;
BEGIN
  SELECT id INTO v_admin_id FROM auth.users WHERE raw_app_meta_data->>'is_admin' = 'true' LIMIT 1;
  v_batch_id := gen_random_uuid();

  -- FOREX PAIRS (12 pairs)
  INSERT INTO governance_change_log (
    entity_type, entity_id, operation, old_value, new_value, reason, metadata, requester_id
  ) VALUES (
    'system_configuration', v_batch_id, 'configuration_update',
    jsonb_build_object('maxLotSize', 5.0, 'symbols', ARRAY['EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','NZDUSD','USDCHF','EURGBP','EURJPY','GBPJPY','AUDJPY','EURAUD'], 'category', 'forex'),
    jsonb_build_object('maxLotSize', 500.0, 'symbols', ARRAY['EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','NZDUSD','USDCHF','EURGBP','EURJPY','GBPJPY','AUDJPY','EURAUD'], 'category', 'forex'),
    'CCIP: Forex broker ceiling was binding constraint on accounts >$500 at 1% risk. derivedMax at $500k/5% = 500 lots. Raised from 5.0 to 500.0 so getScaledMaxLotSize formula controls sizing.',
    jsonb_build_object('ccip_batch_id', v_batch_id, 'change', 'broker_ceiling_correction', 'dollarPerPipPerLot', 10, 'minReasonableStop', 5, 'derivedMax_500k_5pct', 500.0, 'ssot_authority', 'getScaledMaxLotSize()'),
    v_admin_id
  );

  -- XAUUSD METAL
  INSERT INTO governance_change_log (
    entity_type, entity_id, operation, old_value, new_value, reason, metadata, requester_id
  ) VALUES (
    'system_configuration', v_batch_id, 'configuration_update',
    jsonb_build_object('maxLotSize', 10.0, 'symbol', 'XAUUSD', 'category', 'metal'),
    jsonb_build_object('maxLotSize', 500.0, 'symbol', 'XAUUSD', 'category', 'metal'),
    'CCIP: Gold broker ceiling was binding on accounts >$200 at 1% risk. Raised from 10.0 to 500.0.',
    jsonb_build_object('ccip_batch_id', v_batch_id, 'change', 'broker_ceiling_correction', 'dollarPerPipPerLot', 1.0, 'minReasonableStop', 10, 'derivedMax_500k_5pct', 2500.0),
    v_admin_id
  );

  -- BTCUSD CRYPTO
  INSERT INTO governance_change_log (
    entity_type, entity_id, operation, old_value, new_value, reason, metadata, requester_id
  ) VALUES (
    'system_configuration', v_batch_id, 'configuration_update',
    jsonb_build_object('maxLotSize', 10.0, 'symbol', 'BTCUSD', 'category', 'crypto'),
    jsonb_build_object('maxLotSize', 500.0, 'symbol', 'BTCUSD', 'category', 'crypto'),
    'CCIP: BTC broker ceiling was binding on accounts >$1000 at 1% risk. Raised from 10.0 to 500.0.',
    jsonb_build_object('ccip_batch_id', v_batch_id, 'change', 'broker_ceiling_correction', 'dollarPerPipPerLot', 1.0, 'minReasonableStop', 50, 'derivedMax_500k_5pct', 500.0),
    v_admin_id
  );

  -- ETHUSD CRYPTO
  INSERT INTO governance_change_log (
    entity_type, entity_id, operation, old_value, new_value, reason, metadata, requester_id
  ) VALUES (
    'system_configuration', v_batch_id, 'configuration_update',
    jsonb_build_object('maxLotSize', 100.0, 'symbol', 'ETHUSD', 'category', 'crypto'),
    jsonb_build_object('maxLotSize', 500.0, 'symbol', 'ETHUSD', 'category', 'crypto'),
    'CCIP: ETH broker ceiling would bind on accounts >$10k at 1% risk. Raised from 100.0 to 500.0.',
    jsonb_build_object('ccip_batch_id', v_batch_id, 'change', 'broker_ceiling_correction', 'dollarPerPipPerLot', 1.0, 'minReasonableStop', 50, 'derivedMax_500k_5pct', 500.0),
    v_admin_id
  );

  -- USOIL/UKOIL ENERGY
  INSERT INTO governance_change_log (
    entity_type, entity_id, operation, old_value, new_value, reason, metadata, requester_id
  ) VALUES (
    'system_configuration', v_batch_id, 'configuration_update',
    jsonb_build_object('maxLotSize', 10.0, 'symbols', ARRAY['USOIL','UKOIL'], 'category', 'energy'),
    jsonb_build_object('maxLotSize', 250.0, 'symbols', ARRAY['USOIL','UKOIL'], 'category', 'energy'),
    'CCIP: Energy broker ceiling was binding on accounts >$200 at 1% risk. derivedMax at $500k/5% = 250 lots. Raised from 10.0 to 250.0.',
    jsonb_build_object('ccip_batch_id', v_batch_id, 'change', 'broker_ceiling_correction', 'dollarPerPipPerLot', 10, 'minReasonableStop', 10, 'derivedMax_500k_5pct', 250.0),
    v_admin_id
  );

  RAISE NOTICE 'CCIP Broker Ceiling Migration complete. Batch: %', v_batch_id;
END $$;
