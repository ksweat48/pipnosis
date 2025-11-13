import { supabase } from '../lib/supabase';

export type NotificationType = 'success' | 'error' | 'warning' | 'info' | 'trade';
export type SoundType = 'notification' | 'alarm' | 'trade_entry' | 'trade_exit';

interface NotificationPreferences {
  browserEnabled: boolean;
  soundEnabled: boolean;
  volume: number;
  doNotDisturb: boolean;
  quietHoursStart?: number;
  quietHoursEnd?: number;
}

class NotificationManager {
  private audioContext: AudioContext | null = null;
  private preferences: NotificationPreferences = {
    browserEnabled: true,
    soundEnabled: true,
    volume: 0.7,
    doNotDisturb: false
  };

  constructor() {
    if (typeof window !== 'undefined') {
      this.initializeAudio();
      this.loadPreferences();
    }
  }

  private initializeAudio(): void {
    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch (error) {
      console.error('Audio initialization failed:', error);
    }
  }

  private loadPreferences(): void {
    const saved = localStorage.getItem('notification_preferences');
    if (saved) {
      this.preferences = { ...this.preferences, ...JSON.parse(saved) };
    }
  }

  async loadUserPreferences(userId: string): Promise<void> {
    try {
      const { data } = await supabase
        .from('sound_preferences')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (data) {
        this.preferences.browserEnabled = data.browser_notifications_enabled ?? true;
        this.preferences.soundEnabled = data.notification_sound_enabled ?? true;
        this.preferences.volume = data.notification_volume ?? 0.7;
      }
    } catch (error) {
      console.error('Error loading user preferences:', error);
    }
  }

  private isQuietHours(): boolean {
    if (!this.preferences.doNotDisturb) return false;
    if (!this.preferences.quietHoursStart || !this.preferences.quietHoursEnd) return false;

    const currentHour = new Date().getHours();
    const { quietHoursStart: start, quietHoursEnd: end } = this.preferences;

    return start < end
      ? currentHour >= start && currentHour < end
      : currentHour >= start || currentHour < end;
  }

  private playBeep(frequency: number, duration: number, type: OscillatorType = 'sine'): void {
    if (!this.preferences.soundEnabled || !this.audioContext) return;

    try {
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }

      const oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      oscillator.frequency.value = frequency;
      oscillator.type = type;

      gainNode.gain.setValueAtTime(this.preferences.volume, this.audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration);

      oscillator.start(this.audioContext.currentTime);
      oscillator.stop(this.audioContext.currentTime + duration);
    } catch (error) {
      console.error('Failed to play audio:', error);
    }
  }

  playSound(type: SoundType): void {
    switch (type) {
      case 'notification':
        this.playBeep(800, 0.15);
        break;
      case 'alarm':
        this.playBeep(600, 0.3, 'sawtooth');
        break;
      case 'trade_entry':
        this.playBeep(800, 0.15);
        setTimeout(() => this.playBeep(1000, 0.15), 150);
        break;
      case 'trade_exit':
        this.playBeep(600, 0.2);
        setTimeout(() => this.playBeep(500, 0.2), 200);
        break;
    }
  }

  private showNotification(title: string, body: string, options?: NotificationOptions): void {
    if (!this.preferences.browserEnabled || this.isQuietHours()) return;
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    try {
      const notification = new Notification(title, {
        body,
        icon: '/Pipnosis icon.png',
        ...options
      });

      setTimeout(() => notification.close(), 5000);
    } catch (error) {
      console.error('Failed to show notification:', error);
    }
  }

  async notify(title: string, body: string, type: NotificationType = 'info'): Promise<void> {
    this.showNotification(title, body);

    const soundMap: Record<NotificationType, SoundType> = {
      success: 'notification',
      error: 'alarm',
      warning: 'alarm',
      info: 'notification',
      trade: 'trade_entry'
    };

    this.playSound(soundMap[type]);
  }

  async requestPermission(): Promise<boolean> {
    if (typeof window === 'undefined' || !('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;

    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }

  setPreferences(prefs: Partial<NotificationPreferences>): void {
    this.preferences = { ...this.preferences, ...prefs };
    localStorage.setItem('notification_preferences', JSON.stringify(this.preferences));
  }

  getPreferences(): NotificationPreferences {
    return { ...this.preferences };
  }
}

export const notificationManager = new NotificationManager();
