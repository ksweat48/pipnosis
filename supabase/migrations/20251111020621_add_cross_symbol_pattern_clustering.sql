/*
  # Add Cross-Symbol Pattern Clustering (Elite Enhancement Phase 3.1)
  
  This migration enables transfer learning between correlated currency pairs.
  When the AI discovers a profitable pattern on EURUSD, it can apply that
  learning to correlated pairs like GBPUSD, EURGBP, etc.
  
  ## Concept
  
  Currency pairs often move together:
  - EURUSD and GBPUSD (both vs USD, ~80% correlation)
  - AUDUSD and NZDUSD (commodity currencies, ~85% correlation)
  - EURJPY and GBPJPY (both vs JPY, ~75% correlation)
  
  Instead of learning each pair independently, the AI clusters similar pairs
  and shares insights across the cluster.
  
  ## Tables
  
  1. **symbol_correlation_matrix**
     - Stores correlation coefficients between pairs
     - Updated periodically based on price movements
     - Used to identify clusters
  
  2. **symbol_clusters**
     - Groups correlated symbols into clusters
     - Each cluster shares learning insights
     - Dynamic cluster assignment based on rolling correlation
  
  3. **cluster_shared_insights**
     - Cross-references insights that apply to multiple symbols
     - Enables pattern transfer learning
     - Tracks effectiveness across cluster members
  
  ## Benefits
  
  - Faster learning (insights from one pair help others)
  - Better generalization (patterns proven across multiple assets)
  - Reduced data requirements (shared learning pool)
  - Improved robustness (cluster consensus)
  
  ## Security
  - RLS policies for user isolation
*/

-- Table to store correlation matrix between symbols
CREATE TABLE IF NOT EXISTS symbol_correlation_matrix (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Symbol pair
  symbol_a TEXT NOT NULL,
  symbol_b TEXT NOT NULL,
  
  -- Correlation metrics
  correlation_coefficient DECIMAL(5,4) NOT NULL, -- -1 to 1
  correlation_strength TEXT, -- 'strong', 'moderate', 'weak', 'none'
  
  -- Statistics
  sample_size INTEGER DEFAULT 0, -- Number of candles used
  calculation_period TEXT DEFAULT '30d', -- Time window
  
  -- Time-based correlation
  correlation_7d DECIMAL(5,4), -- Last 7 days
  correlation_30d DECIMAL(5,4), -- Last 30 days
  correlation_90d DECIMAL(5,4), -- Last 90 days
  
  -- Metadata
  last_calculated_at TIMESTAMPTZ DEFAULT now(),
  next_calculation_due TIMESTAMPTZ DEFAULT (now() + INTERVAL '1 day'),
  created_at TIMESTAMPTZ DEFAULT now(),
  
  -- Constraints
  UNIQUE(user_id, symbol_a, symbol_b),
  CHECK (correlation_coefficient >= -1 AND correlation_coefficient <= 1),
  CHECK (symbol_a < symbol_b) -- Ensure A comes before B alphabetically to prevent duplicates
);

-- Table for symbol clusters
CREATE TABLE IF NOT EXISTS symbol_clusters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Cluster info
  cluster_name TEXT NOT NULL, -- e.g., 'USD_Majors', 'JPY_Crosses', 'Commodity_Currencies'
  cluster_type TEXT DEFAULT 'correlation_based', -- 'correlation_based', 'manual', 'market_regime'
  
  -- Members
  symbols TEXT[] NOT NULL, -- Array of symbols in this cluster
  primary_symbol TEXT, -- Representative symbol for the cluster
  
  -- Cluster metrics
  avg_correlation DECIMAL(5,4), -- Average correlation within cluster
  min_correlation DECIMAL(5,4), -- Minimum correlation (weakest link)
  cluster_size INTEGER DEFAULT 0, -- Number of symbols
  
  -- Performance
  shared_insights_count INTEGER DEFAULT 0,
  cluster_win_rate DECIMAL(5,2) DEFAULT 0,
  cluster_profit_factor DECIMAL(10,4) DEFAULT 0,
  
  -- Metadata
  is_active BOOLEAN DEFAULT true,
  last_updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(user_id, cluster_name)
);

