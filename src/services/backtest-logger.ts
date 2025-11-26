type LogLevel = 'quiet' | 'normal' | 'verbose';
type LogCategory = 'candles' | 'trades' | 'decisions' | 'errors' | 'summary' | 'progress';

class BacktestLogger {
  private logLevel: LogLevel = 'quiet';
  private isBacktestRunning = false;

  setLogLevel(level: LogLevel) {
    this.logLevel = level;
  }

  getLogLevel(): LogLevel {
    return this.logLevel;
  }

  setBacktestRunning(running: boolean) {
    this.isBacktestRunning = running;
  }

  isBacktesting(): boolean {
    return this.isBacktestRunning;
  }

  shouldLog(category: LogCategory): boolean {
    if (!this.isBacktestRunning) {
      return true;
    }

    switch (this.logLevel) {
      case 'quiet':
        return category === 'trades' || category === 'decisions' || category === 'errors' || category === 'summary';

      case 'normal':
        return category !== 'candles' && category !== 'progress';

      case 'verbose':
        return true;

      default:
        return true;
    }
  }

  log(category: LogCategory, ...args: any[]) {
    if (this.shouldLog(category)) {
      console.log(...args);
    }
  }

  error(category: LogCategory, ...args: any[]) {
    if (this.shouldLog(category)) {
      console.error(...args);
    }
  }

  logTradeDecision(decision: {
    tradeNumber: number;
    action: string;
    symbol: string;
    direction?: string;
    confidence?: number;
    setup?: string;
    rejectReason?: string;
    time?: Date | string;
  }) {
    if (!this.shouldLog('decisions')) return;

    const isExecute = decision.action === 'EXECUTE' || decision.action === 'execute';
    const actionText = isExecute ? '✅ EXECUTE' : '❌ REJECT';

    console.log(`\n${'='.repeat(60)}`);
    console.log(`[TRADE DECISION #${decision.tradeNumber}]`);
    console.log(`Action: ${actionText}`);
    console.log(`Pair: ${decision.symbol}${decision.direction ? ` | Direction: ${decision.direction.toUpperCase()}` : ''}`);

    if (decision.confidence !== undefined) {
      console.log(`Confidence: ${decision.confidence}%${decision.setup ? ` | Setup: ${decision.setup}` : ''}`);
    }

    if (!isExecute && decision.rejectReason) {
      console.log(`Reason: ${decision.rejectReason}`);
    }

    if (decision.time) {
      const timeStr = decision.time instanceof Date ? decision.time.toISOString() : decision.time;
      console.log(`Time: ${timeStr}`);
    }

    console.log(`${'='.repeat(60)}\n`);
  }

  logTradeResult(trade: {
    tradeNumber: number;
    symbol: string;
    direction: string;
    entryPrice: number;
    exitPrice: number;
    pnl: number;
    outcome: string;
    holdingMinutes?: number;
  }) {
    if (!this.shouldLog('trades')) return;

    const outcomeEmoji = trade.outcome === 'win' ? '💰' : trade.outcome === 'loss' ? '💸' : '➖';

    console.log(`${outcomeEmoji} Trade #${trade.tradeNumber} ${trade.outcome.toUpperCase()}`);
    console.log(`   ${trade.symbol} ${trade.direction.toUpperCase()} | Entry: ${trade.entryPrice} → Exit: ${trade.exitPrice}`);
    console.log(`   P&L: $${trade.pnl.toFixed(2)}${trade.holdingMinutes ? ` | Duration: ${trade.holdingMinutes}m` : ''}`);
  }

  logBacktestSummary(summary: {
    sessionName?: string;
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    breakevenTrades?: number;
    winRate: number;
    totalPnL: number;
    profitFactor?: number;
    finalBalance?: number;
  }) {
    if (!this.shouldLog('summary')) return;

    console.log('\n' + '='.repeat(60));
    console.log('BACKTEST COMPLETED');
    if (summary.sessionName) {
      console.log(`Session: ${summary.sessionName}`);
    }
    console.log('='.repeat(60));
    console.log(`📊 Total Trades: ${summary.totalTrades}`);
    console.log(`   ✅ Winning: ${summary.winningTrades}`);
    console.log(`   ❌ Losing: ${summary.losingTrades}`);
    if (summary.breakevenTrades !== undefined && summary.breakevenTrades > 0) {
      console.log(`   ➖ Breakeven: ${summary.breakevenTrades}`);
    }
    console.log(`📈 Win Rate: ${summary.winRate.toFixed(2)}%`);
    console.log(`💰 Total P&L: $${summary.totalPnL.toFixed(2)}`);
    if (summary.profitFactor !== undefined) {
      console.log(`📊 Profit Factor: ${summary.profitFactor.toFixed(2)}`);
    }
    if (summary.finalBalance !== undefined) {
      console.log(`💵 Final Balance: $${summary.finalBalance.toFixed(2)}`);
    }
    console.log('='.repeat(60) + '\n');
  }

  logBacktestStart(config: {
    sessionName: string;
    startDate: Date | string;
    endDate: Date | string;
    symbols: string[];
    mode?: string;
  }) {
    if (!this.shouldLog('summary')) return;

    const startStr = config.startDate instanceof Date ? config.startDate.toISOString().split('T')[0] : config.startDate;
    const endStr = config.endDate instanceof Date ? config.endDate.toISOString().split('T')[0] : config.endDate;

    console.log('\n' + '='.repeat(60));
    console.log('BACKTEST STARTING');
    console.log('='.repeat(60));
    console.log(`Session: ${config.sessionName}`);
    console.log(`Period: ${startStr} to ${endStr}`);
    console.log(`Symbols: ${config.symbols.join(', ')}`);
    if (config.mode) {
      console.log(`Mode: ${config.mode}`);
    }
    console.log('='.repeat(60) + '\n');
  }
}

export const backtestLogger = new BacktestLogger();
