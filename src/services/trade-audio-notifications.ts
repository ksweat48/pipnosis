class TradeAudioNotificationService {
  private enabled: boolean = true;
  private volume: number = 0.5;
  private audioContext: AudioContext | null = null;

  constructor() {
    const savedEnabled = localStorage.getItem('trade-sounds-enabled');
    this.enabled = savedEnabled !== null ? savedEnabled === 'true' : true;

    const savedVolume = localStorage.getItem('trade-sounds-volume');
    this.volume = savedVolume ? parseFloat(savedVolume) : 0.5;
  }

  private getAudioContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return this.audioContext;
  }

  private playBeep(frequency: number, duration: number, type: OscillatorType = 'sine'): void {
    if (!this.enabled) return;

    try {
      const context = this.getAudioContext();
      const oscillator = context.createOscillator();
      const gainNode = context.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(context.destination);

      oscillator.frequency.value = frequency;
      oscillator.type = type;

      gainNode.gain.setValueAtTime(this.volume, context.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, context.currentTime + duration);

      oscillator.start(context.currentTime);
      oscillator.stop(context.currentTime + duration);
    } catch (error) {
      console.error('Failed to play audio notification:', error);
    }
  }

  playTradeEntrySound(): void {
    this.playBeep(800, 0.15, 'sine');
    setTimeout(() => this.playBeep(1000, 0.15, 'sine'), 150);
  }

  playTradeExitSound(): void {
    this.playBeep(600, 0.2, 'sine');
    setTimeout(() => this.playBeep(500, 0.2, 'sine'), 200);
  }

  playSuccessSound(): void {
    this.playBeep(523.25, 0.1, 'sine');
    setTimeout(() => this.playBeep(659.25, 0.1, 'sine'), 100);
    setTimeout(() => this.playBeep(783.99, 0.2, 'sine'), 200);
  }

  playErrorSound(): void {
    this.playBeep(400, 0.3, 'sawtooth');
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    localStorage.setItem('trade-sounds-enabled', String(enabled));
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    localStorage.setItem('trade-sounds-volume', String(this.volume));
  }

  getVolume(): number {
    return this.volume;
  }
}

export const tradeAudioNotifications = new TradeAudioNotificationService();
