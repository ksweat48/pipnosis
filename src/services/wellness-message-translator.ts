/**
 * Wellness Message Translator
 *
 * Converts technical trading jargon into user-friendly, actionable messages
 * that anyone can understand without trading knowledge
 */

export interface TechnicalWellnessData {
  minutesInTrade: number;
  riskRatio: number; // e.g., -0.25 = down 25% of risk, +0.50 = up 50% of risk
  dollarPnL: number;
  status: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'CONCERNING' | 'EXIT_NOW' | null;
  recommendation: 'HOLD' | 'TRAIL_SL' | 'REDUCE_RISK' | 'CLOSE' | null;
  confidence: number;
  technicalNote?: string;
}

export interface UserFriendlyMessage {
  title: string;
  message: string;
  actionableAdvice: string;
  statusEmoji: string;
  priority: 'routine' | 'important' | 'urgent';
  showNotification: boolean; // Should this trigger a notification?
  educationalTooltip?: string;
}

class WellnessMessageTranslator {
  /**
   * Translate technical wellness data into user-friendly message
   */
  translateWellnessCheck(data: TechnicalWellnessData): UserFriendlyMessage {
    const { minutesInTrade, riskRatio, dollarPnL, status, recommendation, confidence } = data;

    // Determine priority and whether to show notification
    const priority = this.determinePriority(status, riskRatio);
    const showNotification = this.shouldNotify(status, riskRatio, minutesInTrade);

    // Build user-friendly message
    const timeDescription = this.formatTradeTime(minutesInTrade);
    const profitStatus = this.describeProfitStatus(riskRatio, dollarPnL);
    const statusDescription = this.describeStatus(status, confidence);
    const advice = this.getActionableAdvice(status, recommendation, riskRatio);

    // Create title
    const title = this.createTitle(status, riskRatio);

    // Create message
    const message = `Your trade has been running for ${timeDescription}. ${profitStatus}. ${statusDescription}`;

    // Status emoji
    const statusEmoji = this.getStatusEmoji(status);

    // Educational tooltip
    const educationalTooltip = this.getEducationalTooltip(status, riskRatio);

    return {
      title,
      message,
      actionableAdvice: advice,
      statusEmoji,
      priority,
      showNotification,
      educationalTooltip
    };
  }

  /**
   * Format trade time in user-friendly way
   */
  private formatTradeTime(minutes: number): string {
    if (minutes < 1) return 'less than a minute';
    if (minutes < 60) return `${Math.floor(minutes)} minute${minutes !== 1 ? 's' : ''}`;

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = Math.floor(minutes % 60);

    if (hours < 1) return `${Math.floor(minutes)} minutes`;
    if (remainingMinutes === 0) return `${hours} hour${hours !== 1 ? 's' : ''}`;

    return `${hours} hour${hours !== 1 ? 's' : ''} and ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}`;
  }

  /**
   * Describe profit/loss status in plain English
   */
  private describeProfitStatus(riskRatio: number, dollarPnL: number): string {
    const absAmount = Math.abs(dollarPnL);
    const percentOfRisk = Math.abs(riskRatio * 100);

    if (riskRatio > 0.5) {
      // Good profit
      return `You're currently up $${absAmount.toFixed(2)}, which is ${percentOfRisk.toFixed(0)}% of what you risked. Looking good!`;
    } else if (riskRatio > 0) {
      // Small profit
      return `You're currently up $${absAmount.toFixed(2)} (${percentOfRisk.toFixed(0)}% of your risk). Still building momentum`;
    } else if (riskRatio === 0) {
      // Break even
      return `The trade is at break-even right now ($0)`;
    } else if (riskRatio > -0.3) {
      // Small loss - normal
      return `You're currently down $${absAmount.toFixed(2)} (${percentOfRisk.toFixed(0)}% of your risk). This is normal - trades fluctuate`;
    } else if (riskRatio > -0.5) {
      // Moderate loss - needs attention
      return `You're currently down $${absAmount.toFixed(2)} (${percentOfRisk.toFixed(0)}% of your risk). Alpha is monitoring this closely`;
    } else {
      // Large loss - concerning
      return `You're currently down $${absAmount.toFixed(2)} (${percentOfRisk.toFixed(0)}% of your risk). This needs attention`;
    }
  }

  /**
   * Describe status in conversational language
   */
  private describeStatus(status: string | null, confidence: number): string {
    if (!status) return 'Alpha is analyzing your trade';

    switch (status) {
      case 'EXCELLENT':
        return `Alpha says this trade is performing excellently (${confidence}% confident)`;
      case 'GOOD':
        return `Alpha says this trade is looking good (${confidence}% confident)`;
      case 'FAIR':
        return `Alpha says this trade is performing okay, but we're watching it (${confidence}% confident)`;
      case 'CONCERNING':
        return `Alpha is concerned about this trade and recommends taking action (${confidence}% confident)`;
      case 'EXIT_NOW':
        return `Alpha strongly recommends closing this trade now (${confidence}% confident)`;
      default:
        return 'Alpha is evaluating your trade';
    }
  }

