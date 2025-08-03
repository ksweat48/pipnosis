import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';

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
import { saveAIJournalEntry, saveTradingSession, supabase } from '../lib/supabase.js';

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

  async analyzePrompt(prompt, accountBalance, marketData, userId, userSettings = {}) {
    try {
      // Check session limits (Immutable Law #9: Max 2 trades per session)
      const sessionCheck = await this.checkSessionLimits(userId);
      if (!sessionCheck.canTrade) {
        return {
          strategies: [],
          summary: sessionCheck.reason,
          confidence: 'low',
          riskAssessment: 'Session limits reached. Following Immutable Law #9 (Do Not Overtrade).',
          sessionLimited: true
        };
      }

      // Save the trading session to Supabase
      let session = null;
      try {
        if (userId) {
          session = await saveTradingSession({
            user_id: userId,
            session_id: uuidv4(),
            prompt: prompt,
            account_balance: accountBalance,
            market_data: marketData,
            user_settings: userSettings
          });
          console.log('💾 Trading session saved to Supabase');
        }
      } catch (supabaseError) {
        console.warn('⚠️ Failed to save trading session:', supabaseError.message);
      }

      let analysis;

      if (this.isInitialized && openai) {
        console.log('🤖 Using OpenAI GPT-4 for analysis');
        analysis = await this.getOpenAIAnalysis(prompt, accountBalance, marketData);
      } else {
        console.log('🤖 Using mock AI analysis (OpenAI not available)');
        analysis = this.getMockAnalysis();
      }

      // Save AI decision to journal
      if (userId) {
        try {
          await saveAIJournalEntry({
            user_id: userId,
            entry_type: 'ai_decision',
            title: 'AI Analysis Complete',
            content: `Generated ${analysis.strategies.length} trading strategies with ${analysis.confidence} confidence. Risk assessment: ${analysis.riskAssessment}`,
            confidence_level: analysis.confidence,
            session_id: session?.id
          });
        } catch (supabaseError) {
          console.warn('⚠️ Failed to save AI journal entry:', supabaseError.message);
        }
      }

      return analysis;
    } catch (error) {
      console.error('❌ AI Analysis failed:', error);
      
      // Save error to journal
      if (userId) {
        try {
          await saveAIJournalEntry({
            user_id: userId,
            entry_type: 'ai_decision',
            title: 'Analysis Error',
            content: `Failed to analyze prompt due to: ${error.message}. Using fallback strategies.`,
            confidence_level: 'low'
          });
        } catch (supabaseError) {
          console.warn('⚠️ Failed to save error journal entry:', supabaseError.message);
        }
      }

      return this.getMockAnalysis();
    }
  }

  // Check session limits (Immutable Law #9)
  async checkSessionLimits(userId) {
    try {
      if (!userId) {
        return { canTrade: true, reason: 'Guest user - no session limits' };
      }

      // Get today's trades for this user
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const { data: todaysTrades, error } = await supabase
        .from('trade_records')
        .select('*')
        .eq('user_id', userId)
        .gte('opened_at', today.toISOString());

      if (error) {
        console.error('Error checking session limits:', error);
        return { canTrade: true, reason: 'Unable to check session limits' };
      }

      const tradesCount = todaysTrades?.length || 0;
      const openTrades = todaysTrades?.filter(t => t.status === 'open') || [];
      
      // Law #9: Max 2 trades per session
      if (tradesCount >= 2) {
        return {
          canTrade: false,
          reason: `Session limit reached: ${tradesCount}/2 trades completed today. Following Immutable Law #9 (Do Not Overtrade), please wait until tomorrow for new trades.`
        };
      }

      // Check for overlapping trades on same pair
      const activePairs = openTrades.map(t => t.symbol);
      if (activePairs.length > 0) {
        return {
          canTrade: true,
          reason: `${2 - tradesCount} trades remaining today. Active positions: ${activePairs.join(', ')}`,
          activePairs
        };
      }

      return {
        canTrade: true,
        reason: `${2 - tradesCount} trades remaining today. No active positions.`,
        activePairs: []
      };

    } catch (error) {
      console.error('Error in session limits check:', error);
      return { canTrade: true, reason: 'Session check failed' };
    }
  }

  // Generate AI guidance for active trades (called by monitoring service)
  async generateTradeGuidance(trade, marketData, performance) {
    try {
      if (!this.isInitialized || !openai) {
        return this.getMockTradeGuidance(trade, performance);
      }

      const systemPrompt = `You are Pipnosis AI Trade Assistant, monitoring an active trade and providing guidance based on the Pipnosis Immutable Laws.

${PIPNOSIS_LAWS}

Current Trade Details:
- Symbol: ${trade.symbol}
- Type: ${trade.trade_type}
- Entry: ${trade.entry_price}
- Stop Loss: ${trade.stop_loss}
- Take Profit: ${trade.take_profit}
- Current Price: ${marketData.price}
- Unrealized P&L: $${performance.unrealizedPnL}
- Progress to TP: ${performance.tpProgress}%

Market Conditions:
- Trend: ${marketData.trend}
- Volatility: ${marketData.volatility}

CRITICAL: Follow the 5-minute reassessment rules (Law #10). Only recommend action if:
1. 80%+ of TP reached (secure profits)
2. 50%+ of TP reached (move SL to breakeven)
3. Market conditions changed significantly (early exit)
4. Approaching SL with adverse conditions

Return JSON:
{
  "actionRequired": boolean,
  "action": "hold|close_now|move_sl_breakeven|warning",
  "title": "Brief guidance title",
  "message": "Detailed explanation referencing Pipnosis Laws",
  "confidence": "high|medium|low"
}`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Analyze current trade performance and provide guidance if action is required.` }
        ],
        temperature: 0.3, // Lower temperature for more consistent guidance
        max_tokens: 400
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return this.getMockTradeGuidance(trade, performance);
      }

      try {
        return JSON.parse(content);
      } catch (parseError) {
        console.error('Failed to parse AI guidance:', content);
        return this.getMockTradeGuidance(trade, performance);
      }

    } catch (error) {
      console.error('AI guidance generation failed:', error);
      return this.getMockTradeGuidance(trade, performance);
    }
  }

  // Mock trade guidance for when OpenAI is not available
  getMockTradeGuidance(trade, performance) {
    // Rule-based guidance following Immutable Laws
    if (performance.tpProgress >= 80) {
      return {
        actionRequired: true,
        action: 'close_now',
        title: 'Secure Profits - Close Trade',
        message: `Trade has reached 80% of TP target. Following Law #7 (Cut Losses Early, Let Winners Run), I recommend closing now to secure $${performance.unrealizedPnL} profit.`,
        confidence: 'high'
      };
    }
    
    if (performance.tpProgress >= 50 && performance.unrealizedPnL > 0) {
      return {
        actionRequired: true,
        action: 'move_sl_breakeven',
        title: 'Move Stop Loss to Breakeven',
        message: `Trade is 50% toward TP with $${performance.unrealizedPnL} profit. Following Law #7, move stop loss to breakeven to protect gains.`,
        confidence: 'high'
      };
    }

    return {
      actionRequired: false,
      action: 'hold',
      title: 'Continue Monitoring',
      message: `Trade is performing normally. Current P&L: $${performance.unrealizedPnL}. Following Law #10 (5-minute reassessment), continue monitoring for changes.`,
      confidence: 'medium'
    };
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