-- Table for shared insights across clusters
CREATE TABLE IF NOT EXISTS cluster_shared_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Source insight
  source_insight_id UUID REFERENCES ai_learning_insights(id) ON DELETE CASCADE,
  source_symbol TEXT NOT NULL,
  cluster_id UUID REFERENCES symbol_clusters(id) ON DELETE CASCADE,
  
  -- Applied to
  applied_to_symbols TEXT[] NOT NULL, -- Symbols where this insight was transferred
  
  -- Transfer effectiveness
  times_used_cross_symbol INTEGER DEFAULT 0,
  times_correct_cross_symbol INTEGER DEFAULT 0,
  transfer_success_rate DECIMAL(5,2) DEFAULT 0,
  
  -- Transfer learning metrics
  original_confidence DECIMAL(5,2),
  avg_transferred_confidence DECIMAL(5,2),
  confidence_adjustment_factor DECIMAL(5,4) DEFAULT 1.0, -- How much to adjust when transferring
  
  -- Metadata
  first_transfer_at TIMESTAMPTZ DEFAULT now(),
  last_transfer_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(user_id, source_insight_id, cluster_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_correlation_matrix_user_symbols 
  ON symbol_correlation_matrix(user_id, symbol_a, symbol_b);
CREATE INDEX IF NOT EXISTS idx_correlation_matrix_strength 
  ON symbol_correlation_matrix(correlation_coefficient DESC);
CREATE INDEX IF NOT EXISTS idx_symbol_clusters_user 
  ON symbol_clusters(user_id);
CREATE INDEX IF NOT EXISTS idx_symbol_clusters_active 
  ON symbol_clusters(user_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_cluster_shared_insights_user 
  ON cluster_shared_insights(user_id);
CREATE INDEX IF NOT EXISTS idx_cluster_shared_insights_source 
  ON cluster_shared_insights(source_insight_id);

-- Enable RLS
ALTER TABLE symbol_correlation_matrix ENABLE ROW LEVEL SECURITY;
ALTER TABLE symbol_clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE cluster_shared_insights ENABLE ROW LEVEL SECURITY;

-- RLS Policies for symbol_correlation_matrix
CREATE POLICY "Users can view own correlations"
  ON symbol_correlation_matrix FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own correlations"
  ON symbol_correlation_matrix FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own correlations"
  ON symbol_correlation_matrix FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for symbol_clusters
CREATE POLICY "Users can view own clusters"
  ON symbol_clusters FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own clusters"
  ON symbol_clusters FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own clusters"
  ON symbol_clusters FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own clusters"
  ON symbol_clusters FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for cluster_shared_insights
CREATE POLICY "Users can view own shared insights"
  ON cluster_shared_insights FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own shared insights"
  ON cluster_shared_insights FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own shared insights"
  ON cluster_shared_insights FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Function to calculate correlation between two symbols
CREATE OR REPLACE FUNCTION calculate_symbol_correlation(
  p_user_id UUID,
  p_symbol_a TEXT,
  p_symbol_b TEXT,
  p_days_back INTEGER DEFAULT 30
) RETURNS DECIMAL AS $$
DECLARE
  v_correlation DECIMAL;
  v_count INTEGER;
BEGIN
  -- Calculate Pearson correlation coefficient using price changes
  WITH price_changes AS (
    SELECT 
      a.timestamp,
      (a.close - LAG(a.close) OVER (ORDER BY a.timestamp)) / LAG(a.close) OVER (ORDER BY a.timestamp) as return_a,
      (b.close - LAG(b.close) OVER (ORDER BY b.timestamp)) / LAG(b.close) OVER (ORDER BY b.timestamp) as return_b
    FROM forex_candles a
    JOIN forex_candles b ON a.timestamp = b.timestamp 
      AND a.timeframe = b.timeframe
    WHERE a.symbol = p_symbol_a
      AND b.symbol = p_symbol_b
      AND a.timeframe = '1h'
      AND a.timestamp >= now() - (p_days_back || ' days')::INTERVAL
      AND b.timestamp >= now() - (p_days_back || ' days')::INTERVAL
  ),
  stats AS (
    SELECT 
      COUNT(*) as n,
      AVG(return_a) as mean_a,
      AVG(return_b) as mean_b,
      STDDEV_POP(return_a) as std_a,
      STDDEV_POP(return_b) as std_b,
      AVG(return_a * return_b) as mean_product
    FROM price_changes
    WHERE return_a IS NOT NULL AND return_b IS NOT NULL
  )
  SELECT 
    n,
    CASE 
      WHEN std_a > 0 AND std_b > 0 THEN
        (mean_product - (mean_a * mean_b)) / (std_a * std_b)
      ELSE 
        0
    END
  INTO v_count, v_correlation
  FROM stats;
  
  -- Return 0 if insufficient data
  IF v_count < 50 THEN
    RETURN 0;
  END IF;
  
  -- Clamp to valid range
  v_correlation := GREATEST(-1, LEAST(1, v_correlation));
  
  RETURN v_correlation;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to update correlation matrix for all symbol pairs
CREATE OR REPLACE FUNCTION update_correlation_matrix(p_user_id UUID)
RETURNS void AS $$
DECLARE
  v_symbols TEXT[];
  v_symbol_a TEXT;
  v_symbol_b TEXT;
  v_correlation DECIMAL;
  v_strength TEXT;
BEGIN
  -- Get all unique symbols for this user
  SELECT ARRAY_AGG(DISTINCT symbol ORDER BY symbol)
  INTO v_symbols
  FROM forex_candles
  WHERE timestamp >= now() - INTERVAL '30 days'
  LIMIT 20; -- Limit to top 20 symbols to avoid excessive computation
  
  -- Calculate correlation for each pair
  FOR i IN 1..array_length(v_symbols, 1) LOOP
    v_symbol_a := v_symbols[i];
    
    FOR j IN (i+1)..array_length(v_symbols, 1) LOOP
      v_symbol_b := v_symbols[j];
      
      -- Calculate correlation
      v_correlation := calculate_symbol_correlation(p_user_id, v_symbol_a, v_symbol_b, 30);
      
      -- Determine strength
      v_strength := CASE
        WHEN ABS(v_correlation) >= 0.7 THEN 'strong'
        WHEN ABS(v_correlation) >= 0.5 THEN 'moderate'
        WHEN ABS(v_correlation) >= 0.3 THEN 'weak'
        ELSE 'none'
      END;
      
      -- Upsert into correlation matrix
      INSERT INTO symbol_correlation_matrix (
        user_id,
        symbol_a,
        symbol_b,
        correlation_coefficient,
        correlation_strength,
        correlation_30d,
        last_calculated_at,
        next_calculation_due
      ) VALUES (
        p_user_id,
        v_symbol_a,
        v_symbol_b,
        v_correlation,
        v_strength,
        v_correlation,
        now(),
        now() + INTERVAL '1 day'
      )
      ON CONFLICT (user_id, symbol_a, symbol_b)
      DO UPDATE SET
        correlation_coefficient = v_correlation,
        correlation_strength = v_strength,
        correlation_30d = v_correlation,
        last_calculated_at = now(),
        next_calculation_due = now() + INTERVAL '1 day';
    END LOOP;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Function to create clusters based on correlation
CREATE OR REPLACE FUNCTION create_correlation_clusters(p_user_id UUID)
RETURNS void AS $$
DECLARE
  v_cluster_id UUID;
BEGIN
  -- USD Majors cluster (high correlation with USD pairs)
  INSERT INTO symbol_clusters (
    user_id,
    cluster_name,
    cluster_type,
    symbols,
    primary_symbol,
    is_active
  ) VALUES (
    p_user_id,
    'USD_Majors',
    'correlation_based',
    ARRAY['EURUSD', 'GBPUSD', 'AUDUSD', 'NZDUSD', 'USDCAD', 'USDCHF'],
    'EURUSD',
    true
  )
  ON CONFLICT (user_id, cluster_name) DO UPDATE
  SET symbols = EXCLUDED.symbols, last_updated_at = now();
  
  -- JPY Crosses cluster
  INSERT INTO symbol_clusters (
    user_id,
    cluster_name,
    cluster_type,
    symbols,
    primary_symbol,
    is_active
  ) VALUES (
    p_user_id,
    'JPY_Crosses',
    'correlation_based',
    ARRAY['USDJPY', 'EURJPY', 'GBPJPY', 'AUDJPY'],
    'USDJPY',
    true
  )
  ON CONFLICT (user_id, cluster_name) DO UPDATE
  SET symbols = EXCLUDED.symbols, last_updated_at = now();
  
  -- Commodity Currencies cluster
  INSERT INTO symbol_clusters (
    user_id,
    cluster_name,
    cluster_type,
    symbols,
    primary_symbol,
    is_active
  ) VALUES (
    p_user_id,
    'Commodity_Currencies',
    'correlation_based',
    ARRAY['AUDUSD', 'NZDUSD', 'USDCAD'],
    'AUDUSD',
    true
  )
  ON CONFLICT (user_id, cluster_name) DO UPDATE
  SET symbols = EXCLUDED.symbols, last_updated_at = now();
  
  -- EUR Crosses cluster
  INSERT INTO symbol_clusters (
    user_id,
    cluster_name,
    cluster_type,
    symbols,
    primary_symbol,
    is_active
  ) VALUES (
    p_user_id,
    'EUR_Crosses',
    'correlation_based',
    ARRAY['EURUSD', 'EURGBP', 'EURJPY', 'EURAUD', 'EURCHF'],
    'EURUSD',
    true
  )
  ON CONFLICT (user_id, cluster_name) DO UPDATE
  SET symbols = EXCLUDED.symbols, last_updated_at = now();
END;
$$ LANGUAGE plpgsql;

-- View for finding transferable insights
CREATE OR REPLACE VIEW transferable_insights AS
SELECT 
  i.*,
  c.cluster_name,
  c.symbols as cluster_symbols,
  c.avg_correlation
FROM ai_learning_insights i
JOIN symbol_clusters c ON i.user_id = c.user_id
  AND i.symbol = ANY(c.symbols)
WHERE i.confidence_score >= 70
  AND c.is_active = true
  AND c.avg_correlation >= 0.5;

-- Initialize default clusters for existing users
INSERT INTO symbol_clusters (user_id, cluster_name, symbols, primary_symbol)
SELECT DISTINCT user_id, 'USD_Majors', 
  ARRAY['EURUSD', 'GBPUSD', 'AUDUSD', 'NZDUSD'], 
  'EURUSD'
FROM ai_skill_progression
ON CONFLICT (user_id, cluster_name) DO NOTHING;