  /**
   * Get actionable advice based on status and recommendation
   */
  private getActionableAdvice(
    status: string | null,
    recommendation: string | null,
    riskRatio: number
  ): string {
    // Emergency exit
    if (status === 'EXIT_NOW') {
      return 'Close this trade immediately. The risk is too high and conditions have turned against us.';
    }

    // Concerning - specific advice based on recommendation
    if (status === 'CONCERNING') {
      switch (recommendation) {
        case 'CLOSE':
          return 'Consider closing this trade. The market conditions are not favorable and it\'s better to protect your capital.';
        case 'REDUCE_RISK':
          return 'Consider tightening your stop loss to reduce risk. This will limit potential losses while keeping the trade open.';
        case 'TRAIL_SL':
          return 'Consider moving your stop loss to break-even or into profit. This locks in gains and removes risk.';
        default:
          return 'Alpha is concerned - be ready to act if conditions worsen. Watch for updates.';
      }
    }

    // Fair - gentle recommendations
    if (status === 'FAIR') {
      if (riskRatio > 0.3) {
        return 'Your trade is in profit. Consider moving your stop loss to protect gains.';
      }
      return 'Continue monitoring. Alpha will alert you if anything changes that requires action.';
    }

    // Good/Excellent - positive reinforcement
    if (status === 'GOOD' || status === 'EXCELLENT') {
      if (riskRatio > 0.5) {
        return 'Great trade! Consider trailing your stop loss to lock in profits while letting winners run.';
      }
      return 'Trade is performing well. Stay patient and let it develop. Alpha is watching.';
    }

    // Default advice
    if (riskRatio >= 0) {
      return 'Trade is in profit. Stay patient and let Alpha monitor for you.';
    } else if (riskRatio > -0.3) {
      return 'Trade is slightly down but this is normal. Alpha will alert you if action is needed.';
    } else {
      return 'Trade is down more than expected. Alpha is monitoring closely and will recommend action if needed.';
    }
  }

  /**
   * Create a concise title for the wellness check
   */
  private createTitle(status: string | null, riskRatio: number): string {
    if (status === 'EXIT_NOW') return 'Action Needed: Close Trade';
    if (status === 'CONCERNING') return 'Trade Needs Attention';
    if (status === 'FAIR') return 'Trade Check-In';

    if (riskRatio > 0.5) return 'Trade Looking Great';
    if (riskRatio > 0) return 'Trade In Profit';
    if (riskRatio === 0) return 'Trade At Break-Even';
    if (riskRatio > -0.3) return 'Trade Update';

    return 'Trade Status Check';
  }

  /**
   * Get appropriate emoji for status
   */
  private getStatusEmoji(status: string | null): string {
    switch (status) {
      case 'EXCELLENT': return '🟢';
      case 'GOOD': return '🟢';
      case 'FAIR': return '🟡';
      case 'CONCERNING': return '🟠';
      case 'EXIT_NOW': return '🔴';
      default: return '⚪';
    }
  }

  /**
   * Determine priority level
   */
  private determinePriority(
    status: string | null,
    riskRatio: number
  ): 'routine' | 'important' | 'urgent' {
    if (status === 'EXIT_NOW') return 'urgent';
    if (status === 'CONCERNING') return 'important';
    if (riskRatio < -0.5) return 'important';
    return 'routine';
  }

  /**
   * Determine if notification should be shown
   */
  private shouldNotify(
    status: string | null,
    riskRatio: number,
    minutesInTrade: number
  ): boolean {
    // Always notify for urgent situations
    if (status === 'EXIT_NOW') return true;
    if (status === 'CONCERNING') return true;

    // Notify if big profit or loss
    if (Math.abs(riskRatio) > 1.0) return true;

    // Don't notify for routine checks (trade is stable and in GOOD/EXCELLENT status)
    if ((status === 'GOOD' || status === 'EXCELLENT') && Math.abs(riskRatio) < 0.5) {
      return false;
    }

    // Notify for FAIR status only if trade is old (2+ hours)
    if (status === 'FAIR' && minutesInTrade > 120) return true;

    // Don't notify for FAIR status on young trades
    if (status === 'FAIR' && minutesInTrade < 120) return false;

    // Notify for everything else
    return true;
  }

  /**
   * Get educational tooltip explaining the status
   */
  private getEducationalTooltip(status: string | null, riskRatio: number): string {
    const riskExplanation = `Risk Ratio (R): This shows your profit or loss compared to the amount you initially risked. ` +
      `For example, if you risked $100 and you're at +1R, you're up $100. At -0.5R, you're down $50.`;

    switch (status) {
      case 'EXCELLENT':
        return `${riskExplanation}\n\nEXCELLENT means your trade is performing very well with strong market conditions supporting your position.`;
      case 'GOOD':
        return `${riskExplanation}\n\nGOOD means your trade is on track and market conditions are favorable.`;
      case 'FAIR':
        return `${riskExplanation}\n\nFAIR means your trade is performing okay but not optimal. We're monitoring for improvements or signs to exit.`;
      case 'CONCERNING':
        return `${riskExplanation}\n\nCONCERNING means market conditions have changed and your trade may be at risk. Alpha recommends taking protective action.`;
      case 'EXIT_NOW':
        return `${riskExplanation}\n\nEXIT NOW means Alpha has determined that continuing this trade is too risky. Close it to protect your capital.`;
      default:
        return riskExplanation;
    }
  }

  /**
   * Create a short notification message (for browser/toast notifications)
   */
  createShortNotification(data: TechnicalWellnessData): string {
    const { riskRatio, dollarPnL, status } = data;
    const profitText = dollarPnL >= 0 ? `+$${dollarPnL.toFixed(2)}` : `-$${Math.abs(dollarPnL).toFixed(2)}`;

    if (status === 'EXIT_NOW') {
      return `Close trade now - Down ${profitText}`;
    }
    if (status === 'CONCERNING') {
      return `Trade needs attention - ${profitText}`;
    }
    if (riskRatio > 1.0) {
      return `Great profit! Up ${profitText}`;
    }

    return `Trade update: ${profitText}`;
  }
}

export const wellnessMessageTranslator = new WellnessMessageTranslator();
