#!/bin/bash

# Quick Start: XAUUSD M5 Backfill
# This script triggers a 14-day historical backfill for XAUUSD M5

echo "🚀 Starting XAUUSD M5 Backfill (14 days)..."
echo ""

# Your Netlify domain (update this!)
NETLIFY_DOMAIN="your-app-name.netlify.app"

# If you're testing locally with netlify dev, use this instead:
# NETLIFY_URL="http://localhost:8888/.netlify/functions/historical-backfill"

NETLIFY_URL="https://${NETLIFY_DOMAIN}/.netlify/functions/historical-backfill"

echo "📍 Endpoint: ${NETLIFY_URL}"
echo ""

# Trigger the backfill
curl -X POST "${NETLIFY_URL}" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "XAUUSD",
    "timeframe": "M5",
    "daysBack": 14,
    "dryRun": false
  }' | jq .

echo ""
echo "✅ Backfill request sent!"
echo ""
echo "Check your chart - you should see 14 days of XAUUSD M5 data with full OHLC wicks!"
