/**
 * Backtest Notification Service
 * Handles browser notifications and sound alerts for backtest events
 */

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface NotificationPreferences {
  browserNotifications: boolean;
  soundNotifications: boolean;
  notifyOnComplete: boolean;
  notifyOnFailure: boolean;
  notifyOnCooldown: boolean;
  doNotDisturb: boolean;
  quietHoursStart?: number; // Hour 0-23
  quietHoursEnd?: number; // Hour 0-23
}

class BacktestNotificationService {
  private audioContext: AudioContext | null = null;
  private preferences: NotificationPreferences = {
    browserNotifications: true,
    soundNotifications: true,
    notifyOnComplete: true,
    notifyOnFailure: true,
    notifyOnCooldown: false,
    doNotDisturb: false
  };

  constructor() {
    this.initializeAudioContext();
    this.loadPreferences();
  }

  private initializeAudioContext(): void {
    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch (err) {
      console.warn('[Notification Service] AudioContext not supported:', err);
    }
  }

  private loadPreferences(): void {
    try {
      const saved = localStorage.getItem('backtest_notification_preferences');
      if (saved) {
        this.preferences = { ...this.preferences, ...JSON.parse(saved) };
      }
    } catch (err) {
      console.error('[Notification Service] Error loading preferences:', err);
    }
  }

  savePreferences(preferences: Partial<NotificationPreferences>): void {
    this.preferences = { ...this.preferences, ...preferences };
    try {
      localStorage.setItem('backtest_notification_preferences', JSON.stringify(this.preferences));
    } catch (err) {
      console.error('[Notification Service] Error saving preferences:', err);
    }
  }

  getPreferences(): NotificationPreferences {
    return { ...this.preferences };
  }

  async requestPermission(): Promise<boolean> {
    if (!('Notification' in window)) {
      console.warn('[Notification Service] Browser does not support notifications');
      return false;
    }

    if (Notification.permission === 'granted') {
      return true;
    }

    if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    }

    return false;
  }

  private isQuietHours(): boolean {
    if (!this.preferences.doNotDisturb) return false;
    if (this.preferences.quietHoursStart === undefined || this.preferences.quietHoursEnd === undefined) {
      return false;
    }

    const now = new Date();
    const currentHour = now.getHours();
    const start = this.preferences.quietHoursStart;
    const end = this.preferences.quietHoursEnd;

    if (start < end) {
      return currentHour >= start && currentHour < end;
    } else {
      // Handles cases like 22:00 to 06:00
      return currentHour >= start || currentHour < end;
    }
  }

  private shouldNotify(eventType: 'complete' | 'failure' | 'cooldown'): boolean {
    if (this.isQuietHours()) return false;

    switch (eventType) {
      case 'complete':
        return this.preferences.notifyOnComplete;
      case 'failure':
        return this.preferences.notifyOnFailure;
      case 'cooldown':
        return this.preferences.notifyOnCooldown;
      default:
        return false;
    }
  }

  private async showBrowserNotification(
    title: string,
    body: string,
    icon?: string,
    onClick?: () => void
  ): Promise<void> {
    if (!this.preferences.browserNotifications) return;
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    try {
      const notification = new Notification(title, {
        body,
        icon: icon || '/Pipnosis icon.png',
        badge: '/Pipnosis icon.png',
        tag: 'backtest-notification',
        requireInteraction: false
      });

      if (onClick) {
        notification.onclick = () => {
          window.focus();
          onClick();
          notification.close();
        };
      }

      // Auto-close after 5 seconds
      setTimeout(() => notification.close(), 5000);
    } catch (err) {
      console.error('[Notification Service] Error showing notification:', err);
    }
  }

  private playSound(type: NotificationType): void {
    if (!this.preferences.soundNotifications) return;
    if (!this.audioContext) return;

    try {
      const oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      // Set frequency based on notification type
      switch (type) {
        case 'success':
          // Pleasant ascending chime
          oscillator.frequency.setValueAtTime(523.25, this.audioContext.currentTime); // C5
          oscillator.frequency.setValueAtTime(659.25, this.audioContext.currentTime + 0.1); // E5
          oscillator.frequency.setValueAtTime(783.99, this.audioContext.currentTime + 0.2); // G5
          break;
        case 'error':
          // Lower alert beep
          oscillator.frequency.setValueAtTime(329.63, this.audioContext.currentTime); // E4
          oscillator.frequency.setValueAtTime(293.66, this.audioContext.currentTime + 0.15); // D4
          break;
        case 'warning':
          // Mid-range beep
          oscillator.frequency.setValueAtTime(440, this.audioContext.currentTime); // A4
          break;
        case 'info':
          // Soft tone
          oscillator.frequency.setValueAtTime(523.25, this.audioContext.currentTime); // C5
          break;
      }

      oscillator.type = 'sine';

      // Volume envelope
      gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.3, this.audioContext.currentTime + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.3);

      oscillator.start(this.audioContext.currentTime);
      oscillator.stop(this.audioContext.currentTime + 0.3);
    } catch (err) {
      console.error('[Notification Service] Error playing sound:', err);
    }
  }

  // Public notification methods

  async notifyBacktestComplete(backtestId: string, winRate: number, trades: number): Promise<void> {
    if (!this.shouldNotify('complete')) return;

    const title = 'Backtest Complete';
    const body = `Finished with ${trades} trades and ${winRate.toFixed(1)}% win rate`;

    await this.showBrowserNotification(title, body);
    this.playSound('success');
  }

  async notifyBacktestFailed(backtestId: string, error: string): Promise<void> {
    if (!this.shouldNotify('failure')) return;

    const title = 'Backtest Failed';
    const body = `Error: ${error}`;

    await this.showBrowserNotification(title, body);
    this.playSound('error');
  }

  async notifyCooldownStarted(durationMinutes: number, reason: string): Promise<void> {
    if (!this.shouldNotify('cooldown')) return;

    const title = 'Auto-Backtest Cooldown';
    const body = `System entering ${durationMinutes} minute cooldown. Reason: ${reason}`;

    await this.showBrowserNotification(title, body);
    this.playSound('info');
  }

  async notifyCooldownEnded(): Promise<void> {
    if (!this.shouldNotify('cooldown')) return;

    const title = 'Auto-Backtest Resumed';
    const body = 'Cooldown period complete. Auto-backtest has resumed.';

    await this.showBrowserNotification(title, body);
    this.playSound('success');
  }

  async notifySystemStress(stressScore: number): Promise<void> {
    const title = 'High System Stress';
    const body = `System stress at ${stressScore}%. Early cooldown may trigger.`;

    await this.showBrowserNotification(title, body);
    this.playSound('warning');
  }

  async notifyBacktestStuck(backtestId: string): Promise<void> {
    const title = 'Backtest Stuck';
    const body = 'A backtest appears to be stuck with no progress for 90 seconds.';

    await this.showBrowserNotification(title, body);
    this.playSound('warning');
  }

  // Test notification
  async testNotification(): Promise<void> {
    const hasPermission = await this.requestPermission();
    if (!hasPermission) {
      alert('Browser notifications are not permitted. Please enable them in your browser settings.');
      return;
    }

    await this.showBrowserNotification(
      'Test Notification',
      'Notifications are working correctly!'
    );
    this.playSound('info');
  }
}

export const backtestNotificationService = new BacktestNotificationService();
