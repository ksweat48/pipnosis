import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { globalDialogManager, DialogData } from '../services/global-dialog-manager';
import { audioAlertService } from '../services/audio-alert-service';
import { GoalAchievedDialog } from '../components/GoalAchievedDialog';
import { TradeClosedActionDialog } from '../components/TradeClosedActionDialog';
import { TradeSignalNotificationBar } from '../components/TradeSignalNotificationBar';
import { TradeEntryModal } from '../components/TradeEntryModal';

interface GlobalDialogContextType {
  showGoalAchieved: (data: any) => void;
  showTradeClosed: (data: any) => void;
  showTradeSignal: (data: any, priority?: 'low' | 'medium' | 'high') => void;
  showTradeEntry: (data: any, priority?: 'low' | 'medium' | 'high' | 'urgent') => void;
  closeDialog: () => void;
}

const GlobalDialogContext = createContext<GlobalDialogContextType | undefined>(undefined);

export function GlobalDialogProvider({ children }: { children: React.ReactNode }) {
  const [currentDialog, setCurrentDialog] = useState<DialogData | null>(null);

  useEffect(() => {
    const handleDialog = (dialog: DialogData | null) => {
      setCurrentDialog(dialog);

      if (dialog) {
        const playAudio = async () => {
          const tradeId = dialog.data?.tradeId || dialog.data?.trade_id || '';
          const symbol = dialog.data?.symbol || '';
          const contextKey = `dialog-${symbol}`;

          switch (dialog.type) {
            case 'goal_achieved':
              await audioAlertService.playWithContext({
                type: 'critical',
                sessionId: dialog.data?.sessionId || '',
                context: 'goal_achieved'
              });
              break;
            case 'trade_entry':
              await audioAlertService.playWithContext({
                type: 'attention',
                tradeId,
                context: contextKey
              });
              break;
            case 'trade_closed': {
              const profitLoss = dialog.data?.profitLoss || 0;
              await audioAlertService.playWithContext({
                type: profitLoss >= 0 ? 'success' : 'warning',
                tradeId,
                context: contextKey
              });
              break;
            }
            case 'trade_signal':
              await audioAlertService.playWithContext({
                type: 'attention',
                context: contextKey
              });
              break;
          }
        };

        playAudio().catch((error) => {
          console.error('[GlobalDialog] Failed to play audio:', error);
        });
      }
    };

    globalDialogManager.onDialog(handleDialog);

    return () => {
      globalDialogManager.offDialog(handleDialog);
    };
  }, []);

  const showGoalAchieved = useCallback((data: any) => {
    globalDialogManager.showGoalAchieved(data);
  }, []);

  const showTradeClosed = useCallback((data: any) => {
    globalDialogManager.showTradeClosed(data);
  }, []);

  const showTradeSignal = useCallback((data: any, priority: 'low' | 'medium' | 'high' = 'high') => {
    globalDialogManager.showTradeSignal(data, priority);
  }, []);

  const showTradeEntry = useCallback((data: any, priority: 'low' | 'medium' | 'high' | 'urgent' = 'urgent') => {
    globalDialogManager.showTradeEntry(data, priority);
  }, []);

  const closeDialog = useCallback(() => {
    globalDialogManager.closeDialog();
  }, []);

  return (
    <GlobalDialogContext.Provider
      value={{
        showGoalAchieved,
        showTradeClosed,
        showTradeSignal,
        showTradeEntry,
        closeDialog
      }}
    >
      {children}

      {currentDialog?.type === 'goal_achieved' && (
        <GoalAchievedDialog
          isOpen={true}
          goalAmount={currentDialog.data.goalAmount}
          achievedProfit={currentDialog.data.achievedProfit}
          symbol={currentDialog.data.symbol}
          timeElapsed={currentDialog.data.timeElapsed}
          tradesExecuted={currentDialog.data.tradesExecuted}
          onStartNewSession={currentDialog.data.onStartNewSession || (() => {})}
          onViewAchievements={currentDialog.data.onViewAchievements || (() => {})}
          onClose={closeDialog}
        />
      )}

      {currentDialog?.type === 'trade_closed' && (
        <TradeClosedActionDialog
          isOpen={true}
          symbol={currentDialog.data.symbol}
          direction={currentDialog.data.direction}
          entryPrice={currentDialog.data.entryPrice}
          exitPrice={currentDialog.data.exitPrice}
          profitLoss={currentDialog.data.profitLoss}
          closeReason={currentDialog.data.closeReason}
          stopLoss={currentDialog.data.stopLoss}
          takeProfit={currentDialog.data.takeProfit}
          currentProgress={currentDialog.data.currentProgress || 0}
          targetValue={currentDialog.data.targetValue || 0}
          tradesInSession={currentDialog.data.tradesInSession || 0}
          isGoalAchieved={currentDialog.data.isGoalAchieved || false}
          timestamp={currentDialog.data.timestamp}
          onStartNewSession={currentDialog.data.onStartNewSession || (() => {})}
          onContinueSession={currentDialog.data.onContinueSession || (() => {})}
          onCloseForNow={async () => {
            const sessionId = currentDialog.data.sessionId;
            if (sessionId) {
              try {
                const { goalSessionStateMachine } = await import('../services/coordinators/goal-session-state-machine');
                await goalSessionStateMachine.transition(sessionId, 'stopped', {
                  reason: 'User did not respond to trade closure dialog',
                  triggeredBy: 'TradeClosedActionDialog',
                });
              } catch (e) {
                console.error('[useGlobalDialog] Failed to stop session on timeout:', e);
              }
            }
            closeDialog();
          }}
          isLoading={currentDialog.data.isLoading || false}
        />
      )}

      {currentDialog?.type === 'trade_signal' &&
       currentDialog.data?.symbol &&
       currentDialog.data.symbol !== 'Unknown' &&
       currentDialog.data.entryPrice > 0 && (
        <TradeSignalNotificationBar
          signal={currentDialog.data}
          onDismiss={closeDialog}
          position="top"
        />
      )}

      {currentDialog?.type === 'trade_entry' && (
        <TradeEntryModal
          isOpen={true}
          symbol={currentDialog.data.symbol}
          direction={currentDialog.data.direction}
          entryPrice={currentDialog.data.entryPrice}
          stopLoss={currentDialog.data.stopLoss}
          takeProfit={currentDialog.data.takeProfit}
          lotSize={currentDialog.data.lotSize}
          confidence={currentDialog.data.confidence}
          priority={currentDialog.data.priority || 'urgent'}
          setupType={currentDialog.data.setupType}
          reasoning={currentDialog.data.reasoning}
          expectedProfit={currentDialog.data.expectedProfit}
          riskReward={currentDialog.data.riskReward}
          autoExecuted={currentDialog.data.autoExecuted}
          tp1={currentDialog.data.tp1}
          tp2={currentDialog.data.tp2}
          tp1Confidence={currentDialog.data.tp1Confidence}
          onDismiss={closeDialog}
        />
      )}
    </GlobalDialogContext.Provider>
  );
}

export function useGlobalDialog() {
  const context = useContext(GlobalDialogContext);
  if (!context) {
    throw new Error('useGlobalDialog must be used within GlobalDialogProvider');
  }
  return context;
}
