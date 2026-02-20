import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { globalDialogManager, DialogData } from '../services/global-dialog-manager';
import { audioAlertService } from '../services/audio-alert-service';
import { supabase } from '../lib/supabase';
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
        // SSOT FIX (2026-02-14): Skip audio for queue-advanced dialogs
        if (dialog._fromQueue) {
          console.debug('[GlobalDialog] Skipping audio for queue-advanced dialog');
          return;
        }

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

  /**
   * CCIP FIX (2026-02-20): Trade decline void handler
   * Calls the void_trade_on_user_decline RPC which hard-deletes the trade row,
   * removes associated notifications/entry_intents, and stops the session cleanly.
   * No balance, journal, AI learning, or scoring impact occurs.
   */
  const handleTradeDecline = useCallback(async (tradeId: string, sessionId: string) => {
    if (!tradeId || !sessionId) {
      console.warn('[useGlobalDialog] handleTradeDecline: missing tradeId or sessionId');
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) {
        console.error('[useGlobalDialog] handleTradeDecline: no authenticated user');
        return;
      }

      console.log('[useGlobalDialog] User declined trade — voiding without record:', { tradeId, sessionId });

      const { data, error } = await supabase.rpc('void_trade_on_user_decline', {
        p_trade_id: tradeId,
        p_session_id: sessionId,
        p_user_id: user.id
      });

      if (error) {
        console.error('[useGlobalDialog] void_trade_on_user_decline RPC error:', error);
        return;
      }

      const result = data as { success: boolean; error?: string };
      if (!result?.success) {
        console.error('[useGlobalDialog] void_trade_on_user_decline returned failure:', result?.error);
        return;
      }

      console.log('[useGlobalDialog] Trade voided and session stopped cleanly. User can start a new session.');
    } catch (err) {
      console.error('[useGlobalDialog] handleTradeDecline unexpected error:', err);
    }
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
          onAccept={closeDialog}
          onDecline={
            currentDialog.data.tradeId && currentDialog.data.sessionId
              ? () => handleTradeDecline(
                  currentDialog.data.tradeId,
                  currentDialog.data.sessionId
                )
              : undefined
          }
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
