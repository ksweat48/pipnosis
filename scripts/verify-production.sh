#!/bin/bash

echo "🔍 Verifying Production Deployment for Live Ticks"
echo "=================================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Production URL
PROD_URL="https://pipnosis.com"

echo "📡 Testing Function Endpoints..."
echo ""

# Test verify-metaapi-connection
echo "1. Testing verify-metaapi-connection..."
VERIFY_RESPONSE=$(curl -s -w "\n%{http_code}" "${PROD_URL}/.netlify/functions/verify-metaapi-connection")
VERIFY_STATUS=$(echo "$VERIFY_RESPONSE" | tail -n1)
VERIFY_BODY=$(echo "$VERIFY_RESPONSE" | head -n-1)

if [ "$VERIFY_STATUS" = "200" ]; then
    if echo "$VERIFY_BODY" | grep -q "<!DOCTYPE" || echo "$VERIFY_BODY" | grep -q "<html"; then
        echo -e "${RED}   ✗ FAILED - Function returned HTML (not deployed)${NC}"
        echo "   Response: $(echo "$VERIFY_BODY" | head -c 100)..."
    else
        echo -e "${GREEN}   ✓ Function endpoint accessible${NC}"
        echo "$VERIFY_BODY" | head -c 200
    fi
else
    echo -e "${RED}   ✗ HTTP Status: $VERIFY_STATUS${NC}"
fi
echo ""

# Test get-live-price
echo "2. Testing get-live-price for EURUSD..."
PRICE_RESPONSE=$(curl -s -w "\n%{http_code}" "${PROD_URL}/.netlify/functions/get-live-price?symbol=EURUSD")
PRICE_STATUS=$(echo "$PRICE_RESPONSE" | tail -n1)
PRICE_BODY=$(echo "$PRICE_RESPONSE" | head -n-1)

if [ "$PRICE_STATUS" = "200" ]; then
    if echo "$PRICE_BODY" | grep -q "<!DOCTYPE" || echo "$PRICE_BODY" | grep -q "<html"; then
        echo -e "${RED}   ✗ FAILED - Function returned HTML (not deployed)${NC}"
        echo "   Response: $(echo "$PRICE_BODY" | head -c 100)..."
    else
        if echo "$PRICE_BODY" | grep -q "\"bid\"" && echo "$PRICE_BODY" | grep -q "\"ask\""; then
            echo -e "${GREEN}   ✓ Live price endpoint working${NC}"
            echo "$PRICE_BODY" | head -c 200
        else
            echo -e "${YELLOW}   ⚠ Function accessible but no price data${NC}"
            echo "$PRICE_BODY"
        fi
    fi
else
    echo -e "${RED}   ✗ HTTP Status: $PRICE_STATUS${NC}"
fi
echo ""

echo "📊 Summary"
echo "=========="
if [ "$VERIFY_STATUS" = "200" ] && [ "$PRICE_STATUS" = "200" ]; then
    if echo "$VERIFY_BODY" | grep -q "<!DOCTYPE" || echo "$PRICE_BODY" | grep -q "<!DOCTYPE"; then
        echo -e "${RED}Functions are returning HTML - Not properly deployed${NC}"
        echo ""
        echo "Next Steps:"
        echo "1. Check Netlify build logs for function bundling errors"
        echo "2. Verify functions appear in Netlify dashboard"
        echo "3. Ensure netlify.toml is configured correctly"
        echo "4. Wait for deployment to complete (check Netlify dashboard)"
    else
        echo -e "${GREEN}✓ All function endpoints are accessible and returning JSON${NC}"
        echo ""
        echo "Next Steps:"
        echo "1. Open ${PROD_URL}/trade in your browser"
        echo "2. Open DevTools Console (F12)"
        echo "3. Look for '✅ Global polling coordinator initialized'"
        echo "4. Verify 'Live Price Updates Active' indicator on chart"
        echo "5. Check Supabase realtime_prices table for new rows"
    fi
else
    echo -e "${RED}Some function endpoints are not accessible${NC}"
    echo ""
    echo "Possible causes:"
    echo "- Deployment still in progress (wait a few minutes)"
    echo "- Functions failed to build (check Netlify logs)"
    echo "- Environment variables not set in Netlify"
fi
echo ""
