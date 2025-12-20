# Finnhub Import - Quick Start

## 🚀 5-Minute Setup

### 1. Get API Key
- Visit: https://finnhub.io/register
- Copy your API key

### 2. Add to Environment

**Local (.env file):**
```bash
FINNHUB_API_KEY=your_api_key_here
```

**Netlify:**
- Go to: Site settings → Environment variables
- Add: `FINNHUB_API_KEY` = your_api_key_here
- Save

### 3. Deploy Functions

```bash
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
```

Wait 3-5 minutes for deployment.

### 4. Test Import (1 symbol, 1 day)

```bash
node scripts/finnhub-batch-import.js --test
```

Expected: ~288 candles imported in 10-15 seconds.

### 5. Full Import (All symbols, 30 days)

```bash
node scripts/finnhub-batch-import.js
```

**Time:** 25-35 minutes (automated)
**Candles:** ~285,000 total

### 6. Validate

```bash
node scripts/validate-finnhub-import.js
```

Expected: 0 errors, >90% coverage.

---

## ✅ Success Criteria

- ✅ All 5 symbols imported (EURUSD, GBPUSD, USDJPY, XAUUSD, US30)
- ✅ All 7 timeframes populated (M1, M5, M15, M30, H1, H4, D1)
- ✅ Validation shows 0 invalid candles
- ✅ Charts display smooth continuous data
- ✅ 30 days of historical coverage

---

## 🆘 Quick Troubleshooting

**"Invalid API key"**
→ Check .env file and Netlify env vars, then redeploy

**"ADMIN_REFRESH_KEY not set"**
→ Add any secure string to .env: `ADMIN_REFRESH_KEY=mysecretkey123`

**"Rate limited"**
→ Script handles this automatically, just wait

**"Function not found"**
→ Wait for Netlify deployment to complete (3-5 min)

---

## 📖 Full Documentation

See `FINNHUB_IMPORT_GUIDE.md` for complete details.

---

## 🎯 What You Get

After completion, your AI has:
- 30 days of accurate historical market data
- ~285,000 candles across all assets and timeframes
- Clean, validated, production-quality data
- Perfect foundation for AI pattern recognition

**Total Time Investment:** ~45 minutes
**Total Cost:** $0 (free tier)
**Data Quality:** Production-grade

---

**Ready to start?** → `node scripts/finnhub-batch-import.js --test`
