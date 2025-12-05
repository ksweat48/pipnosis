import TinyEmitter from 'tiny-emitter';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastMessage {
  type: ToastType;
  title: string;
  message: string;
  duration?: number;
}

class GlobalToastManager {
  private emitter = new TinyEmitter();

  showToast(type: ToastType, title: string, message: string, duration?: number) {
    this.emitter.emit('toast', { type, title, message, duration });
  }

  success(title: string, message: string, duration?: number) {
    this.showToast('success', title, message, duration);
  }

  error(title: string, message: string, duration?: number) {
    this.showToast('error', title, message, duration);
  }

  warning(title: string, message: string, duration?: number) {
    this.showToast('warning', title, message, duration);
  }

  info(title: string, message: string, duration?: number) {
    this.showToast('info', title, message, duration);
  }

  onToast(callback: (toast: ToastMessage) => void) {
    this.emitter.on('toast', callback);
  }

  offToast(callback: (toast: ToastMessage) => void) {
    this.emitter.off('toast', callback);
  }
}

export const globalToastManager = new GlobalToastManager();
