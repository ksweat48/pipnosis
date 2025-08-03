import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// CRITICAL: Load environment variables from root directory FIRST, before any other imports
const envPath = join(__dirname, '../../.env');
console.log('🔧 AI Service loading environment variables from:', envPath);
dotenv.config({ path: envPath });

// Verify environment variables are loaded
console.log('🔑 Environment check in AI Service:');
console.log('- OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? `${process.env.OPENAI_API_KEY.substring(0, 10)}...` : 'MISSING');

// Import OpenAI AFTER environment variables are loaded
import OpenAI from 'openai';

// Initialize OpenAI with better error handling - DON'T crash if API key is missing
let openai = null;
let openaiInitialized = false;

try {
  const apiKey = process.env.OPENAI_API_KEY;
  console.log('🔍 Checking OpenAI API key:', apiKey ? `${apiKey.substring(0, 10)}...` : 'MISSING');
  
  if (apiKey && apiKey !== 'your_openai_api_key_here' && !apiKey.includes('your_') && apiKey.length > 10) {
    openai = new OpenAI({
      apiKey: apiKey
    });
    openaiInitialized = true;
    console.log('🔑 OpenAI client initialized successfully');
  } else {
    console.warn('⚠️ OpenAI API key not configured properly. AI features will use mock responses.');
    console.log('💡 To enable real AI features, add your OpenAI API key to the .env file');
    console.log('💡 Expected format: OPENAI_API_KEY=sk-...');
  }
} catch (error) {
  console.warn('⚠️ OpenAI initialization failed:', error.message);
  console.log('💡 AI service will continue in mock mode');
}

// Pipnosis Trading Laws (embedded in AI logic)
const PIPNOSIS_LAWS = `
PIPNOSIS IMMUTABLE LAWS OF TRADING (10 Core Rules):

1. Capital Preservation Above All - Never risk the entire account balance on any single trade or series of trades.
2. Target 70–80% Win Rate Over Time - Trades should be selected and filtered to statistically strive for a 70%–80% win rate.
3. Manage Drawdown Relentlessly - Limit cumulative drawdown. If drawdown exceeds safe thresholds, halt trading.
4. Never Chase Unrealistic Goals - Scale down unrealistic goals and preserve user funds.
5. AI Is the Final Decision-Maker - Pipnosis retains ultimate judgment to override risky trades.
6. Trades Must Have High Quality Entry Conditions - Each trade must meet multiple technical confirmations.
7. Cut Losses Early, Let Winners Run - Favor intelligent trailing stops and time-based exits.
8. No Trading During High-Risk Events - Avoid trading before/during major economic news unless explicitly enabled.
9. Do Not Overtrade - Max 2 trades per session, no overlapping trades on same pair.
10. Prioritize Consistency Over Speed - Follow 5-minute reassessment rules strictly, use demo equity for all calculations.

ADDITIONAL SESSION RULES:
- Max 2 trades per session (Law #9)
- Risk per trade must stay under 5% of demo balance
- No trades after 2 consecutive losses
- No overlapping trades on the same pair
- Only trade top 3 selected pairs: EURUSD, GBPUSD, XAUUSD
- TP/SL must maintain minimum 1:1 RRR
- Do not re-enter after SL hit without new analysis
- Always explain the reason behind each trade

These laws are IMMUTABLE and override any user request that would violate them.
`;

class AIService {
  constructor() {
    this.isInitialized = openaiInitialized;
    this.init();
  }

  async init() {
    try {
      if (!openaiInitialized) {
        console.warn('⚠️ OpenAI not initialized. AI features will use mock responses.');
        this.isInitialized = false;
        return;
      }

      // Test OpenAI connection if initialized
      if (openai) {
        try {
          console.log('🧪 Testing OpenAI connection...');
          await openai.models.list();
          this.isInitialized = true;
          console.log('✅ AI Service initialized with OpenAI GPT-4');
        } catch (testError) {
          console.warn('⚠️ OpenAI connection test failed:', testError.message);
          console.warn('⚠️ This might be due to invalid API key or network issues');
          this.isInitialized = false;
        }
      }
    } catch (error) {
      console.error('❌ Failed to initialize AI Service:', error.message);
      this.isInitialized = false;
    }
  }

  async analyzePrompt(prompt, accountBalance, marketData, userId) {
    try {
      let analysis;

      if (this.isInitialized && openai) {
        console.log('🤖 Using OpenAI GPT-4 for analysis');
        analysis = await this.getOpenAIAnalysis(prompt, accountBalance, marketData);
      } else {
        console.log('🤖 Using mock AI analysis (OpenAI not available)');
        analysis = this.getMockAnalysis();
      }

      return analysis;
    } catch (error) {
      console.error('❌ AI Analysis failed:', error);
      
      return this.getMockAnalysis();
    }
  }

  async getOpenAIAnalysis(prompt, accountBalance, marketData) {
    const systemPrompt = `You are Pipnosis, an expert AI forex trading assistant that STRICTLY follows the Pipnosis Immutable Laws of Trading.

${PIPNOSIS_LAWS}

User's account balance: $${accountBalance}
Current market data: ${JSON.stringify(marketData)}

CRITICAL: You MUST follow ALL 10 Immutable Laws in every decision. These laws override any user request that would violate them.

Analyze the user's trading prompt and generate 2-3 specific trading strategies with exact parameters, ensuring:
- Capital preservation is prioritized (Law #1)
- Strategies target 70-80% win rate (Law #2)
- Drawdown is managed relentlessly (Law #3)
- Unrealistic goals are scaled down with explanation (Law #4)
- High quality entry conditions are required (Law #6)

Return a JSON object with this exact structure:
{
  "strategies": [
    {
      "id": "1",
      "name": "Strategy Name",
      "risk": "low|medium|high",
      "tradeType": "SYMBOL Direction (Timeframe)",
      "entry": 1.2345,
      "stopLoss": 1.2300,
      "takeProfit": 1.2400,
      "lotSize": 0.5,
      "estimatedGain": 150,
      "feasible": true,
      "reasoning": "Detailed explanation including which Pipnosis Laws guide this strategy"
    }
  ],
  "summary": "Brief overview of the market analysis",
  "confidence": "high|medium|low",
  "riskAssessment": "Overall risk assessment referencing applicable Pipnosis Laws"
}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 1500
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    try {
      return JSON.parse(content);
    } catch (parseError) {
      console.error('Failed to parse OpenAI response:', content);
      throw new Error('Invalid AI response format');
    }
  }

  getMockAnalysis() {
    return {
      strategies: [
        {
          id: '1',
          name: 'Conservative Swing',
          risk: 'low',
          tradeType: 'EURUSD Swing (H1-D1)',
          entry: 1.1410,
          stopLoss: 1.1360,
          takeProfit: 1.1510,
          lotSize: 0.5,
          estimatedGain: 210,
          feasible: true,
          reasoning: 'Strong uptrend continuation with bullish engulfing pattern. Following Pipnosis Law #1 (Capital Preservation) with 2% risk, Law #6 (High Quality Entry) with multiple confirmations.'
        },
        {
          id: '2',
          name: 'Balanced Growth',
          risk: 'medium',
          tradeType: 'EURUSD Swing (H1-D1)',
          entry: 1.1410,
          stopLoss: 1.1360,
          takeProfit: 1.1510,
          lotSize: 1.0,
          estimatedGain: 490,
          feasible: true,
          reasoning: 'Same setup with increased position size per Law #5 (AI Final Decision). Maintains Law #3 (Drawdown Management) while targeting weekly goal.'
        }
      ],
      summary: 'Market shows bullish momentum on EURUSD with strong technical indicators supporting upward movement.',
      confidence: 'high',
      riskAssessment: 'Moderate risk with proper position sizing following Pipnosis Laws #1 and #3.'
    };
  }

  async generateJournalEntry(eventType, tradeData, userId) {
    try {
      if (!this.isInitialized || !openai) {
        return this.getMockJournalEntry(eventType, tradeData);
      }

      const systemPrompt = `You are Pipnosis AI, writing a trade journal entry that follows the Pipnosis Immutable Laws of Trading.

${PIPNOSIS_LAWS}

  getMockAnalysis(selectedPair = 'EURUSD', specifiedRiskLevel = null) {
    // Generate base prices for calculations
    const basePrices = {
    // Generate LOW RISK strategy (2% account risk)
    const lowRiskEntry = basePrice + (Math.random() > 0.5 ? 1 : -1) * priceStep * (isGold ? 5 : 10);
    const lowRiskSL = lowRiskEntry + (lowRiskEntry > basePrice ? -1 : 1) * priceStep * (isGold ? 15 : 30);
    const lowRiskTP = lowRiskEntry + (lowRiskEntry > basePrice ? 1 : -1) * priceStep * (isGold ? 25 : 45);
    
    strategies.push({
      id: '1',
      name: 'Conservative Capital Protection',
      risk: 'low',
      symbol: selectedPair,
      action: lowRiskEntry > basePrice ? 'buy' : 'sell',
      entry: parseFloat(lowRiskEntry.toFixed(isGold ? 2 : 5)),
      stopLoss: parseFloat(lowRiskSL.toFixed(isGold ? 2 : 5)),
      takeProfit: parseFloat(lowRiskTP.toFixed(isGold ? 2 : 5)),
      lotSize: 0.2,
      estimatedGain: 120,
      riskRewardRatio: 1.5,
      feasible: true,
      reasoning: `Conservative ${selectedPair} ${lowRiskEntry > basePrice ? 'buy' : 'sell'} following Law #1 (Capital Preservation) with 2% account risk. Law #6 (High Quality Entry) ensures multiple confirmations. Law #9 limits to 2 trades per session. Minimum 1.5:1 RRR maintained.`
    });

    // Generate MEDIUM RISK strategy (4% account risk)
    const mediumRiskEntry = basePrice + (Math.random() > 0.5 ? 1 : -1) * priceStep * (isGold ? 8 : 15);
    const mediumRiskSL = mediumRiskEntry + (mediumRiskEntry > basePrice ? -1 : 1) * priceStep * (isGold ? 20 : 40);
    const mediumRiskTP = mediumRiskEntry + (mediumRiskEntry > basePrice ? 1 : -1) * priceStep * (isGold ? 40 : 80);
    
    strategies.push({
      id: '2',
      name: 'Balanced Growth Strategy',
      risk: 'medium',
      symbol: selectedPair,
      action: mediumRiskEntry > basePrice ? 'buy' : 'sell',
      entry: parseFloat(mediumRiskEntry.toFixed(isGold ? 2 : 5)),
      stopLoss: parseFloat(mediumRiskSL.toFixed(isGold ? 2 : 5)),
      takeProfit: parseFloat(mediumRiskTP.toFixed(isGold ? 2 : 5)),
      lotSize: 0.4,
      estimatedGain: 280,
      riskRewardRatio: 2.0,
      feasible: true,
      reasoning: \`Balanced ${selectedPair} ${mediumRiskEntry > basePrice ? 'buy' : 'sell'} per Law #5 (AI Final Decision) with 4% account risk. Law #7 (Cut Losses Early) guides stop placement. Law #9 ensures no overlapping trades on same pair. 2:1 RRR maintained.`
    });
  }

  getMockJournalEntry(eventType, tradeData) {
    const entries = {
      trade_entry: {
        title: 'New Trade Position Opened',
        content: 'Entered position following Pipnosis Law #6 (High Quality Entry Conditions) with multiple technical confirmations. Law #1 (Capital Preservation) guided position sizing to 2% risk.',
        confidence_level: 'high'
      },
      summary: \`${selectedPair} analysis shows clear trading opportunities. AI selected this pair based on current market conditions and signal strength. Both strategies comply with Pipnosis Immutable Laws.`,
        title: 'Trade Position Closed',
      riskAssessment: \`Risk management follows Law #1 (Capital Preservation) and Law #3 (Drawdown Management). Maximum 2 trades per session per Law #9. Both strategies maintain minimum RRR requirements.`,
      selectedPair: selectedPair,
      sessionInfo: \`Session limits: Max 2 trades, no overlapping trades on ${selectedPair}, 5-minute reassessment rules apply`
    };

    return entries[eventType] || entries.trade_entry;
  }
}

export const aiService = new AIService();
    }
  }
}