/**
 * Platform Scan Manager
 *
 * SSOT Authority: Manages the single platform-wide intelligence scan state.
 * All users share one cooldown and one set of scan results. When any user
 * clicks "Scan Now", the result is persisted here and broadcast to all
 * connected clients via Supabase Realtime.
 *
 * CCIP Compliance:
 * - Single source of truth for scan cooldown (database timestamp, not memory)
 * - All reads go through get_platform_intelligence_scan() RPC
 * - All writes are UPSERT on the singleton row
 * - Realtime subscription replaces polling
 *
 * Governance:
 * - No user attribution stored (per product spec)
 * - Cooldown enforced client-side using database timestamp
 * - This service owns the platform scan state; SessionIntelligenceMonitor
 *   is a consumer only
 */

import { supabase } from '../lib/supabase';
import type { AlphaPreviewCard, AlphaPreviewScanResult } from './alpha-preview-scanner';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface PlatformScanState {
  scannedAt: Date;
  cooldownExpiresAt: Date;
  scanDurationMs: number;
  scannedCount: number;
  heatingCount: number;
  readyCards: AlphaPreviewCard[];
  secondsUntilCooldownExpires: number;
  isOnCooldown: boolean;
}

const COOLDOWN_SECONDS = 60;

class PlatformScanManager {
  private channel: RealtimeChannel | null = null;
  private listeners: Set<(state: PlatformScanState) => void> = new Set();

  async getLatestScan(): Promise<PlatformScanState | null> {
    try {
      const { data, error } = await supabase.rpc('get_platform_intelligence_scan');
      if (error || !data || data.length === 0) return null;

      const row = data[0];
      return this.rowToState(row);
    } catch {
      return null;
    }
  }

  async storeScanResult(result: AlphaPreviewScanResult): Promise<void> {
    const scannedAt = result.scannedAt;
    const cooldownExpiresAt = new Date(scannedAt.getTime() + COOLDOWN_SECONDS * 1000);

    const { error } = await supabase
      .from('platform_intelligence_scan')
      .upsert(
        {
          singleton_key: 'singleton',
          scanned_at: scannedAt.toISOString(),
          cooldown_expires_at: cooldownExpiresAt.toISOString(),
          scan_duration_ms: result.scanDurationMs,
          scanned_count: result.scannedCount,
          heating_count: result.heatingCount,
          ready_cards: result.ready as unknown as Record<string, unknown>[],
        },
        { onConflict: 'singleton_key' }
      );

    if (error) {
      throw new Error(`Failed to store platform scan result: ${error.message}`);
    }
  }

  subscribeToUpdates(callback: (state: PlatformScanState) => void): () => void {
    this.listeners.add(callback);

    if (!this.channel) {
      this.channel = supabase
        .channel('platform_intelligence_scan_changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'platform_intelligence_scan',
          },
          () => {
            this.getLatestScan().then((state) => {
              if (state) {
                this.listeners.forEach((fn) => fn(state));
              }
            });
          }
        )
        .subscribe();
    }

    return () => {
      this.listeners.delete(callback);
      if (this.listeners.size === 0 && this.channel) {
        supabase.removeChannel(this.channel);
        this.channel = null;
      }
    };
  }

  formatRelativeTime(scannedAt: Date): string {
    const diffMs = Date.now() - scannedAt.getTime();
    const diffSecs = Math.floor(diffMs / 1000);

    if (diffSecs < 10) return 'just now';
    if (diffSecs < 60) return `${diffSecs}s ago`;

    const diffMins = Math.floor(diffSecs / 60);
    if (diffMins === 1) return '1 min ago';
    if (diffMins < 60) return `${diffMins} min ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours === 1) return '1 hr ago';
    return `${diffHours} hr ago`;
  }

  private rowToState(row: {
    scanned_at: string;
    cooldown_expires_at: string;
    scan_duration_ms: number;
    scanned_count: number;
    heating_count: number;
    ready_cards: unknown;
    seconds_until_cooldown_expires: number;
    is_on_cooldown: boolean;
  }): PlatformScanState {
    return {
      scannedAt: new Date(row.scanned_at),
      cooldownExpiresAt: new Date(row.cooldown_expires_at),
      scanDurationMs: row.scan_duration_ms,
      scannedCount: row.scanned_count,
      heatingCount: row.heating_count,
      readyCards: (row.ready_cards as AlphaPreviewCard[]) ?? [],
      secondsUntilCooldownExpires: row.seconds_until_cooldown_expires,
      isOnCooldown: row.is_on_cooldown,
    };
  }
}

export const platformScanManager = new PlatformScanManager();
