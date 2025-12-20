#!/bin/bash

# Test Netlify Scheduled Functions
# This script verifies that scheduled functions are deployed and working

echo "======================================"
echo "NETLIFY SCHEDULED FUNCTIONS TEST"
echo "======================================"
echo ""

SITE_URL="https://pipnosis.com"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "Testing Price Collector Function..."
echo "URL: $SITE_URL/.netlify/functions/continuous-price-collector"
echo ""

PRICE_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" "$SITE_URL/.netlify/functions/continuous-price-collector")
PRICE_HTTP_STATUS=$(echo "$PRICE_RESPONSE" | grep "HTTP_STATUS:" | cut -d: -f2)
PRICE_BODY=$(echo "$PRICE_RESPONSE" | sed -e 's/HTTP_STATUS:.*//g')

if [ "$PRICE_HTTP_STATUS" == "200" ]; then
    echo -e "${GREEN}✅ Price Collector: DEPLOYED${NC}"
    echo "Response:"
    echo "$PRICE_BODY" | jq '.' 2>/dev/null || echo "$PRICE_BODY"
else
    echo -e "${RED}❌ Price Collector: FAILED (HTTP $PRICE_HTTP_STATUS)${NC}"
    echo "Response: $PRICE_BODY"
fi

echo ""
echo "--------------------------------------"
echo ""

echo "Testing Candle Aggregator Function..."
echo "URL: $SITE_URL/.netlify/functions/continuous-candle-aggregator"
echo ""

CANDLE_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" "$SITE_URL/.netlify/functions/continuous-candle-aggregator")
CANDLE_HTTP_STATUS=$(echo "$CANDLE_RESPONSE" | grep "HTTP_STATUS:" | cut -d: -f2)
CANDLE_BODY=$(echo "$CANDLE_RESPONSE" | sed -e 's/HTTP_STATUS:.*//g')

if [ "$CANDLE_HTTP_STATUS" == "200" ]; then
    echo -e "${GREEN}✅ Candle Aggregator: DEPLOYED${NC}"
    echo "Response:"
    echo "$CANDLE_BODY" | jq '.' 2>/dev/null || echo "$CANDLE_BODY"
else
    echo -e "${RED}❌ Candle Aggregator: FAILED (HTTP $CANDLE_HTTP_STATUS)${NC}"
    echo "Response: $CANDLE_BODY"
fi

echo ""
echo "======================================"
echo "SUMMARY"
echo "======================================"

if [ "$PRICE_HTTP_STATUS" == "200" ] && [ "$CANDLE_HTTP_STATUS" == "200" ]; then
    echo -e "${GREEN}✅ Both functions are deployed and responding!${NC}"
    echo ""
    echo "Next step: Check if they're running automatically:"
    echo "1. Close your browser completely"
    echo "2. Wait 15 minutes"
    echo "3. Reopen and check if new candles appeared"
    echo ""
    echo "Or check Netlify Dashboard:"
    echo "- https://app.netlify.com → Functions → Check invocation counts"
else
    echo -e "${RED}❌ Functions are not working properly${NC}"
    echo ""
    echo "Troubleshooting steps:"
    echo "1. Check Netlify build logs for errors"
    echo "2. Verify environment variables are set in Netlify dashboard"
    echo "3. See NETLIFY_SCHEDULED_FUNCTIONS_FIX.md for detailed guide"
fi

echo ""
