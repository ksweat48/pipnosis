import TinyEmitter from 'tiny-emitter';
import { modalNotificationBridge } from './modal-notification-bridge';
import { supabase } from '../lib/supabase';

export type DialogType = 'trade_closed' | 'trade_signal' | 'trade_entry' | 'multi_trade_entry' | 'tp1_hit' | 'alpha_intent';

// SSOT FIX (2026-02-04): Align with database constraint - use 'critical' not 'urgent'
export type DialogPriority = 'low' | 'medium' | 'high' | 'critical';

export interface DialogData {
  type: DialogType;
  data: any;
  priority?: DialogPriority;
  timestamp: number;
  _fromQueue?: boolean; // Internal flag: true when dialog is auto-advanced from queue
}

export interface ShowDialogOptions {
  skipPersist?: boolean; // When true, skip database insert (notification already exists)
}

class GlobalDialogManager {
  private emitter = new TinyEmitter();
  private dialogQueue: DialogData[] = [];
  private currentDialog: DialogData | null = null;
  private recentDialogs = new Set<string>();
  private readonly DEDUPE_WINDOW_MS = 30000; // 30 second deduplication window — covers Supabase Realtime propagation delay (~3s) plus browser event queue

  // CCIP (2026-03-01): Multi-trade batching — collect simultaneous trade_entry events
  // within BATCH_WINDOW_MS and coalesce into a single multi_trade_entry dialog.
  private pendingBatchTrades: any[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly BATCH_WINDOW_MS = 2000;

  private createDedupeKey(type: DialogType, data: any): string {
    const symbol = data.symbol || '';
    // CCIP FIX (2026-02-19): Include tradeId/sessionId in dedup key so the same
    // trade closure cannot show twice across different code paths (persistent modal
    // queue path vs. trade_closure_events Realtime path). Previously keyed only on
    // type+symbol, which allowed a second modal when the Realtime event arrived ~3s
    // after the first modal was already dismissed.
    const tradeId = data.tradeId || data.trade_id || '';
    const sessionId = data.sessionId || data.goal_session_id || '';
    if (tradeId) return `${type}-${tradeId}`;
    if (sessionId && symbol) return `${type}-${sessionId}-${symbol}`;
    return `${type}-${symbol}`;
  }

  async showDialog(
    type: DialogType,
    data: any,
    priority: DialogPriority = 'medium',
    options: ShowDialogOptions = {}
  ) {
    const dedupeKey = this.createDedupeKey(type, data);

    if (this.recentDialogs.has(dedupeKey)) {
      console.debug('[GlobalDialogManager] Skipping duplicate dialog:', dedupeKey);
      return;
    }

    // Check if identical dialog is already in queue or current
    const isDuplicateInQueue = this.dialogQueue.some(d =>
      this.createDedupeKey(d.type, d.data) === dedupeKey
    );
    const isDuplicateCurrent = this.currentDialog &&
      this.createDedupeKey(this.currentDialog.type, this.currentDialog.data) === dedupeKey;

    if (isDuplicateInQueue || isDuplicateCurrent) {
      console.debug('[GlobalDialogManager] Dialog already queued or displayed:', dedupeKey);
      return;
    }

    // CCIP FIX (2026-03-19 DOUBLE-MODAL): Claim the dedup slot BEFORE any await.
    // Two concurrent callers (trade_closure_events path + goal_notifications path) both
    // pass the has() check simultaneously when showDialog() is async and the key is only
    // added after an await. Adding synchronously here means whichever caller reaches this
    // line first wins; the second caller hits the has() guard at the top on re-entry.
    this.recentDialogs.add(dedupeKey);
    setTimeout(() => this.recentDialogs.delete(dedupeKey), this.DEDUPE_WINDOW_MS);

    const dialogData: DialogData = {
      type,
      data,
      priority,
      timestamp: Date.now()
    };

    // SSOT FIX (2026-02-14): Prevent circular notification inserts
    // When skipPersist=true, the notification record already exists (from realtime listener)
    // DO NOT call captureDialog() - it would create a duplicate goal_notifications insert
    // The notificationCoordinator is SSOT for database inserts
    if (!options.skipPersist) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const goalSessionId = data.goal_session_id || data.goalSessionId || null;
        await modalNotificationBridge.captureDialog(dialogData, user.id, goalSessionId);
      }
    }

    if (this.currentDialog) {
      this.dialogQueue.push(dialogData);
    } else {
      this.currentDialog = dialogData;
      this.emitter.emit('dialog', dialogData);
    }
  }

  showTradeClosed(data: any, options?: ShowDialogOptions) {
    this.showDialog('trade_closed', data, 'medium', options);
  }

  showTradeSignal(data: any, priority: DialogPriority = 'high', options?: ShowDialogOptions) {
    this.showDialog('trade_signal', data, priority, options);
  }

  // SSOT FIX (2026-02-04): Changed 'urgent' to 'critical' to match DB constraint
  showTradeEntry(data: any, priority: DialogPriority = 'critical', options?: ShowDialogOptions) {
    this.showDialog('trade_entry', data, priority, options);
  }

  /**
   * CCIP (2026-03-01): Multi-trade batch entry modal.
   * Each simultaneous trade execution calls this method.
   * Events within BATCH_WINDOW_MS are coalesced into a single multi_trade_entry dialog.
   * After the window elapses, if only one trade was collected it falls back to
   * the standard trade_entry modal; two or more shows the MultiTradeExecutionModal.
   */
  showMultiTradeEntry(tradeData: any, priority: DialogPriority = 'critical', options?: ShowDialogOptions) {
    this.pendingBatchTrades.push(tradeData);

    if (this.batchTimer !== null) {
      clearTimeout(this.batchTimer);
    }

    this.batchTimer = setTimeout(() => {
      this.batchTimer = null;
      const batch = [...this.pendingBatchTrades];
      this.pendingBatchTrades = [];

      if (batch.length === 1) {
        this.showTradeEntry(batch[0], priority, options);
      } else {
        this.showDialog('multi_trade_entry', { trades: batch }, priority, options);
      }
    }, this.BATCH_WINDOW_MS);
  }

  showTP1HitDialog(data: any, priority: DialogPriority = 'critical', options?: ShowDialogOptions) {
    this.showDialog('tp1_hit', data, priority, options);
  }

  showAlphaIntent(data: any, options?: ShowDialogOptions) {
    this.showDialog('alpha_intent', data, 'high', options);
  }

  closeDialog() {
    this.currentDialog = null;

    if (this.dialogQueue.length > 0) {
      const nextDialog = this.dialogQueue.shift();
      if (nextDialog) {
        // SSOT FIX (2026-02-14): Mark queue-advanced dialogs to prevent cascade audio
        // When user clicks "Got It", the next dialog should appear silently
        // Audio should only play for NEW events, not automatic queue advancement
        nextDialog._fromQueue = true;
        this.currentDialog = nextDialog;
        this.emitter.emit('dialog', nextDialog);
      }
    } else {
      this.emitter.emit('dialog', null);
    }
  }

  onDialog(callback: (dialog: DialogData | null) => void) {
    this.emitter.on('dialog', callback);
  }

  offDialog(callback: (dialog: DialogData | null) => void) {
    this.emitter.off('dialog', callback);
  }

  getCurrentDialog(): DialogData | null {
    return this.currentDialog;
  }

  getQueueLength(): number {
    return this.dialogQueue.length;
  }
}

export const globalDialogManager = new GlobalDialogManager();
