import { useState, useEffect, useCallback } from 'react';
import { adminDataCoordinator } from '../services/admin-data-coordinator';
import type { AdminUser, PlatformKPIs, PaginationMetadata } from '../services/admin-user-service';

interface UseAdminDashboardReturn {
  users: AdminUser[];
  platformKPIs: PlatformKPIs | null;
  pagination: PaginationMetadata;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  lastUpdate: Date;
  connectionStatus: 'connected' | 'disconnected' | 'reconnecting';
  refreshCount: number;
  isStale: boolean;
  refresh: () => Promise<void>;
  setPage: (page: number) => Promise<void>;
  setPageSize: (pageSize: number) => Promise<void>;
  setSearchTerm: (searchTerm: string) => Promise<void>;
  nextPage: () => Promise<void>;
  previousPage: () => Promise<void>;
}

/**
 * React hook for accessing admin dashboard data
 *
 * This hook provides a clean interface to the admin data coordinator.
 * It handles subscription management, loading states, and automatic
 * cleanup on unmount.
 *
 * Features:
 * - Automatic real-time updates
 * - Connection status monitoring
 * - Manual refresh capability
 * - Staleness detection
 * - Automatic cleanup
 *
 * Usage:
 * ```tsx
 * function MyAdminComponent() {
 *   const { users, platformKPIs, loading, refresh } = useAdminDashboard();
 *
 *   return (
 *     <div>
 *       <button onClick={refresh}>Refresh</button>
 *       {users.map(user => ...)}
 *     </div>
 *   );
 * }
 * ```
 */
export function useAdminDashboard(): UseAdminDashboardReturn {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [platformKPIs, setPlatformKPIs] = useState<PlatformKPIs | null>(null);
  const [pagination, setPagination] = useState<PaginationMetadata>({
    currentPage: 1,
    pageSize: 20,
    totalUsers: 0,
    totalPages: 0,
    hasNextPage: false,
    hasPreviousPage: false,
  });
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'reconnecting'>('disconnected');
  const [refreshCount, setRefreshCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);

  // Manual refresh function
  const refresh = useCallback(async () => {
    try {
      setError(null);
      setRefreshing(true);
      await adminDataCoordinator.forceRefresh();
    } catch (err: any) {
      console.error('[useAdminDashboard] Error during manual refresh:', err);
      setError(err?.message || 'Failed to refresh data');
    } finally {
      // Keep refreshing state for a brief moment to provide visual feedback
      setTimeout(() => setRefreshing(false), 300);
    }
  }, []);

  // Pagination functions
  const setPage = useCallback(async (page: number) => {
    try {
      setError(null);
      await adminDataCoordinator.setPage(page);
    } catch (err: any) {
      console.error('[useAdminDashboard] Error setting page:', err);
      setError(err?.message || 'Failed to change page');
    }
  }, []);

  const setPageSize = useCallback(async (pageSize: number) => {
    try {
      setError(null);
      await adminDataCoordinator.setPageSize(pageSize);
    } catch (err: any) {
      console.error('[useAdminDashboard] Error setting page size:', err);
      setError(err?.message || 'Failed to change page size');
    }
  }, []);

  const setSearchTerm = useCallback(async (searchTerm: string) => {
    try {
      setError(null);
      await adminDataCoordinator.setSearchTerm(searchTerm);
    } catch (err: any) {
      console.error('[useAdminDashboard] Error setting search term:', err);
      setError(err?.message || 'Failed to search');
    }
  }, []);

  const nextPage = useCallback(async () => {
    try {
      setError(null);
      await adminDataCoordinator.nextPage();
    } catch (err: any) {
      console.error('[useAdminDashboard] Error going to next page:', err);
      setError(err?.message || 'Failed to go to next page');
    }
  }, []);

  const previousPage = useCallback(async () => {
    try {
      setError(null);
      await adminDataCoordinator.previousPage();
    } catch (err: any) {
      console.error('[useAdminDashboard] Error going to previous page:', err);
      setError(err?.message || 'Failed to go to previous page');
    }
  }, []);

  // Start coordinator and subscribe to updates
  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | null = null;
    let unsubscribeConnection: (() => void) | null = null;

    const initialize = async () => {
      try {
        // Start the coordinator
        await adminDataCoordinator.start();

        if (!mounted) return;

        // Subscribe to data updates
        unsubscribe = adminDataCoordinator.subscribe((data) => {
          if (!mounted) return;

          setUsers(data.users);
          setPlatformKPIs(data.platformKPIs);
          setPagination(data.pagination);
          setLastUpdate(data.lastUpdate);
          setRefreshCount(data.refreshCount);
          setIsStale(adminDataCoordinator.isDataStale());
          setLoading(false);
          setError(null);
        });

        // Subscribe to connection status
        unsubscribeConnection = adminDataCoordinator.subscribeToConnectionStatus((status) => {
          if (!mounted) return;
          setConnectionStatus(status);
        });

        // Get initial data
        const currentData = adminDataCoordinator.getCurrentData();
        setUsers(currentData.users);
        setPlatformKPIs(currentData.platformKPIs);
        setPagination(currentData.pagination);
        setLastUpdate(currentData.lastUpdate);
        setConnectionStatus(currentData.connectionStatus);
        setRefreshCount(currentData.refreshCount);
        setIsStale(adminDataCoordinator.isDataStale());
        setLoading(false);
      } catch (err: any) {
        console.error('[useAdminDashboard] Error initializing:', err);
        if (mounted) {
          setError(err?.message || 'Failed to initialize admin dashboard');
          setLoading(false);
        }
      }
    };

    initialize();

    // Check staleness periodically
    const staleCheckInterval = setInterval(() => {
      if (mounted) {
        setIsStale(adminDataCoordinator.isDataStale());
      }
    }, 5000); // Check every 5 seconds

    // Cleanup
    return () => {
      mounted = false;
      clearInterval(staleCheckInterval);
      if (unsubscribe) unsubscribe();
      if (unsubscribeConnection) unsubscribeConnection();
      // Note: We don't stop the coordinator here because other components might be using it
      // The coordinator should be stopped at the app level when no longer needed
    };
  }, []);

  return {
    users,
    platformKPIs,
    pagination,
    loading,
    refreshing,
    error,
    lastUpdate,
    connectionStatus,
    refreshCount,
    isStale,
    refresh,
    setPage,
    setPageSize,
    setSearchTerm,
    nextPage,
    previousPage,
  };
}
