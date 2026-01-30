/**
 * Audio Alert Service (SSOT for Sound Playback)
 *
 * Manages 2-3 second audio alerts for critical trading events
 * - Trade entry
 * - Trade close (profit)
 * - Trade close (loss)
 * - Goal achieved
 *
 * GOVERNANCE:
 * - SINGLE SOURCE OF TRUTH for all sound playback
 * - Deduplicates sounds within 10-second window
 * - Tracks sound history per context (e.g., tradeId)
 */

export type AlertType = 'success' | 'warning' | 'attention' | 'critical';

interface SoundContext {
  type: AlertType;
  tradeId?: string;
  sessionId?: string;
  context?: string;
}

class AudioAlertService {
  private audioContext: AudioContext | null = null;
  private isMuted: boolean = false;
  private volume: number = 0.7;
  private isInitialized: boolean = false;

  // SSOT: Sound deduplication cache (10-second window)
  private recentSounds: Map<string, number> = new Map();
  private readonly DEDUPLICATION_WINDOW_MS = 10000; // 10 seconds

  constructor() {
    this.loadPreferences();
    this.startCleanupInterval();
  }

  /**
   * Start cleanup interval to remove expired sound cache entries
   */
  private startCleanupInterval(): void {
    setInterval(() => {
      const now = Date.now();
      for (const [key, timestamp] of this.recentSounds.entries()) {
        if (now - timestamp > this.DEDUPLICATION_WINDOW_MS) {
          this.recentSounds.delete(key);
        }
      }
    }, 5000); // Clean every 5 seconds
  }

  /**
   * Generate deduplication key for sound
   */
  private getSoundKey(context: SoundContext): string {
    const parts = [context.type];
    if (context.tradeId) parts.push(`trade:${context.tradeId}`);
    if (context.sessionId) parts.push(`session:${context.sessionId}`);
    if (context.context) parts.push(context.context);
    return parts.join('|');
  }

  /**
   * Check if sound was recently played
   */
  private wasRecentlyPlayed(context: SoundContext): boolean {
    const key = this.getSoundKey(context);
    const lastPlayed = this.recentSounds.get(key);

    if (!lastPlayed) return false;

    const timeSinceLastPlay = Date.now() - lastPlayed;
    const wasRecent = timeSinceLastPlay < this.DEDUPLICATION_WINDOW_MS;

    if (wasRecent) {
      console.log(
        `[AudioAlert] Deduplicated sound: ${context.type} ` +
        `(last played ${Math.round(timeSinceLastPlay / 1000)}s ago)`
      );
    }

    return wasRecent;
  }

  /**
   * Mark sound as played
   */
  private markAsPlayed(context: SoundContext): void {
    const key = this.getSoundKey(context);
    this.recentSounds.set(key, Date.now());
  }

  private loadPreferences(): void {
    try {
      const mutedPref = localStorage.getItem('audio_alerts_muted');
      const volumePref = localStorage.getItem('audio_alerts_volume');

      this.isMuted = mutedPref === 'true';
      this.volume = volumePref ? parseFloat(volumePref) : 0.7;
    } catch (error) {
      console.error('[AudioAlert] Failed to load preferences:', error);
    }
  }

