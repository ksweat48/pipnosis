import TinyEmitter from 'tiny-emitter';
import { modalNotificationBridge } from './modal-notification-bridge';
import { supabase } from '../lib/supabase';

export type DialogType = 'goal_achieved' | 'trade_closed' | 'trade_signal' | 'trade_entry';

export interface DialogData {
  type: DialogType;
  data: any;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  timestamp: number;
}

class GlobalDialogManager {
  private emitter = new TinyEmitter();
  private dialogQueue: DialogData[] = [];
  private currentDialog: DialogData | null = null;

  async showDialog(type: DialogType, data: any, priority: 'low' | 'medium' | 'high' = 'medium') {
    const dialogData: DialogData = {
      type,
      data,
      priority,
      timestamp: Date.now()
    };

    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const goalSessionId = data.goal_session_id || data.goalSessionId || null;
      await modalNotificationBridge.captureDialog(dialogData, user.id, goalSessionId);
    }

    if (this.currentDialog) {
      this.dialogQueue.push(dialogData);
    } else {
      this.currentDialog = dialogData;
      this.emitter.emit('dialog', dialogData);
    }
  }

  showGoalAchieved(data: any) {
    this.showDialog('goal_achieved', data, 'high');
  }

  showTradeClosed(data: any) {
    this.showDialog('trade_closed', data, 'medium');
  }

  showTradeSignal(data: any, priority: 'low' | 'medium' | 'high' = 'high') {
    this.showDialog('trade_signal', data, priority);
  }

  showTradeEntry(data: any, priority: 'low' | 'medium' | 'high' | 'urgent' = 'urgent') {
    this.showDialog('trade_entry', data, priority);
  }

  closeDialog() {
    this.currentDialog = null;

    if (this.dialogQueue.length > 0) {
      const nextDialog = this.dialogQueue.shift();
      if (nextDialog) {
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
