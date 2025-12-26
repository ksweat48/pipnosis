import { useEffect, useRef, useState, useCallback } from 'react';

interface PullToRefreshOptions {
  onRefresh: () => Promise<void>;
  threshold?: number;
  resistance?: number;
  enabled?: boolean;
  topZonePercentage?: number;
}

export function usePullToRefresh({
  onRefresh,
  threshold = 80,
  resistance = 2.5,
  enabled = true,
  topZonePercentage = 40
}: PullToRefreshOptions) {
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);

  const touchStartY = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollableElementRef = useRef<Element | null>(null);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (!enabled || isRefreshing) return;

    const scrollableElement = scrollableElementRef.current || containerRef.current || document.scrollingElement || document.documentElement;
    const isAtTop = scrollableElement.scrollTop === 0;

    const touchY = e.touches[0].clientY;
    const viewportHeight = window.innerHeight;
    const topZoneThreshold = viewportHeight * (topZonePercentage / 100);
    const isInTopZone = touchY <= topZoneThreshold;

    if (isAtTop && isInTopZone) {
      touchStartY.current = touchY;
    }
  }, [enabled, isRefreshing, topZonePercentage]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!enabled || isRefreshing || touchStartY.current === 0) return;

    const scrollableElement = scrollableElementRef.current || containerRef.current || document.scrollingElement || document.documentElement;
    const isAtTop = scrollableElement.scrollTop === 0;

    if (!isAtTop) {
      touchStartY.current = 0;
      setIsPulling(false);
      setPullDistance(0);
      return;
    }

    const touchY = e.touches[0].clientY;
    const distance = touchY - touchStartY.current;

    if (distance > 0) {
      e.preventDefault();
      setIsPulling(true);
      const adjustedDistance = Math.min(distance / resistance, threshold * 1.5);
      setPullDistance(adjustedDistance);
    }
  }, [enabled, isRefreshing, threshold, resistance]);

  const handleTouchEnd = useCallback(async () => {
    if (!enabled || isRefreshing) return;

    if (pullDistance >= threshold) {
      setIsRefreshing(true);
      try {
        await onRefresh();
      } catch (error) {
        console.error('Pull to refresh error:', error);
      } finally {
        setIsRefreshing(false);
      }
    }

    touchStartY.current = 0;
    setIsPulling(false);
    setPullDistance(0);
  }, [enabled, isRefreshing, pullDistance, threshold, onRefresh]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    // Look for a specific scrollable element, otherwise use the container itself
    const scrollable = container.querySelector('[data-scrollable]') as Element;
    scrollableElementRef.current = scrollable || container;

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, [enabled, handleTouchStart, handleTouchMove, handleTouchEnd]);

  return {
    containerRef,
    isPulling,
    isRefreshing,
    pullDistance,
    threshold
  };
}