  private async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.isInitialized = true;
      console.log('[AudioAlert] Audio context initialized');
    } catch (error) {
      console.error('[AudioAlert] Failed to initialize audio context:', error);
    }
  }

  /**
   * Play success alert (melodic, upward progression) - 2.5 seconds
   * Used for: Trade profit, Goal achieved
   */
  async playSuccess(): Promise<void> {
    if (this.isMuted) return;
    await this.initialize();
    if (!this.audioContext) return;

    try {
      const ctx = this.audioContext;
      const gainNode = ctx.createGain();
      gainNode.connect(ctx.destination);
      gainNode.gain.value = this.volume;

      // Create melodic success sound: C -> E -> G -> C (major chord progression)
      const frequencies = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
      const noteDuration = 0.4; // Each note 400ms
      const totalDuration = 2.5;

      frequencies.forEach((freq, index) => {
        const oscillator = ctx.createOscillator();
        const noteGain = ctx.createGain();

        oscillator.connect(noteGain);
        noteGain.connect(gainNode);

        oscillator.type = 'sine';
        oscillator.frequency.value = freq;

        const startTime = ctx.currentTime + (index * noteDuration);
        const endTime = startTime + noteDuration;

        // Smooth envelope
        noteGain.gain.setValueAtTime(0, startTime);
        noteGain.gain.linearRampToValueAtTime(this.volume * 0.8, startTime + 0.05);
        noteGain.gain.exponentialRampToValueAtTime(0.01, endTime);

        oscillator.start(startTime);
        oscillator.stop(endTime);
      });

      console.log('[AudioAlert] Playing success alert');
    } catch (error) {
      console.error('[AudioAlert] Failed to play success sound:', error);
    }
  }

  /**
   * Play warning alert (descending tones) - 2 seconds
   * Used for: Trade loss, Stop loss hit
   */
  async playWarning(): Promise<void> {
    if (this.isMuted) return;
    await this.initialize();
    if (!this.audioContext) return;

    try {
      const ctx = this.audioContext;
      const gainNode = ctx.createGain();
      gainNode.connect(ctx.destination);
      gainNode.gain.value = this.volume;

      // Descending minor chord: G -> E -> C (somber)
      const frequencies = [783.99, 659.25, 523.25]; // G5, E5, C5
      const noteDuration = 0.6;

      frequencies.forEach((freq, index) => {
        const oscillator = ctx.createOscillator();
        const noteGain = ctx.createGain();

        oscillator.connect(noteGain);
        noteGain.connect(gainNode);

        oscillator.type = 'triangle';
        oscillator.frequency.value = freq;

        const startTime = ctx.currentTime + (index * noteDuration);
        const endTime = startTime + noteDuration;

        noteGain.gain.setValueAtTime(0, startTime);
        noteGain.gain.linearRampToValueAtTime(this.volume * 0.7, startTime + 0.05);
        noteGain.gain.exponentialRampToValueAtTime(0.01, endTime);

        oscillator.start(startTime);
        oscillator.stop(endTime);
      });

      console.log('[AudioAlert] Playing warning alert');
    } catch (error) {
      console.error('[AudioAlert] Failed to play warning sound:', error);
    }
  }

  /**
   * Play attention alert (pulsing tone) - 2 seconds
   * Used for: Trade entry notification, Important alerts
   */
  async playAttention(): Promise<void> {
    if (this.isMuted) return;
    await this.initialize();
    if (!this.audioContext) return;

    try {
      const ctx = this.audioContext;
      const gainNode = ctx.createGain();
      gainNode.connect(ctx.destination);

      const oscillator = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      const lfo = ctx.createOscillator();

      oscillator.connect(lfoGain);
      lfoGain.connect(gainNode);
      gainNode.connect(ctx.destination);

      // Create pulsing effect with LFO
      lfo.frequency.value = 4; // 4 Hz pulse
      lfo.connect(gainNode.gain);

      oscillator.type = 'sine';
      oscillator.frequency.value = 880; // A5
      gainNode.gain.value = this.volume * 0.5;

      const duration = 2.0;
      const startTime = ctx.currentTime;
      const endTime = startTime + duration;

      lfo.start(startTime);
      oscillator.start(startTime);

      lfo.stop(endTime);
      oscillator.stop(endTime);

      console.log('[AudioAlert] Playing attention alert');
    } catch (error) {
      console.error('[AudioAlert] Failed to play attention sound:', error);
    }
  }

  /**
   * Play critical alert (urgent, rapid beeps) - 3 seconds
   * Used for: Goal achieved, Critical events
   */
  async playCritical(): Promise<void> {
    if (this.isMuted) return;
    await this.initialize();
    if (!this.audioContext) return;

    try {
      const ctx = this.audioContext;
      const gainNode = ctx.createGain();
      gainNode.connect(ctx.destination);
      gainNode.gain.value = this.volume;

      // Rapid ascending pattern: 6 beeps over 3 seconds
      const frequencies = [659.25, 783.99, 880, 1046.50, 1174.66, 1318.51]; // E5 to E6
      const beepDuration = 0.3;
      const gapDuration = 0.2;

      frequencies.forEach((freq, index) => {
        const oscillator = ctx.createOscillator();
        const noteGain = ctx.createGain();

        oscillator.connect(noteGain);
        noteGain.connect(gainNode);

        oscillator.type = 'square';
        oscillator.frequency.value = freq;

        const startTime = ctx.currentTime + (index * (beepDuration + gapDuration));
        const endTime = startTime + beepDuration;

        noteGain.gain.setValueAtTime(this.volume * 0.6, startTime);
        noteGain.gain.exponentialRampToValueAtTime(0.01, endTime);

        oscillator.start(startTime);
        oscillator.stop(endTime);
      });

      console.log('[AudioAlert] Playing critical alert');
    } catch (error) {
      console.error('[AudioAlert] Failed to play critical sound:', error);
    }
  }

  /**
   * Play mid-trade alert (attention-grabbing) - 2 seconds
   * Used for: Mid-trade updates, recommendations, trigger events
   */
  async playMidTradeAlert(): Promise<void> {
    await this.playAttention();
  }

  /**
   * Play alert based on type (DEPRECATED - use playWithContext)
   */
  async play(type: AlertType): Promise<void> {
    // Legacy method - no deduplication for backward compatibility
    switch (type) {
      case 'success':
        await this.playSuccess();
        break;
      case 'warning':
        await this.playWarning();
        break;
      case 'attention':
        await this.playAttention();
        break;
      case 'critical':
        await this.playCritical();
        break;
      default:
        console.warn(`[AudioAlert] Unknown alert type: ${type}`);
    }
  }

  /**
   * Play alert with deduplication (SSOT Authority)
   *
   * This is the PRIMARY method for playing sounds in the application.
   * All business logic should route through this method, not direct playSuccess/playWarning.
   *
   * @param context - Sound context with type and optional deduplication keys
   * @returns Promise<boolean> - true if sound played, false if deduplicated
   */
  async playWithContext(context: SoundContext): Promise<boolean> {
    // Check deduplication
    if (this.wasRecentlyPlayed(context)) {
      return false; // Deduplicated
    }

    // Mark as played BEFORE starting playback to prevent race conditions
    this.markAsPlayed(context);

    // Play the sound
    switch (context.type) {
      case 'success':
        await this.playSuccess();
        break;
      case 'warning':
        await this.playWarning();
        break;
      case 'attention':
        await this.playAttention();
        break;
      case 'critical':
        await this.playCritical();
        break;
      default:
        console.warn(`[AudioAlert] Unknown alert type: ${context.type}`);
        return false;
    }

    return true; // Sound played successfully
  }

  /**
   * Convenience method: Play trade profit sound with deduplication
   */
  async playTradeProfit(tradeId: string): Promise<boolean> {
    return this.playWithContext({
      type: 'success',
      tradeId,
      context: 'trade_profit'
    });
  }

  /**
   * Convenience method: Play trade loss sound with deduplication
   */
  async playTradeLoss(tradeId: string): Promise<boolean> {
    return this.playWithContext({
      type: 'warning',
      tradeId,
      context: 'trade_loss'
    });
  }

  /**
   * Convenience method: Play trade entry sound with deduplication
   */
  async playTradeEntry(tradeId: string): Promise<boolean> {
    return this.playWithContext({
      type: 'attention',
      tradeId,
      context: 'trade_entry'
    });
  }

  /**
   * Convenience method: Play goal achieved sound with deduplication
   */
  async playGoalAchieved(sessionId: string): Promise<boolean> {
    return this.playWithContext({
      type: 'critical',
      sessionId,
      context: 'goal_achieved'
    });
  }

  /**
   * Set mute state
   */
  setMuted(muted: boolean): void {
    this.isMuted = muted;
    try {
      localStorage.setItem('audio_alerts_muted', muted.toString());
    } catch (error) {
      console.error('[AudioAlert] Failed to save mute preference:', error);
    }
  }

  /**
   * Get mute state
   */
  isMutedState(): boolean {
    return this.isMuted;
  }

  /**
   * Set volume (0-1)
   */
  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    try {
      localStorage.setItem('audio_alerts_volume', this.volume.toString());
    } catch (error) {
      console.error('[AudioAlert] Failed to save volume preference:', error);
    }
  }

  /**
   * Get current volume
   */
  getVolume(): number {
    return this.volume;
  }
}

export const audioAlertService = new AudioAlertService();
