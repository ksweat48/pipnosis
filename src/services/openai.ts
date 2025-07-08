import OpenAI from 'openai';

// Initialize OpenAI client with proper environment variable handling
const openai = new OpenAI({
  apiKey: import.meta.env.VITE_OPENAI_API_KEY || '',
  dangerouslyAllowBrowser: true // Required for client-side usage
});

export interface TradingStrategy {
  id: string;
  name: string;
  risk: 'low' | 'medium' | 'high';
  tradeType: string;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  lotSize: number;
  estimatedGain: number;
  feasible: boolean;
  reasoning: string;
}

export interface MarketAnalysis {
  strategies: TradingStrategy[];
  summary: string;
  confidence: 'high' | 'medium' | 'low';
  riskAssessment: string;
}

export interface JournalEntry {
  id: string;
  timestamp: string;
  type: 'entry' | 'modification' | 'exit' | 'update' | 'pause';
  title: string;
  message: string;
  tradeId?: string;
  symbol?: string;
  pnl?: number;
  confidence?: 'high' | 'medium' | 'low';
}

// Pipnosis Immutable Laws of Trading - Hard-coded into AI logic
const PIPNOSIS_TRADING_LAWS = `
PIPNOSIS IMMUTABLE LAWS OF TRADING (AI Laws of Risk & Success):

1. Capital Preservation Above All
2. Target 70–80% Win Rate Over Time
3. Manage Drawdown Relentlessly
4. Never Chase Unrealistic Goals
5. AI Is the Final Decision-Maker
6. Trades Must Have High Quality Entry Conditions
7. Cut Losses Early, Let Winners Run
8. No Trading During High-Risk Events
9. Do Not Overtrade
10. Prioritize Consistency Over Speed

TRADE MORALITY CLAUSE:
Pipnosis must never engage in unauthorized trading, never use deceptive logic to meet prompts, and always provide reasoning and transparency in its decisions even if the user doesn't ask.

These laws are IMMUTABLE and must be followed in ALL trading decisions, strategy generation, and risk assessments.
`;

export class OpenAIService {
  private client: OpenAI;
  private initialized: boolean = false;
  private fallbackMode: boolean = false;
  private apiKeyConfigured: boolean = false;

  constructor() {
    this.client = openai;
    this.init();
  }

  private init() {
    try {
      // Check if API key is available and valid
      const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
      
      if (apiKey && apiKey !== 'your_openai_api_key_here' && !apiKey.includes('your_') && apiKey.length > 10) {
        console.log('✅ OpenAI API key found, initializing...');
        this.apiKeyConfigured = true;
        this.initialized = true;
        this.fallbackMode = false;
      } else {
        console.warn('⚠️ OpenAI API key not configured or invalid. Using fallback mode.');
        this.apiKeyConfigured = false;
        this.initialized = false;
        this.fallbackMode = true;
      }
    } catch (error) {
      console.error('❌ OpenAI initialization error:', error);
      this.initialized = false;
      this.fallbackMode = true;
    }
  }

  // Get current status of OpenAI service
  getStatus() {
    return {
      initialized: this.initialized,
      fallbackMode: this.fallbackMode,
      apiKeyConfigured: this.apiKeyConfigured
    };
  }

  // Attempt to reconnect/reinitialize OpenAI
  async reconnect(): Promise<boolean> {
    try {
      console.log('🔄 Attempting to reconnect to OpenAI...');
      
      // Re-check API key
      const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
      
      if (!apiKey || apiKey === 'your_openai_api_key_here' || apiKey.includes('your_') || apiKey.length <= 10) {
        console.warn('⚠️ OpenAI API key still not configured properly');
        this.apiKeyConfigured = false;
        this.initialized = false;
        this.fallbackMode = true;
        return false;
      }
      
      // Test connection with a simple request
      try {
        const response = await this.client.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Test connection' }],
          max_tokens: 5
        });
        
        if (response) {
          console.log('✅ OpenAI connection test successful');
          this.initialized = true;
          this.fallbackMode = false;
          return true;
        }
      } catch (testError) {
        console.error('❌ OpenAI connection test failed:', testError);
        this.initialized = false;
        this.fallbackMode = true;
        return false;
      }
      
