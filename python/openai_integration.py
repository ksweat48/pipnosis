"""
Pipnosis OpenAI Integration for Python MT5 Bridge
Handles AI-powered prompt interpretation and strategy generation
"""

import openai
import json
import os
from typing import Dict, List, Optional, Any
from dataclasses import dataclass
from datetime import datetime
import logging

# Configure logging
logger = logging.getLogger(__name__)

@dataclass
class TradingStrategy:
    """AI-generated trading strategy"""
    asset: str
    entry: float
    stop_loss: float
    take_profit: float
    lot_size: float
    risk: str
    reasoning: str
    feasible: bool
    estimated_gain: float
    trade_type: str

@dataclass
class MarketAnalysis:
    """AI market analysis result"""
    should_trade: bool
    confidence: str
    reasoning: str
    strategies: List[TradingStrategy]

class PipnosisAI:
    """OpenAI integration for Pipnosis trading system"""
    
    def __init__(self, api_key: str = None):
        self.client = openai.OpenAI(
            api_key=api_key or os.getenv("OPENAI_API_KEY")
        )
        
        self.system_prompt = """You are Pipnosis, an expert AI forex trading assistant. You help users achieve their trading goals through intelligent analysis and strategy generation.

Key principles:
- Always prioritize risk management
- Provide clear, actionable strategies
- Use natural, conversational language
- Be honest about feasibility and risks
- Focus on realistic, achievable goals

When analyzing prompts:
1. Extract the user's goal (profit target, timeframe, risk tolerance)
2. Assess feasibility based on account balance and market conditions
3. Generate specific entry/exit strategies with proper risk management
4. Explain your reasoning in simple terms

Current market context: You have access to real-time forex data and can analyze EURUSD, GBPUSD, USDJPY, and other major pairs."""

    async def interpret_prompt(
        self, 
        user_prompt: str, 
        account_balance: float, 
        market_data: Optional[List[Dict]] = None
    ) -> MarketAnalysis:
        """
        Interpret user trading prompt and generate strategies
        """
        try:
            prompt = f"""
User Request: "{user_prompt}"
Account Balance: ${account_balance}
Current Market Data: {json.dumps(market_data) if market_data else 'Not provided'}

Please analyze this trading request and provide:
1. Whether trading is recommended now
2. 2-3 specific trading strategies with exact entry/SL/TP levels
3. Risk assessment and position sizing
4. Clear reasoning for each recommendation

Format your response as a JSON object with this structure:
{{
  "should_trade": boolean,
  "confidence": "high|medium|low",
  "reasoning": "explanation of market conditions and recommendation",
  "strategies": [
    {{
      "asset": "EURUSD",
      "entry": 1.1445,
      "stop_loss": 1.1380,
      "take_profit": 1.1530,
      "lot_size": 0.3,
      "risk": "medium",
      "reasoning": "detailed explanation",
      "feasible": true,
      "estimated_gain": 285,
      "trade_type": "EURUSD Swing (H1-D1)"
    }}
  ]
}}"""

            response = self.client.chat.completions.create(
                model="gpt-4",
                messages=[
                    {"role": "system", "content": self.system_prompt},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.7,
                max_tokens=2000
            )

            content = response.choices[0].message.content
            if not content:
                raise Exception("No response from OpenAI")

            # Parse JSON response
            import re
            json_match = re.search(r'\{.*\}', content, re.DOTALL)
            if not json_match:
                raise Exception("Invalid JSON response")

            analysis_data = json.loads(json_match.group())
            
            # Convert to dataclass
            strategies = [
                TradingStrategy(**strategy) 
                for strategy in analysis_data.get('strategies', [])
            ]
            
            return MarketAnalysis(
                should_trade=analysis_data.get('should_trade', False),
                confidence=analysis_data.get('confidence', 'low'),
                reasoning=analysis_data.get('reasoning', ''),
                strategies=strategies
            )

        except Exception as e:
            logger.error(f"OpenAI prompt interpretation failed: {e}")
            
            # Return fallback analysis
            return MarketAnalysis(
                should_trade=False,
                confidence='low',
                reasoning='Unable to analyze market conditions at this time.',
                strategies=[]
            )

    async def generate_journal_entry(
        self,
        event_type: str,
        trade_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Generate natural language journal entry for trade events
        """
        try:
            prompt = f"""
Generate a natural, conversational trade journal entry for this event:

Event Type: {event_type}
Trade Data: {json.dumps(trade_data)}

Write as if you're an experienced trader explaining your decision to a friend. Be:
- Confident but not arrogant
- Clear about reasoning
- Honest about risks and outcomes
- Encouraging when appropriate

Format as JSON:
{{
  "type": "entry|modification|exit|update|pause",
  "title": "Brief descriptive title",
  "message": "Conversational explanation of the decision",
  "confidence": "high|medium|low",
  "timestamp": "{datetime.now().isoformat()}"
}}"""

            response = self.client.chat.completions.create(
                model="gpt-4",
                messages=[
                    {"role": "system", "content": self.system_prompt},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.8,
                max_tokens=500
            )

            content = response.choices[0].message.content
            if not content:
                raise Exception("No response from OpenAI")

            import re
            json_match = re.search(r'\{.*\}', content, re.DOTALL)
            if not json_match:
                raise Exception("Invalid JSON response")

            return json.loads(json_match.group())

        except Exception as e:
            logger.error(f"Journal entry generation failed: {e}")
            
            # Return fallback entry
            return {
                "type": "update",
                "title": "Trade Update",
                "message": "Trade activity recorded. Analysis temporarily unavailable.",
                "confidence": "medium",
                "timestamp": datetime.now().isoformat()
            }

    async def assess_feasibility(
        self,
        user_goal: str,
        account_balance: float,
        risk_tolerance: str
    ) -> Dict[str, Any]:
        """
        Assess if user's trading goal is realistic and safe
        """
        try:
            prompt = f"""
User Goal: "{user_goal}"
Account Balance: ${account_balance}
Risk Tolerance: {risk_tolerance}

Assess if this goal is realistic and safe. Consider:
- Position sizing limits (max 2% risk per trade for low, 5% for medium, 10% for high)
- Typical forex returns and volatility
- Time frame requirements
- Market conditions

Provide honest feedback and alternatives if needed.

Format as JSON:
{{
  "feasible": boolean,
  "reasoning": "clear explanation of why it is/isn't feasible",
  "alternatives": ["alternative suggestion 1", "alternative suggestion 2"]
}}"""

            response = self.client.chat.completions.create(
                model="gpt-4",
                messages=[
                    {"role": "system", "content": self.system_prompt},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.6,
                max_tokens=800
            )

            content = response.choices[0].message.content
            if not content:
                raise Exception("No response from OpenAI")

            import re
            json_match = re.search(r'\{.*\}', content, re.DOTALL)
            if not json_match:
                raise Exception("Invalid JSON response")

            return json.loads(json_match.group())

        except Exception as e:
            logger.error(f"Feasibility assessment failed: {e}")
            
            return {
                "feasible": False,
                "reasoning": "Unable to assess goal feasibility at this time.",
                "alternatives": ["Please try again with a more specific goal."]
            }

# Global instance
pipnosis_ai = PipnosisAI()

def main():
    """Test the OpenAI integration"""
    import asyncio
    
    async def test():
        # Test prompt interpretation
        analysis = await pipnosis_ai.interpret_prompt(
            "Make me $500 this week with medium risk",
            10000.0,
            [{"symbol": "EURUSD", "price": 1.1425, "trend": "up"}]
        )
        
        print("Analysis:", analysis)
        
        # Test journal entry generation
        journal = await pipnosis_ai.generate_journal_entry(
            "trade_entry",
            {"symbol": "EURUSD", "action": "buy", "price": 1.1425}
        )
        
        print("Journal:", journal)

    asyncio.run(test())

if __name__ == "__main__":
    main()