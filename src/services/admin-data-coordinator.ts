import { supabase } from '../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { adminUserService } from './admin-user-service';

/**
 * SINGLE SOURCE OF TRUTH for Admin Dashboard Data
 *
 * This coordinator is the ONLY service that manages admin dashboard subscriptions.
 * Components should NEVER directly subscribe to database changes or call admin
 * functions repeatedly. Instead, they subscribe to this coordinator.
 *
 * Responsibilities:
 * - Manage real-time subscriptions to all admin-relevant tables
 * - Coordinate periodic polling as fallback
 * - Throttle and batch updates to prevent UI thrashing
 * - Provide single subscription API for components
 * - Handle reconnection and error recovery
 *
 * Architecture:
 * - Real-time updates: Immediate refresh on table changes
 * - Periodic polling: Every 15 seconds as fallback
 * - Throttling: Maximum 1 refresh per 2 seconds
 * - Debouncing: Batch multiple changes within 1 second window
 */

interface AdminDashboardData {
  users: any[];
  platformKPIs: any | null;
  lastUpdate: Date;
  connectionStatus: 'connected' | 'disconnected' | 'reconnecting';
  refreshCount: number;
}

type UpdateCallback = (data: AdminDashboardData) => void;
type ConnectionStatusCallback = (status: 'connected' | 'disconnected' | 'reconnecting') => void;

class AdminDataCoordinator {
  private subscribers: Set<UpdateCallback> = new Set();
  private connectionSubscribers: Set<ConnectionStatusCallback> = new Set();
  private channels: RealtimeChannel[] = [];
  private pollingInterval: NodeJS.Timeout | null = null;
  private throttleTimeout: NodeJS.Timeout | null = null;
  private debounceTimeout: NodeJS.Timeout | null = null;

  private data: AdminDashboardData = {
    users: [],
    platformKPIs: null,
    lastUpdate: new Date(),
    connectionStatus: 'disconnected',
    refreshCount: 0,
  };

  private isRefreshing = false;
  private pendingRefresh = false;
  private lastRefreshTime = 0;
  private readonly THROTTLE_MS = 2000; // Maximum 1 refresh per 2 seconds
  private readonly DEBOUNCE_MS = 1000; // Batch changes within 1 second
  private readonly POLLING_INTERVAL_MS = 15000; // Poll every 15 seconds as fallback
  private readonly STALE_THRESHOLD_MS = 30000; // Data is stale after 30 seconds

  /**
   * Start the coordinator - establishes subscriptions and begins polling
   */
  async start(): Promise<void> {
    console.log('[AdminCoordinator] Starting admin data coordinator...');

    // Initial data load
    await this.refreshData();

    // Set up real-time subscriptions
    this.setupRealtimeSubscriptions();

    // Start fallback polling
    this.startPolling();

    this.updateConnectionStatus('connected');
    console.log('[AdminCoordinator] Admin data coordinator started successfully');
  }

  /**
   * Stop the coordinator - cleans up all subscriptions and polling
   */
  stop(): void {
    console.log('[AdminCoordinator] Stopping admin data coordinator...');

    // Clear all timeouts
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    if (this.throttleTimeout) {
      clearTimeout(this.throttleTimeout);
      this.throttleTimeout = null;
    }
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = null;
    }

    // Unsubscribe from all channels
    this.channels.forEach(channel => {
      supabase.removeChannel(channel);
    });
    this.channels = [];

