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

1. Capital Preservation Above All - Never risk the entire account balance on any single trade or series of trades. Capital protection is the foundation of long-term success.

2. Target 70–80% Win Rate Over Time - Trades should be selected and filtered to statistically strive for a 70%–80% win rate over time, regardless of daily, weekly, or prompt-specific goals.

3. Manage Drawdown Relentlessly - The system must limit cumulative drawdown. If drawdown exceeds safe thresholds (e.g. 10–20% based on risk mode), halt trading and protect capital.

4. Never Chase Unrealistic Goals - If a user prompt (e.g., "Make $10,000 from $100") is not feasible within defined risk tolerance, Pipnosis must scale down the goal, explain why, and preserve the user's funds.

5. AI Is the Final Decision-Maker - Even when high risk is selected, Pipnosis retains ultimate judgment to override a risky trade if the setup is not optimal. The user guides the intent; Pipnosis controls the method.

6. Trades Must Have High Quality Entry Conditions - Each trade must meet multiple technical confirmations (e.g., price action, trend alignment, volume, S/R) regardless of urgency. Pipnosis must wait for optimal setups.

7. Cut Losses Early, Let Winners Run - Where possible, Pipnosis must favor intelligent trailing stops, time-based exits, and avoid hitting full SL. Always act in favor of net account health.

8. No Trading During High-Risk Events (unless user overrides) - Pipnosis must avoid entering trades before or during major economic news unless the strategy can adapt for volatility and the user explicitly enables this mode.

9. Do Not Overtrade - Even if multiple trade opportunities exist, Pipnosis must obey trade frequency limits based on account size and user risk tier (e.g., 1–5 open trades max).

10. Prioritize Consistency Over Speed - If fulfilling a prompt would violate risk control rules, Pipnosis should fulfill part of the prompt (e.g., 50–70% of profit goal) rather than overextend and risk a loss.

TRADE MORALITY CLAUSE:
Pipnosis must never engage in unauthorized trading, never use deceptive logic to meet prompts, and always provide reasoning and transparency in its decisions even if the user doesn't ask.

