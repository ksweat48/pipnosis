#!/bin/bash

# ╔═══════════════════════════════════════════════════════════════════════╗
# ║                     Bootstrap All New Symbols                         ║
# ║                                                                       ║
# ║  This script populates historical candle data for all new symbols:   ║
# ║  - Crypto: BTCUSD, ETHUSD, SOLUSD, BNBUSD (7 days, 24/7)            ║
# ║  - Indices: NAS100, SPX500 (7 days, forex hours)                     ║
# ║                                                                       ║
# ║  Usage:                                                               ║
# ║    chmod +x scripts/bootstrap-all-symbols.sh                         ║
# ║    ./scripts/bootstrap-all-symbols.sh                                ║
# ╚═══════════════════════════════════════════════════════════════════════╝

set -e

NETLIFY_URL="https://pipnosis.netlify.app"
CRYPTO_FUNCTION="${NETLIFY_URL}/.netlify/functions/bootstrap-crypto-symbols"
INDEX_FUNCTION="${NETLIFY_URL}/.netlify/functions/bootstrap-index-symbols"

echo "╔═══════════════════════════════════════════════════════════════════════╗"
echo "║         Bootstrapping Historical Data for New Symbols                ║"
echo "╚═══════════════════════════════════════════════════════════════════════╝"
echo ""

# Check if functions are deployed
echo "🔍 Checking if functions are deployed..."
CRYPTO_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${CRYPTO_FUNCTION}" || echo "000")
INDEX_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${INDEX_FUNCTION}" || echo "000")

if [ "$CRYPTO_STATUS" = "404" ] || [ "$INDEX_STATUS" = "404" ]; then
    echo "⚠️  Functions not yet deployed. Please wait for Netlify deployment to complete."
    echo "   You can check deployment status at: https://app.netlify.com/"
    echo ""
    echo "   Once deployed, run this script again."
    exit 1
fi

echo "✓ Functions are deployed and ready"
echo ""

# Bootstrap Crypto Symbols
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Bootstrapping Crypto Symbols (BTCUSD, ETHUSD, SOLUSD, BNBUSD)"
echo "   - Fetching 7 days of historical data"
echo "   - All timeframes: M1, M5, M15, M30, H1, H4, D1"
echo "   - Source: Binance (free public API)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

CRYPTO_RESPONSE=$(curl -s -X GET "${CRYPTO_FUNCTION}" -H "Content-Type: application/json")
CRYPTO_SUCCESS=$(echo "$CRYPTO_RESPONSE" | grep -o '"ok":true' || echo "")

if [ -n "$CRYPTO_SUCCESS" ]; then
    echo "✅ Crypto symbols bootstrap completed successfully!"
    echo ""
    echo "$CRYPTO_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$CRYPTO_RESPONSE"
else
    echo "❌ Crypto symbols bootstrap failed!"
    echo ""
    echo "$CRYPTO_RESPONSE"
fi

echo ""
echo ""

# Bootstrap Index Symbols
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📈 Bootstrapping Index Symbols (NAS100, SPX500)"
echo "   - Fetching 7 days of historical data"
echo "   - All timeframes: M1, M5, M15, M30, H1, H4, D1"
echo "   - Source: MetaAPI"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

INDEX_RESPONSE=$(curl -s -X GET "${INDEX_FUNCTION}" -H "Content-Type: application/json")
INDEX_SUCCESS=$(echo "$INDEX_RESPONSE" | grep -o '"ok":true' || echo "")

if [ -n "$INDEX_SUCCESS" ]; then
    echo "✅ Index symbols bootstrap completed successfully!"
    echo ""
    echo "$INDEX_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$INDEX_RESPONSE"
else
    echo "❌ Index symbols bootstrap failed!"
    echo ""
    echo "$INDEX_RESPONSE"
fi

echo ""
echo ""
echo "╔═══════════════════════════════════════════════════════════════════════╗"
echo "║                    Bootstrap Complete!                                ║"
echo "╚═══════════════════════════════════════════════════════════════════════╝"
echo ""
echo "🎉 Historical data has been populated for all new symbols."
echo "   You can now trade these instruments in the application."
echo ""
echo "Next steps:"
echo "  1. Open the Pipnosis app in your browser"
echo "  2. Select any of the new symbols from the dropdown"
echo "  3. The chart should now display historical candles"
echo "  4. Start trading!"
echo ""
