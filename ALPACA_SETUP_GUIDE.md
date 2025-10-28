# Alpaca Markets Setup Guide

## Quick Start

Your application now uses **Alpaca Markets** for real-time stock market data instead of MetaAPI.

### Why Alpaca?
- ✅ Free paper trading with real market data
- ✅ No DNS or connection issues
- ✅ WebSocket streaming included in free tier
- ✅ Professional-grade API used by Robinhood
- ✅ Supports stocks, crypto, and options
- ✅ Serverless-friendly architecture

---

## Step 1: Create Alpaca Account

1. Visit: https://app.alpaca.markets/signup
2. Sign up for a **Paper Trading** account (completely free)
3. Verify your email address
4. Log into the dashboard

---

## Step 2: Get Your API Keys

1. Go to: https://app.alpaca.markets/paper/dashboard/overview
2. Click on "View" under "Your API Keys"
3. You'll see:
   - **API Key ID** (starts with PK...)
   - **Secret Key** (long random string)
4. Copy both keys - you'll need them next

---

## Step 3: Configure Environment Variables

### Local Development

Edit your `.env` file:

```bash
ALPACA_API_KEY=PKxxxxxxxxxxxxxxxxxx
ALPACA_API_SECRET=your_secret_key_here
```

### Netlify Production

1. Go to your Netlify dashboard
2. Navigate to: **Site settings > Environment variables**
3. Add these variables:
   - `ALPACA_API_KEY`: Your API Key ID
   - `ALPACA_API_SECRET`: Your Secret Key
4. Click "Save"

---

## Step 4: Test the Connection

Run the build locally:

```bash
npm install
npm run build
```

Start your dev server:

```bash
npm run dev
```

The chart should now display real stock data for symbols like:
- AAPL (Apple)
- MSFT (Microsoft)
- GOOGL (Google)
- TSLA (Tesla)

---

## Step 5: Deploy to Production

```bash
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
```

Wait 2-3 minutes for deployment to complete.

---

## Available Markets

Alpaca provides data for:

- **US Stocks**: All major exchanges (NYSE, NASDAQ)
- **Crypto**: BTC, ETH, and major cryptocurrencies  
- **Options**: Coming soon in this implementation

---

## Troubleshooting

### "Alpaca API credentials not configured"

**Solution**: Make sure you've added `ALPACA_API_KEY` and `ALPACA_API_SECRET` to:
1. Local `.env` file (for development)
2. Netlify environment variables (for production)

### "No market data available"

**Possible causes**:
1. Market is closed (US stock market: 9:30 AM - 4:00 PM ET, Mon-Fri)
2. API keys are invalid
3. Symbol doesn't exist

**Solution**: Try a popular symbol like AAPL during market hours.

### Rate Limits

Free tier limits:
- 200 requests per minute
- Unlimited WebSocket connections
- Real-time data included

---

## Next Steps

Now that Alpaca is configured:

1. **Test the Charts**: Open your app and watch real-time price updates
2. **Enable AI Analysis**: The AI trading assistant now receives real market data
3. **Paper Trade**: Practice trading with virtual money using real prices
4. **Upgrade Path**: When ready, upgrade to live trading with real money

---

## Support

- **Alpaca Docs**: https://alpaca.markets/docs
- **Alpaca Slack**: https://alpaca.markets/community
- **API Status**: https://alpaca.markets/status

---

## Benefits Over MetaAPI

| Feature | Alpaca | MetaAPI (Previous) |
|---------|--------|-------------------|
| Free Tier | ✅ Real-time data | ❌ Limited |
| DNS Issues | ✅ None | ❌ Frequent |
| Setup Time | ✅ 5 minutes | ❌ 30+ minutes |
| Serverless Support | ✅ Excellent | ❌ Poor |
| Documentation | ✅ Comprehensive | ⚠️ Moderate |
| Community | ✅ Large | ⚠️ Small |

---

**You're all set! Your live trading demo is now powered by Alpaca Markets.** 🚀