Write a professional journal entry for this trading event:
Event Type: ${eventType}
Trade Data: ${JSON.stringify(tradeData)}

The entry should:
1. Reference relevant Pipnosis Laws
2. Explain the reasoning behind decisions
3. Be educational and insightful
4. Maintain professional tone

Return JSON:
{
  "title": "Entry title",
  "content": "Detailed journal entry content",
  "confidence_level": "high|medium|low"
}`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Generate journal entry for ${eventType}` }
        ],
        temperature: 0.6,
        max_tokens: 500
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return this.getMockJournalEntry(eventType, tradeData);
      }

      try {
        return JSON.parse(content);
      } catch (parseError) {
        console.error('Failed to parse journal entry:', content);
        return this.getMockJournalEntry(eventType, tradeData);
      }

    } catch (error) {
      console.error('Journal entry generation failed:', error);
      return this.getMockJournalEntry(eventType, tradeData);
    }
  }

  getMockJournalEntry(eventType, tradeData) {
    const entries = {
      trade_entry: {
        title: 'New Trade Position Opened',
        content: 'Entered position following Pipnosis Law #6 (High Quality Entry Conditions) with multiple technical confirmations. Law #1 (Capital Preservation) guided position sizing to 2% risk.',
        confidence_level: 'high'
      },
      trade_exit: {
        title: 'Trade Position Closed',
        content: 'Position closed following Pipnosis Law #7 (Cut Losses Early, Let Winners Run). Trade management followed 5-minute reassessment rules per Law #10.',
        confidence_level: 'high'
      },
      ai_decision: {
        title: 'AI Analysis Complete',
        content: 'Generated trading strategies following all Pipnosis Immutable Laws. Capital preservation prioritized with proper risk management.',
        confidence_level: 'high'
      }
    };

    return entries[eventType] || entries.trade_entry;
  }
}

export const aiService = new AIService();