    this.updateConnectionStatus('disconnected');
    console.log('[AdminCoordinator] Admin data coordinator stopped');
  }

  /**
   * Subscribe to admin dashboard data updates
   * Returns unsubscribe function
   */
  subscribe(callback: UpdateCallback): () => void {
    this.subscribers.add(callback);

    // Immediately provide current data to new subscriber
    callback(this.data);

    // Return unsubscribe function
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * Subscribe to connection status changes
   * Returns unsubscribe function
   */
  subscribeToConnectionStatus(callback: ConnectionStatusCallback): () => void {
    this.connectionSubscribers.add(callback);

    // Immediately provide current status
    callback(this.data.connectionStatus);

    return () => {
      this.connectionSubscribers.delete(callback);
    };
  }

  /**
   * Manually trigger a refresh (bypasses throttling)
   */
  async forceRefresh(): Promise<void> {
    console.log('[AdminCoordinator] Force refresh requested');
    await this.refreshData();
  }

  /**
   * Get current data snapshot
   */
  getCurrentData(): AdminDashboardData {
    return { ...this.data };
  }

  /**
   * Check if data is stale
   */
  isDataStale(): boolean {
    const age = Date.now() - this.data.lastUpdate.getTime();
    return age > this.STALE_THRESHOLD_MS;
  }

  /**
   * Set up real-time subscriptions to all admin-relevant tables
   */
  private setupRealtimeSubscriptions(): void {
    console.log('[AdminCoordinator] Setting up real-time subscriptions...');

    // Subscribe to user_profiles changes
    const userProfilesChannel = supabase
      .channel('admin-user-profiles')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_profiles',
        },
        () => {
          console.log('[AdminCoordinator] user_profiles changed');
          this.scheduleRefresh();
        }
      )
      .subscribe((status) => {
        console.log('[AdminCoordinator] user_profiles subscription:', status);
        this.handleSubscriptionStatus(status);
      });

    // Subscribe to goal_sessions changes
    const goalSessionsChannel = supabase
      .channel('admin-goal-sessions')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'goal_sessions',
        },
        () => {
          console.log('[AdminCoordinator] goal_sessions changed');
          this.scheduleRefresh();
        }
      )
      .subscribe((status) => {
        console.log('[AdminCoordinator] goal_sessions subscription:', status);
        this.handleSubscriptionStatus(status);
      });

    // Subscribe to goal_session_trades changes
    const goalTradesChannel = supabase
      .channel('admin-goal-trades')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'goal_session_trades',
        },
        () => {
          console.log('[AdminCoordinator] goal_session_trades changed');
          this.scheduleRefresh();
        }
      )
      .subscribe((status) => {
        console.log('[AdminCoordinator] goal_trades subscription:', status);
        this.handleSubscriptionStatus(status);
      });

    // Subscribe to user_token_balance changes
    const tokenBalanceChannel = supabase
      .channel('admin-token-balance')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_token_balance',
        },
        () => {
          console.log('[AdminCoordinator] user_token_balance changed');
          this.scheduleRefresh();
        }
      )
      .subscribe((status) => {
        console.log('[AdminCoordinator] user_token_balance subscription:', status);
        this.handleSubscriptionStatus(status);
      });

    // Subscribe to realtime_prices changes (for live P&L updates)
    const realtimePricesChannel = supabase
      .channel('admin-realtime-prices')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'realtime_prices',
        },
        () => {
          // Price updates are frequent, so use longer debounce
          this.scheduleRefresh(3000);
        }
      )
      .subscribe((status) => {
        console.log('[AdminCoordinator] realtime_prices subscription:', status);
        this.handleSubscriptionStatus(status);
      });

    // Store all channels for cleanup
    this.channels = [
      userProfilesChannel,
      goalSessionsChannel,
      goalTradesChannel,
      tokenBalanceChannel,
      realtimePricesChannel,
    ];

    console.log('[AdminCoordinator] Real-time subscriptions established');
  }

  /**
   * Handle subscription status changes
   */
  private handleSubscriptionStatus(status: string): void {
    if (status === 'SUBSCRIBED') {
      this.updateConnectionStatus('connected');
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      this.updateConnectionStatus('reconnecting');
      // Attempt to reconnect after a delay
      setTimeout(() => {
        if (this.data.connectionStatus === 'reconnecting') {
          this.stop();
          this.start();
        }
      }, 5000);
    }
  }

  /**
   * Schedule a data refresh with debouncing and throttling
   */
  private scheduleRefresh(debounceMs: number = this.DEBOUNCE_MS): void {
    // Clear existing debounce timeout
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }

    // Set new debounce timeout
    this.debounceTimeout = setTimeout(() => {
      this.throttledRefresh();
    }, debounceMs);
  }

  /**
   * Throttled refresh - ensures we don't refresh too frequently
   */
  private throttledRefresh(): void {
    const now = Date.now();
    const timeSinceLastRefresh = now - this.lastRefreshTime;

    if (timeSinceLastRefresh < this.THROTTLE_MS) {
      // Too soon, schedule for later
      if (!this.throttleTimeout) {
        const delay = this.THROTTLE_MS - timeSinceLastRefresh;
        this.throttleTimeout = setTimeout(() => {
          this.throttleTimeout = null;
          this.throttledRefresh();
        }, delay);
      }
      this.pendingRefresh = true;
      return;
    }

    // Enough time has passed, refresh now
    this.pendingRefresh = false;
    this.refreshData();
  }

  /**
   * Start periodic polling as fallback
   */
  private startPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }

    this.pollingInterval = setInterval(() => {
      // Only poll if data is stale or we have pending updates
      if (this.isDataStale() || this.pendingRefresh) {
        console.log('[AdminCoordinator] Polling refresh triggered');
        this.scheduleRefresh();
      }
    }, this.POLLING_INTERVAL_MS);

    console.log('[AdminCoordinator] Polling started (every 15s)');
  }

  /**
   * Refresh all admin data from database
   */
  private async refreshData(): Promise<void> {
    if (this.isRefreshing) {
      this.pendingRefresh = true;
      return;
    }

    this.isRefreshing = true;
    this.lastRefreshTime = Date.now();

    try {
      console.log('[AdminCoordinator] Refreshing admin data...');

      // Fetch both users and KPIs in parallel
      const [usersResult, kpisResult] = await Promise.allSettled([
        adminUserService.getAllUsers(undefined, 100),
        adminUserService.getPlatformKPIs(),
      ]);

      // Update data
      if (usersResult.status === 'fulfilled') {
        this.data.users = usersResult.value;
      } else {
        console.error('[AdminCoordinator] Error fetching users:', usersResult.reason);
      }

      if (kpisResult.status === 'fulfilled') {
        this.data.platformKPIs = kpisResult.value;
      } else {
        console.error('[AdminCoordinator] Error fetching KPIs:', kpisResult.reason);
      }

      this.data.lastUpdate = new Date();
      this.data.refreshCount++;

      // Notify all subscribers
      this.notifySubscribers();

      console.log('[AdminCoordinator] Data refreshed successfully', {
        usersCount: this.data.users.length,
        refreshCount: this.data.refreshCount,
      });
    } catch (error) {
      console.error('[AdminCoordinator] Error refreshing data:', error);
    } finally {
      this.isRefreshing = false;

      // If there was a pending refresh, schedule it now
      if (this.pendingRefresh) {
        this.pendingRefresh = false;
        setTimeout(() => this.scheduleRefresh(), 100);
      }
    }
  }

  /**
   * Notify all subscribers of data update
   */
  private notifySubscribers(): void {
    this.subscribers.forEach(callback => {
      try {
        callback(this.data);
      } catch (error) {
        console.error('[AdminCoordinator] Error in subscriber callback:', error);
      }
    });
  }

  /**
   * Update connection status and notify subscribers
   */
  private updateConnectionStatus(status: 'connected' | 'disconnected' | 'reconnecting'): void {
    if (this.data.connectionStatus !== status) {
      this.data.connectionStatus = status;
      this.connectionSubscribers.forEach(callback => {
        try {
          callback(status);
        } catch (error) {
          console.error('[AdminCoordinator] Error in connection status callback:', error);
        }
      });
    }
  }
}

// Export singleton instance
export const adminDataCoordinator = new AdminDataCoordinator();