      return false;
    } catch (error) {
      console.error('❌ OpenAI reconnection error:', error);
      this.initialized = false;
      this.fallbackMode = true;
      return false;
    }
  }

  async interpretPrompt(prompt: string, accountBalance: number = 10000, marketData?: any[]): Promise<MarketAnalysis> {
    try {
      // Check if API key is available and valid
      if (!this.apiKeyConfigured || this.fallbackMode) {
        console.error('OpenAI API key not configured or using fallback mode.');
        throw new Error('OpenAI API key not configured properly');
      }

      const systemPrompt = `You are Pipnosis, an expert AI forex trading assistant that STRICTLY follows the Pipnosis Immutable Laws of Trading.

${PIPNOSIS_TRADING_LAWS}

User's account balance: $${accountBalance}

CRITICAL: You MUST follow ALL 10 Immutable Laws and the Trade Morality Clause in every decision. These laws override any user request that would violate them.

Analyze the user's trading prompt and generate 2-3 specific trading strategies with exact parameters, ensuring:
- Capital preservation is prioritized (Law #1)
- Strategies target 70-80% win rate (Law #2)
- Drawdown is managed relentlessly (Law #3)
- Unrealistic goals are scaled down with explanation (Law #4)
- High quality entry conditions are required (Law #6)
- Risk management is paramount (Laws #7, #8, #9)
- Consistency over speed (Law #10)

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
}

IMPORTANT: 
- Return entry, stopLoss, and takeProfit as numeric values (not strings)
- Reference specific Pipnosis Laws in your reasoning
- Mark strategies as feasible: false if they violate any Immutable Law
- Scale down unrealistic goals per Law #4
- Ensure position sizing follows capital preservation (Law #1)`;

      const response = await this.client.chat.completions.create({
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

      // Try to parse JSON response
      try {
        const analysis = JSON.parse(content);
        // Ensure the response has the correct structure
        if (!analysis.strategies || !Array.isArray(analysis.strategies)) {
          console.warn('Invalid response structure from OpenAI, using mock data');
          throw new Error('Invalid response structure from OpenAI');
        }
        return analysis;
      } catch (parseError) {
        console.error('Failed to parse OpenAI response as JSON:', content);
        throw new Error('Failed to parse OpenAI response');
      }

    } catch (error) {
      console.error('OpenAI API error:', error);
      throw error;
    }
  }

  async generateJournalEntry(
    type: string,
    tradeData: any,
    context?: string
  ): Promise<JournalEntry> {
    try {
      // Check if API key is available and valid
      if (!this.apiKeyConfigured || this.fallbackMode) {
        throw new Error('OpenAI API key not configured properly');
      }

      const systemPrompt = `You are Pipnosis AI, writing a trade journal entry that follows the Pipnosis Immutable Laws of Trading.

${PIPNOSIS_TRADING_LAWS}

Write in a conversational, confident tone that explains trading decisions clearly while referencing which Pipnosis Laws guided the decision.
Keep it concise but informative. Use everyday trader language.

ALWAYS reference specific Pipnosis Laws that influenced the decision (e.g., "Following Law #1 (Capital Preservation), I limited position size to 2% risk").

Return a JSON object with this structure:
{
  "title": "Brief title for the entry",
  "message": "Detailed explanation of the decision including which Pipnosis Laws were applied",
  "confidence": "high|medium|low"
}`;

      const userPrompt = `Write a journal entry for a ${type} event with this data: ${JSON.stringify(tradeData)}. ${context || ''}`;

      const response = await this.client.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.8,
        max_tokens: 300
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from OpenAI');
      }

      try {
        const parsed = JSON.parse(content);
        return {
          id: Date.now().toString(),
          timestamp: new Date().toISOString(),
          type: type as any,
          title: parsed.title,
          message: parsed.message,
          confidence: parsed.confidence,
          tradeId: tradeData.tradeId,
          symbol: tradeData.symbol,
          pnl: tradeData.pnl
        };
      } catch (parseError) {
        throw new Error('Failed to parse journal entry response');
      }

    } catch (error) {
      console.error('OpenAI journal generation error:', error);
      throw error;
    }
  }

  async assessFeasibility(goal: string, balance: number, risk: string) {
    try {
      // Check if API key is available and valid
      if (!this.apiKeyConfigured || this.fallbackMode) {
        throw new Error('OpenAI API key not configured properly');
      }

      const systemPrompt = `You are Pipnosis, analyzing trading goal feasibility according to the Pipnosis Immutable Laws of Trading.

${PIPNOSIS_TRADING_LAWS}

Assess if the trading goal is realistic given the account balance and risk tolerance, strictly following the Immutable Laws.

Reference specific laws in your assessment (especially Law #4: Never Chase Unrealistic Goals).

Return a JSON object with:
{
  "feasible": true/false,
  "reasoning": "Detailed explanation referencing applicable Pipnosis Laws",
  "recommendations": "Suggested adjustments if needed, citing relevant laws",
  "timeframe": "Estimated timeframe to achieve goal following Pipnosis Laws"
}`;

      const userPrompt = `Goal: ${goal}, Balance: $${balance}, Risk: ${risk}`;

      const response = await this.client.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 500
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from OpenAI');
      }

      try {
        return JSON.parse(content);
      } catch (parseError) {
        throw new Error('Failed to parse feasibility assessment response');
      }

    } catch (error) {
      console.error('OpenAI feasibility assessment error:', error);
      throw error;
    }
  }

  async explainDecision(decision: string, context: any): Promise<string> {
    try {
      // Check if API key is available and valid
      if (!this.apiKeyConfigured || this.fallbackMode) {
        throw new Error('OpenAI API key not configured properly');
      }

      const systemPrompt = `You are Pipnosis AI, explaining trading decisions in simple terms while referencing the Pipnosis Immutable Laws of Trading.

${PIPNOSIS_TRADING_LAWS}

Provide a clear, educational explanation of why this trading decision makes sense according to the Pipnosis Laws.
Use everyday language and focus on the key factors and specific laws that influenced the decision.
Always reference which Immutable Laws guided the decision-making process.`;

      const userPrompt = `Explain this decision: ${decision}. Context: ${JSON.stringify(context)}`;

      const response = await this.client.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.8,
        max_tokens: 400
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from OpenAI');
      }
      return content;

    } catch (error) {
      console.error('OpenAI explanation error:', error);
      throw error;
    }
  }

}

export const openAIService = new OpenAIService();