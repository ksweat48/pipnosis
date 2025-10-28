/*
  # Clean Slate - Drop Old MetaAPI Tables
  
  Removes all complex MetaAPI-related tables to start fresh with a minimal implementation.
  
  ## Tables Being Dropped
  - metaapi_token_cache - Token caching system (too complex)
  - metaapi_connection_health - Connection monitoring (unnecessary)
  - metatap_token_cache - Duplicate token cache (typo in name)
  - connection_health_status - General health monitoring (over-engineered)
  
  ## Rationale
  Starting from scratch with a simple, working implementation.
  No caching layers, no health monitoring - just direct API calls.
*/

-- Drop old MetaAPI tables
DROP TABLE IF EXISTS metaapi_token_cache CASCADE;
DROP TABLE IF EXISTS metaapi_connection_health CASCADE;
DROP TABLE IF EXISTS metatap_token_cache CASCADE;
DROP TABLE IF EXISTS connection_health_status CASCADE;
