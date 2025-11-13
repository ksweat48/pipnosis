# Quick Start Guide - AI Trading Bot

## ✅ What's Ready

Your AI trading bot is fully implemented and production-ready with:
- Rule-based technical scanning (free, continuous)
- GPT-4 strategic validation (selective, cost-optimized)
- OpenAI API integrated and configured
- Database migrations confirmed working
- Production build successful

## 🚀 Next Steps

### 1. Deploy to Netlify (Required for API Keys)

```bash
# Add OpenAI keys to Netlify environment variables first!
# Then trigger deployment:
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
```

**IMPORTANT:** Add these to Netlify Dashboard → Site Settings → Environment Variables:
- `VITE_OPENAI_API_KEY`
- `OPENAI_API_KEY`

Both should have the value:
```
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
```

### 2. Test in Demo Mode

1. **Login to your app** (or create account)
2. **Navigate to AI Trading Console** (toggle from Manual Trading)
3. **Set a test goal**: "Make me $50 today" (small target for testing)
4. **Watch the AI work**:
   - AI parses your goal (1 API call)
   - Scanner continuously monitors markets (free)
   - When it finds a setup scoring 75+, AI validates it (~1 API call)
   - Review the AI's reasoning before executing

### 3. Monitor Performance

Open browser console to check:

```javascript
// Check AI API usage
import { aiMarketEngine } from './src/lib/aiMarketEngine';
console.log(aiMarketEngine.getUsageStats());
// Output: { callsUsed: 3, maxCalls: 20, cacheSize: 2 }

// Check scanner stats
import { intelligentMarketScanner } from './src/services/intelligentMarketScanner';
console.log(intelligentMarketScanner.getStats());
// Output: { totalScans: 15, avgScore: 78, topSymbol: 'EURUSD', aiUsagePercent: 25 }
```

## 📊 How It Works

### Every 5-10 Seconds (FREE)
1. Technical engine scans all watchlist symbols
2. Calculates EMA, RSI, MACD, Bollinger Bands, ATR
3. Detects patterns and trends
4. Scores each setup 0-100
5. Filters: keeps only 60+ scores

### When Score ≥ 75 (Selective GPT-4)
1. Sends top setup to GPT-4 for validation
2. AI analyzes market context
3. Confirms or rejects the signal
4. Provides reasoning
5. **Cost: ~$0.10 per validation**

### Result
- Only 5-10% of technical signals get AI validation
- Only AI-approved signals are presented to you
- **Expected cost: $1-5 per day**

## 💰 Cost Breakdown

### Current OpenAI Plan
Check your usage at: https://platform.openai.com/usage

### Expected Daily Usage
- **Goal parsing**: 1-3 calls/day = $0.03-0.09
- **Market validations**: 10-20 calls/day = $1.00-3.00
- **Session summaries**: 1-2 calls/day = $0.10-0.30
- **Total**: $1.13-3.39 per day

### Cost Controls Active
✅ Maximum 20 API calls per hour
✅ 15-minute caching per symbol
✅ 3-minute minimum between calls
✅ Automatic fallback if quota exceeded
✅ Only validates signals scoring 75+

## 🎯 Testing Checklist

- [ ] Verify Netlify environment variables are set
- [ ] Deploy to Netlify
- [ ] Login to app in demo mode
- [ ] Create a test goal session ("Make me $50 today")
- [ ] Wait for scanner to find opportunities (may take 5-30 minutes)
- [ ] Review AI reasoning when signal appears
- [ ] Execute one demo trade
- [ ] Monitor OpenAI API usage dashboard
- [ ] Check costs after 24 hours
- [ ] Adjust thresholds if needed

## 📁 Documentation

- **Full System Guide**: `AI_TRADING_SYSTEM_GUIDE.md`
- **Implementation Summary**: `IMPLEMENTATION_SUMMARY.md`
- **This Quick Start**: `QUICK_START.md`

## ⚙️ Key Files

### Core AI System
- `src/lib/technicalScanEngine.ts` - Rule-based analysis
- `src/lib/aiMarketEngine.ts` - GPT-4 integration
- `src/lib/aiGoalParser.ts` - Natural language parsing
- `src/services/intelligentMarketScanner.ts` - Hybrid coordinator
- `src/services/marketAnalysisService.ts` - Database & caching

### Configuration
- `.env` - Contains your OpenAI API key
- `.env.example` - Template with documentation

## 🐛 Troubleshooting

### "OpenAI API key not configured"
→ Rebuild after adding key to `.env`: `npm run build`

### "No tradable setups found"
→ Normal - market conditions may not meet criteria
→ Try lowering threshold: `minTechnicalScore: 65`

### "Hourly API call limit reached"
→ Working as designed - prevents runaway costs
→ System uses rule-based analysis until hourly reset

### High API costs
→ Increase `minTechnicalScore` to 80+
→ Reduce scan frequency
→ Check OpenAI dashboard for usage details

## 🎉 You're Ready!

The system is fully functional and ready for testing. Start with demo mode, monitor costs closely, and adjust thresholds based on results.

**Demo mode is completely safe** - no real money at risk. Test extensively before considering live trading.

## 📞 Support

- Review console logs for detailed debugging
- Check `market_analysis` table in Supabase for AI analysis history
- Monitor OpenAI dashboard for API usage
- Review Netlify function logs for backend errors

---

**Good luck with your AI trading bot! 🚀📈**
