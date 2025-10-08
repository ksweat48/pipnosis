import { supabase } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

class RealtimeManager {
  private channels: Map<string, RealtimeChannel> = new Map();
  private connectionAttempts: Map<string, number> = new Map();
  private maxRetries = 3;
  private retryDelay = 2000;

  subscribe(channelName: string, config: any): RealtimeChannel | null {
    try {
      const attempts = this.connectionAttempts.get(channelName) || 0;

      if (attempts >= this.maxRetries) {
        console.warn(`Max retry attempts reached for channel: ${channelName}`);
        return null;
      }

      if (this.channels.has(channelName)) {
        return this.channels.get(channelName)!;
      }

      const channel = supabase.channel(channelName);

      channel.on('system', { event: '*' }, (payload: any) => {
        if (payload.status === 'CHANNEL_ERROR') {
          console.warn(`Channel error for ${channelName}:`, payload);
          this.connectionAttempts.set(channelName, attempts + 1);

          if (attempts < this.maxRetries) {
            setTimeout(() => {
              this.unsubscribe(channelName);
              this.subscribe(channelName, config);
            }, this.retryDelay * (attempts + 1));
          }
        }
      });

      if (config.postgres_changes) {
        config.postgres_changes.forEach((change: any) => {
          channel.on('postgres_changes', change, config.callback);
        });
      }

      channel.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          console.log(`Successfully subscribed to ${channelName}`);
          this.connectionAttempts.delete(channelName);
        } else if (status === 'CHANNEL_ERROR') {
          console.warn(`Subscription error for ${channelName}`);
        } else if (status === 'TIMED_OUT') {
          console.warn(`Subscription timeout for ${channelName}`);
        }
      });

      this.channels.set(channelName, channel);
      return channel;
    } catch (error) {
      console.error(`Failed to subscribe to ${channelName}:`, error);
      return null;
    }
  }

  unsubscribe(channelName: string): void {
    const channel = this.channels.get(channelName);
    if (channel) {
      try {
        supabase.removeChannel(channel);
        this.channels.delete(channelName);
        this.connectionAttempts.delete(channelName);
      } catch (error) {
        console.error(`Error unsubscribing from ${channelName}:`, error);
      }
    }
  }

  unsubscribeAll(): void {
    this.channels.forEach((_, channelName) => {
      this.unsubscribe(channelName);
    });
  }

  getChannel(channelName: string): RealtimeChannel | undefined {
    return this.channels.get(channelName);
  }
}

export const realtimeManager = new RealtimeManager();
