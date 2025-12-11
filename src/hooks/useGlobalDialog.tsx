import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { globalDialogManager, DialogData } from '../services/global-dialog-manager';
import { GoalAchievedDialog } from '../components/GoalAchievedDialog';
import { TradeClosedActionDialog } from '../components/TradeClosedActionDialog';
import { TradeSignalNotificationBar } from '../components/TradeSignalNotificationBar';

interface GlobalDialogContextType {
  showGoalAchieved: (data: any) => void;
  showTradeClosed: (data: any) => void;
  showTradeSignal: (data: any, priority?: 'low' | 'medium' | 'high') => void;
  closeDialog: () => void;
}

const GlobalDialogContext = createContext<GlobalDialogContextType | undefined>(undefined);

export function GlobalDialogProvider({ children }: { children: React.ReactNode }) {
  const [currentDialog, setCurrentDialog] = useState<DialogData | null>(null);

  useEffect(() => {
    const handleDialog = (dialog: DialogData | null) => {
      setCurrentDialog(dialog);
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

  const closeDialog = useCallback(() => {
    globalDialogManager.closeDialog();
  }, []);

  return (
    <GlobalDialogContext.Provider
      value={{
        showGoalAchieved,
        showTradeClosed,
        showTradeSignal,
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
          currentProgress={currentDialog.data.currentProgress || 0}
          targetValue={currentDialog.data.targetValue || 0}
          tradesInSession={currentDialog.data.tradesInSession || 0}
          onStartNewSession={currentDialog.data.onStartNewSession || (() => {})}
          onContinueSession={currentDialog.data.onContinueSession || (() => {})}
          onCloseForNow={closeDialog}
          isLoading={currentDialog.data.isLoading || false}
        />
      )}

      {currentDialog?.type === 'trade_signal' && (
        <TradeSignalNotificationBar
          signal={currentDialog.data}
          onDismiss={closeDialog}
          position="top"
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
