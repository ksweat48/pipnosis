import { supabase } from '../lib/supabase';

export type SoundType = 'notification' | 'alarm';

class SoundNotificationService {
  private audioContext: AudioContext | null = null;
  private notificationSound: HTMLAudioElement | null = null;
  private alarmSound: HTMLAudioElement | null = null;
  private enabled = true;
  private volumes = {
    notification: 0.7,
    alarm: 0.9
  };

  constructor() {
    if (typeof window !== 'undefined') {
      this.initializeAudio();
    }
  }

  private initializeAudio(): void {
    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

      this.notificationSound = new Audio('/sounds/notification.mp3');
      this.alarmSound = new Audio('/sounds/alarm.mp3');

      this.notificationSound.volume = this.volumes.notification;
      this.alarmSound.volume = this.volumes.alarm;

    } catch (error) {
      console.warn('[Sound] Audio initialization failed:', error);
    }
  }

  async loadUserPreferences(userId: string): Promise<void> {
    try {
      const { data, error } = await supabase
        .from('sound_preferences')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        console.error('[Sound] Error loading preferences:', error);
        return;
      }

      if (data) {
        this.enabled = data.notification_sound_enabled && data.alarm_sound_enabled;
        this.volumes.notification = data.notification_volume || 0.7;
        this.volumes.alarm = data.alarm_volume || 0.9;

        if (this.notificationSound) this.notificationSound.volume = this.volumes.notification;
        if (this.alarmSound) this.alarmSound.volume = this.volumes.alarm;
      }
    } catch (error) {
      console.error('[Sound] Error in loadUserPreferences:', error);
    }
  }

  async playNotification(message?: string): Promise<void> {
    if (!this.enabled) return;

    try {
      if (this.audioContext?.state === 'suspended') {
        await this.audioContext.resume();
      }

      if (this.notificationSound) {
        this.notificationSound.currentTime = 0;
        await this.notificationSound.play();
      }

      this.showBrowserNotification('Trade Opportunity', message || 'Executable trade signal found');

    } catch (error) {
      console.warn('[Sound] Notification sound failed:', error);
    }
  }

  async playAlarm(message?: string): Promise<void> {
    if (!this.enabled) return;

    try {
      if (this.audioContext?.state === 'suspended') {
        await this.audioContext.resume();
      }

      if (this.alarmSound) {
        this.alarmSound.currentTime = 0;
        await this.alarmSound.play();
      }

      this.showBrowserNotification('Trade Alert', message || 'Trade execution or exit event', true);

    } catch (error) {
      console.warn('[Sound] Alarm sound failed:', error);
    }
  }

  private showBrowserNotification(title: string, body: string, requireInteraction: boolean = false): void {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return;
    }

    if (Notification.permission === 'granted') {
      new Notification(title, {
        body,
        icon: '/Pipnosis icon.png',
        requireInteraction,
        tag: 'pipnosis-trade'
      });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          new Notification(title, {
            body,
            icon: '/Pipnosis icon.png',
            requireInteraction,
            tag: 'pipnosis-trade'
          });
        }
      });
    }
  }

  async requestNotificationPermission(): Promise<boolean> {
    if (typeof window === 'undefined' || !('Notification' in window)) {
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

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  setVolume(type: SoundType, volume: number): void {
    this.volumes[type] = Math.max(0, Math.min(1, volume));

    if (type === 'notification' && this.notificationSound) {
      this.notificationSound.volume = this.volumes.notification;
    } else if (type === 'alarm' && this.alarmSound) {
      this.alarmSound.volume = this.volumes.alarm;
    }
  }

  async savePreferences(userId: string, preferences: {
    notificationEnabled?: boolean;
    alarmEnabled?: boolean;
    notificationVolume?: number;
    alarmVolume?: number;
    browserNotificationsEnabled?: boolean;
  }): Promise<void> {
    try {
      const { error } = await supabase
        .from('sound_preferences')
        .upsert({
          user_id: userId,
          notification_sound_enabled: preferences.notificationEnabled ?? true,
          alarm_sound_enabled: preferences.alarmEnabled ?? true,
          notification_volume: preferences.notificationVolume ?? this.volumes.notification,
          alarm_volume: preferences.alarmVolume ?? this.volumes.alarm,
          browser_notifications_enabled: preferences.browserNotificationsEnabled ?? true,
          updated_at: new Date().toISOString()
        });

      if (error) {
        console.error('[Sound] Error saving preferences:', error);
      }
    } catch (error) {
      console.error('[Sound] Error in savePreferences:', error);
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getVolumes(): { notification: number; alarm: number } {
    return { ...this.volumes };
  }
}

export const soundNotificationService = new SoundNotificationService();
