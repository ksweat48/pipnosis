#!/bin/bash

# Emergency Price Feed - Get Live Ticks Flowing Immediately
# Run this script while you fix MetaAPI or switch to another provider

SUPABASE_URL="https://nzisgxdlydihlwsvonfy.supabase.co"
SUPABASE_SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56aXNneGRseWRpaGx3c3ZvbmZ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1OTU5NTU0MCwiZXhwIjoyMDc1MTcxNTQwfQ.Bas3dKkvMSzBPAK4zUJ24JC-T0-bcLQeJ458KYv-X5U"

# Base prices for realistic simulation
declare -A BASE_PRICES=(
  ["EURUSD"]="1.15500"
  ["GBPUSD"]="1.28500"
  ["USDJPY"]="153.900"
  ["XAUUSD"]="2650.00"
  ["US30"]="43500.0"
)

declare -A SPREADS=(
  ["EURUSD"]="0.00002"
  ["GBPUSD"]="0.00003"
  ["USDJPY"]="0.003"
  ["XAUUSD"]="0.50"
  ["US30"]="3.0"
)

echo "🚀 Emergency Price Feed Starting..."
echo "📊 Simulating live forex prices every 2 seconds"
echo "🔴 Press Ctrl+C to stop"
echo ""

COUNTER=0

while true; do
  COUNTER=$((COUNTER + 1))
  TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")

  for SYMBOL in "${!BASE_PRICES[@]}"; do
    BASE=${BASE_PRICES[$SYMBOL]}
    SPREAD=${SPREADS[$SYMBOL]}

    # Generate realistic price movement (±0.01%)
    RANDOM_FACTOR=$(awk -v seed=$RANDOM 'BEGIN { srand(seed); printf "%.10f", (rand() - 0.5) * 0.0001 }')

    # Calculate bid and ask
    BID=$(awk -v base="$BASE" -v factor="$RANDOM_FACTOR" -v spread="$SPREAD" \
      'BEGIN { printf "%.5f", base * (1 + factor) }')
    ASK=$(awk -v bid="$BID" -v spread="$SPREAD" \
      'BEGIN { printf "%.5f", bid + spread }')
    MID=$(awk -v bid="$BID" -v ask="$ASK" \
      'BEGIN { printf "%.5f", (bid + ask) / 2 }')

    # Insert into database
    RESPONSE=$(curl -s -X POST "${SUPABASE_URL}/rest/v1/realtime_prices" \
      -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56aXNneGRseWRpaGx3c3ZvbmZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk1OTU1NDAsImV4cCI6MjA3NTE3MTU0MH0.a4y7kDQ2ViWbAWi9VXdDX1y1Q4YtUaNM2F1VhWpM9Q0" \
      -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
      -H "Content-Type: application/json" \
      -H "Prefer: return=minimal" \
      -d "{
        \"symbol\": \"${SYMBOL}\",
        \"bid\": ${BID},
        \"ask\": ${ASK},
        \"mid\": ${MID},
        \"spread\": ${SPREAD},
        \"broker_time\": \"${TIMESTAMP}\",
        \"source\": \"emergency_feed\"
      }")

    if [ $? -eq 0 ]; then
      echo "✅ [$COUNTER] ${SYMBOL}: ${BID}/${ASK} @ ${TIMESTAMP}"
    else
      echo "❌ [$COUNTER] ${SYMBOL}: Failed to insert"
    fi
  done

  echo ""
  sleep 2
done
