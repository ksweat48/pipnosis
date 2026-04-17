import { supabase } from '../lib/supabase';

type ConnectionStatus = 'connected' | 'disconnected' | 'connecting';
type StatusListener = (status: ConnectionStatus) => void;

/**
 * SSOT: Realtime Connection Manager
 *
 * Owns the single source of truth for the Supabase Realtime WebSocket connection state.
 * All services that create Supabase channels MUST check this manager before logging
 * channel errors, to prevent console flood when the shared WebSocket drops.
 *
 * Architecture:
 * - One shared Supabase client → one WebSocket transport → many logical channels
 * - When the transport fails ALL channels fail simultaneously
 * - Without this manager, 28 services each log errors independently = 28x noise per retry
 * - With this manager, only ONE error is logged per connection failure event
 */
class RealtimeConnectionManager {
  private status: ConnectionStatus = 'connecting';
  private listeners: Set<StatusListener> = new Set();
  private probeChannel: ReturnType<typeof supabase.channel> | null = null;
  private lastKnownDisconnectAt: number | null = null;
  private suppressUntil: number = 0;
  private readonly SUPPRESS_WINDOW_MS = 30_000;

  constructor() {
    this.initProbe();
  }

  private initProbe(): void {
    try {
      this.probeChannel = supabase
        .channel('__realtime_health_probe__')
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            this.setStatus('connected');
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            this.setStatus('disconnected');
          } else if (status === 'CLOSED') {
            this.setStatus('disconnected');
          }
        });
    } catch {
      this.setStatus('disconnected');
    }
  }

  private setStatus(next: ConnectionStatus): void {
    if (this.status === next) return;

    const prev = this.status;
    this.status = next;

    if (next === 'disconnected' && prev !== 'disconnected') {
      this.lastKnownDisconnectAt = Date.now();
      this.suppressUntil = Date.now() + this.SUPPRESS_WINDOW_MS;
      console.warn(
        '[RealtimeConnectionManager] WebSocket disconnected — channel errors will be suppressed for 30s during reconnection'
      );
    }

    if (next === 'connected' && prev !== 'connected') {
      this.suppressUntil = 0;
      this.lastKnownDisconnectAt = null;
      console.log('[RealtimeConnectionManager] WebSocket reconnected');
    }

    this.listeners.forEach((fn) => {
      try { fn(next); } catch { /* non-fatal */ }
    });
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  isAvailable(): boolean {
    return this.status === 'connected';
  }

  /**
   * Returns true when channel errors should be suppressed.
   * Call this inside CHANNEL_ERROR handlers to avoid console flood during reconnection.
   */
  shouldSuppressChannelError(): boolean {
    return Date.now() < this.suppressUntil;
  }

  /**
   * Log a channel error with de-duplication.
   * Only logs if we are NOT in a known-disconnected suppression window.
   * Always logs on the first error; subsequent ones within the window are silenced.
   */
  logChannelError(source: string): void {
    if (this.shouldSuppressChannelError()) return;
    console.error(`[${source}] Realtime channel error (WebSocket unavailable)`);
    this.suppressUntil = Date.now() + this.SUPPRESS_WINDOW_MS;
  }

  /**
   * Log a channel warning with de-duplication.
   */
  logChannelWarning(source: string, message: string): void {
    if (this.shouldSuppressChannelError()) return;
    console.warn(`[${source}] ${message}`);
    this.suppressUntil = Date.now() + this.SUPPRESS_WINDOW_MS;
  }

  onStatusChange(fn: StatusListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  destroy(): void {
    if (this.probeChannel) {
      supabase.removeChannel(this.probeChannel);
      this.probeChannel = null;
    }
    this.listeners.clear();
  }
}

export const realtimeConnectionManager = new RealtimeConnectionManager();