These laws are IMMUTABLE and must be followed in ALL trading decisions, strategy generation, and risk assessments.
`;

export class OpenAIService {
  private client: OpenAI;

  constructor() {
    this.client = openai;
  }

  async interpretPrompt(prompt: string, accountBalance: number = 10000, marketData?: any[]): Promise<MarketAnalysis> {
    try {
      // Check if API key is available and valid
      const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
      if (!apiKey || apiKey === 'your_openai_api_key_here' || apiKey.includes('your_')) {
        console.warn('OpenAI API key not configured or using placeholder. Using mock data.');
        return this.getMockAnalysis();
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
          return this.getMockAnalysis();
        }
        return analysis;
      } catch (parseError) {
        console.error('Failed to parse OpenAI response as JSON:', content);
        return this.getMockAnalysis();
      }

    } catch (error) {
      console.error('OpenAI API error:', error);
      return this.getMockAnalysis();
    }
  }

  async generateJournalEntry(
    type: string,
    tradeData: any,
    context?: string
  ): Promise<JournalEntry> {
    try {
      // Check if API key is available and valid
      const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
      if (!apiKey || apiKey === 'your_openai_api_key_here' || apiKey.includes('your_')) {
        return this.getMockJournalEntry(type, tradeData);
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
        return this.getMockJournalEntry(type, tradeData);
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
        return this.getMockJournalEntry(type, tradeData);
      }

    } catch (error) {
      console.error('OpenAI journal generation error:', error);
      return this.getMockJournalEntry(type, tradeData);
    }
  }

  async assessFeasibility(goal: string, balance: number, risk: string) {
    try {
      // Check if API key is available and valid
      const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
      if (!apiKey || apiKey === 'your_openai_api_key_here' || apiKey.includes('your_')) {
        return this.getMockFeasibilityAssessment();
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
        return this.getMockFeasibilityAssessment();
      }

      try {
        return JSON.parse(content);
      } catch (parseError) {
        return this.getMockFeasibilityAssessment();
      }

    } catch (error) {
      console.error('OpenAI feasibility assessment error:', error);
      return this.getMockFeasibilityAssessment();
    }
  }

  async explainDecision(decision: string, context: any): Promise<string> {
    try {
      // Check if API key is available and valid
      const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
      if (!apiKey || apiKey === 'your_openai_api_key_here' || apiKey.includes('your_')) {
        return this.getMockExplanation(decision);
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
      return content || this.getMockExplanation(decision);

    } catch (error) {
      console.error('OpenAI explanation error:', error);
      return this.getMockExplanation(decision);
    }
  }

  private getMockAnalysis(): MarketAnalysis {
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
          reasoning: 'Strong uptrend continuation with bullish engulfing pattern. Following Pipnosis Law #1 (Capital Preservation) with 2% risk, Law #6 (High Quality Entry) with multiple confirmations, and Law #2 targeting 75% win rate. R:R 2:1 with strong support levels.'
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
          reasoning: 'Same setup with increased position size per Law #5 (AI Final Decision). Maintains Law #3 (Drawdown Management) while targeting weekly goal. Law #10 (Consistency Over Speed) ensures sustainable approach.'
        }
      ],
      summary: 'Market shows bullish momentum on EURUSD with strong technical indicators supporting upward movement. All strategies comply with Pipnosis Immutable Laws.',
      confidence: 'high',
      riskAssessment: 'Moderate risk with proper position sizing following Law #1 (Capital Preservation) and Law #3 (Drawdown Management). Stop-loss management per Law #7.'
    };
  }

  private getMockJournalEntry(type: string, tradeData: any): JournalEntry {
    const entries = {
      entry: {
        title: 'New Trade Position Opened',
        message: 'Entered position following Pipnosis Law #6 (High Quality Entry Conditions) with multiple technical confirmations. Law #1 (Capital Preservation) guided position sizing to 2% risk. Risk is controlled with proper stop loss per Law #7.',
        confidence: 'high' as const
      },
      exit: {
        title: 'Trade Position Closed',
        message: 'Closed position following Law #7 (Cut Losses Early, Let Winners Run) to secure profits and manage risk. Law #10 (Consistency Over Speed) guided the exit timing for sustainable results.',
        confidence: 'medium' as const
      },
      modification: {
        title: 'Position Updated',
        message: 'Adjusted trade parameters following Law #5 (AI Final Decision-Maker) based on evolving market conditions. Law #3 (Drawdown Management) ensures risk-reward optimization.',
        confidence: 'high' as const
      }
    };

    const template = entries[type as keyof typeof entries] || entries.entry;

    return {
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      type: type as any,
      title: template.title,
      message: template.message,
      confidence: template.confidence,
      tradeId: tradeData.tradeId,
      symbol: tradeData.symbol,
      pnl: tradeData.pnl
    };
  }

  private getMockFeasibilityAssessment() {
    return {
      feasible: true,
      reasoning: 'Goal appears achievable following Pipnosis Law #4 (Never Chase Unrealistic Goals) with proper risk management and Law #10 (Consistency Over Speed) for sustainable execution.',
      recommendations: 'Focus on Law #1 (Capital Preservation) and Law #3 (Drawdown Management) while maintaining disciplined trading approach per Law #9 (Do Not Overtrade).',
      timeframe: '3-6 months with consistent performance following all Pipnosis Immutable Laws'
    };
  }

  private getMockExplanation(decision: string): string {
    return `This decision was made following the Pipnosis Immutable Laws of Trading. Law #1 (Capital Preservation) guided position sizing, Law #6 (High Quality Entry Conditions) ensured multiple technical confirmations, and Law #3 (Drawdown Management) maintained acceptable risk levels. The strategy aims to balance potential returns with Law #7 (Cut Losses Early, Let Winners Run) while maintaining Law #2's target of 70-80% win rate through disciplined execution.`;
  }
}

export const openAIService = new OpenAIService();