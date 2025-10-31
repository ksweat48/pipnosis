export class AIConversationComposer {
  composeGreeting(goalType: string, targetValue: number, timeframe: string): string {
    const messages = [
      `Let's make this happen! I'll help you reach $${targetValue} over the next ${timeframe}.`,
      `Goal activated: $${targetValue} in ${timeframe}. I'm already scanning markets for the best opportunities.`,
      `Perfect! I'm now focused on earning you $${targetValue} by the end of this ${timeframe}.`,
    ];
    return this.selectRandom(messages);
  }

  composeScanningUpdate(symbol: string, momentum: number): string {
    if (momentum > 70) {
      return `Interesting movement on ${symbol} — momentum building. Watching for entry confirmation...`;
    } else if (momentum > 50) {
      return `Monitoring ${symbol}. Price action developing, but waiting for stronger confirmation.`;
    }
    return `${symbol} scan complete. No valid setup yet, continuing analysis on other pairs.`;
  }

  composeNoSetupMessage(nextScanMinutes: number): string {
    const messages = [
      `Markets are quiet right now. I'll check again in ${nextScanMinutes} minutes when volatility typically increases.`,
      `No valid setups yet, but that's good — I'm being selective to protect your capital. Next scan in ${nextScanMinutes} minutes.`,
      `Patience pays off in trading. Waiting ${nextScanMinutes} minutes for better market conditions before scanning again.`,
    ];
    return this.selectRandom(messages);
  }

  composeSetupFormingForecast(symbol: string, minutes: number, confidence: number): string {
    return `Setup forming on ${symbol}! Price converging with key levels. Expected entry opportunity in ${minutes} minutes (${confidence}% confidence). Stay ready.`;
  }

  composeTradeSignalAnnouncement(
    symbol: string,
    direction: string,
    confidence: number,
    expectedProfit: number,
    progressContribution: number
  ): string {
    const emoji = direction === 'buy' ? '📈' : '📉';
    return `${emoji} Found high-quality ${direction.toUpperCase()} setup on ${symbol} (${confidence}% confidence). Expected profit: $${expectedProfit.toFixed(2)} — that's ${progressContribution.toFixed(0)}% of your goal! Review the details and let me know if you want to execute.`;
  }

  composeTradeProgressUpdate(symbol: string, plPercentage: number, currentPL: number): string {
    if (plPercentage >= 75) {
      return `Excellent! ${symbol} is ${plPercentage.toFixed(0)}% to target. Current profit: $${currentPL.toFixed(2)}. Consider securing partial gains.`;
    } else if (plPercentage >= 50) {
      return `Halfway there on ${symbol}! Trade is ${plPercentage.toFixed(0)}% to target with $${currentPL.toFixed(2)} profit. Momentum looking strong.`;
    } else if (plPercentage >= 25) {
      return `${symbol} progressing nicely at ${plPercentage.toFixed(0)}% to target. Current P/L: $${currentPL.toFixed(2)}. Holding position.`;
    }
    return `${symbol} trade active. Current P/L: $${currentPL.toFixed(2)}. Monitoring price action closely.`;
  }

  composeEarlyExitRecommendation(symbol: string, reason: string, currentPL: number): string {
    return `⚠️ Recommendation for ${symbol}: ${reason}. Current position: ${currentPL >= 0 ? '+' : ''}$${currentPL.toFixed(2)}. Consider closing early to ${currentPL >= 0 ? 'secure profits' : 'minimize loss'}.`;
  }

  composeGoalProgress(currentProgress: number, target: number, percentage: number): string {
    if (percentage >= 100) {
      return `🎉 Goal achieved! You've reached $${currentProgress.toFixed(2)} of your $${target} target. Fantastic trading! Would you like to continue or secure your profits?`;
    } else if (percentage >= 75) {
      return `Almost there! You're at $${currentProgress.toFixed(2)} (${percentage.toFixed(1)}%) of your $${target} goal. Just one more good trade could seal it!`;
    } else if (percentage >= 50) {
      return `Halfway point reached! Current progress: $${currentProgress.toFixed(2)} (${percentage.toFixed(1)}%). Maintaining discipline and scanning for quality setups.`;
    } else if (percentage >= 25) {
      return `Good start! You're at $${currentProgress.toFixed(2)} (${percentage.toFixed(1)}%) toward $${target}. Building momentum with each trade.`;
    }
    return `Progress update: $${currentProgress.toFixed(2)} of $${target} (${percentage.toFixed(1)}%). Continuing to scan for high-probability setups.`;
  }

  composeSessionSummary(
    goalAchieved: boolean,
    finalProfit: number,
    winRate: number,
    totalTrades: number,
    strongestPattern: string
  ): string {
    if (goalAchieved) {
      return `🎯 Session complete — goal achieved! Final profit: $${finalProfit.toFixed(2)} across ${totalTrades} trades with a ${winRate.toFixed(0)}% win rate. Your strongest pattern was ${strongestPattern}. Excellent execution!`;
    } else {
      return `Session completed. Final result: $${finalProfit.toFixed(2)} across ${totalTrades} trades (${winRate.toFixed(0)}% win rate). ${strongestPattern} showed the most promise. Key takeaway: Stay disciplined and patient — quality over quantity always wins.`;
    }
  }

  composeMotivationalMessage(stage: 'beginning' | 'middle' | 'challenging' | 'near_completion'): string {
    const messages = {
      beginning: [
        'Starting strong! Remember, patience and discipline win in trading.',
        'Let\'s approach this systematically. Quality setups only — no rushing.',
        'Market opportunities come to those who wait. I\'ll find the best entries for you.',
      ],
      middle: [
        'Steady progress! Every trade is a step closer to your goal.',
        'Maintaining our systematic approach. Consistency is key.',
        'Good momentum. Let\'s keep the same disciplined approach.',
      ],
      challenging: [
        'Market conditions can be unpredictable. Staying patient and selective is the right move.',
        'Not every session goes perfectly, and that\'s okay. Capital preservation is priority one.',
        'Remember: protecting your capital is as important as growing it. I\'m being selective for good reason.',
      ],
      near_completion: [
        'You\'re so close! One more solid setup could achieve your goal.',
        'Final stretch! Maintaining discipline even when near the finish line.',
        'Almost there! Let\'s finish strong with a quality trade.',
      ],
    };

    return this.selectRandom(messages[stage]);
  }

  composeEducationalInsight(topic: 'risk_management' | 'pattern_recognition' | 'market_timing' | 'psychology'): string {
    const insights = {
      risk_management: 'Risk management tip: Never risk more than 2% of your account on a single trade. This ensures you can weather losing streaks and stay in the game.',
      pattern_recognition: 'Pattern insight: The best setups often come when price tests a key level multiple times. This shows respect for that level and increases probability of a bounce.',
      market_timing: 'Timing matters: Major forex pairs are most active during London and New York sessions. Volatility = opportunity.',
      psychology: 'Trading psychology: The hardest part of trading is doing nothing when there are no good setups. Patience is a skill that separates profitable traders from the rest.',
    };

    return insights[topic];
  }

  private selectRandom<T>(array: T[]): T {
    return array[Math.floor(Math.random() * array.length)];
  }
}

export const aiConversationComposer = new AIConversationComposer();
