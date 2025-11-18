import { useState, useEffect, useRef } from 'react';

interface UseUserInteractionReturn {
  isUserInteracting: boolean;
  isScrolling: boolean;
  pauseUpdates: () => void;
  resumeUpdates: () => void;
}

/**
 * Hook to detect when user is actively interacting with the page
 * Useful for pausing background updates during scrolling or other interactions
 */
export function useUserInteraction(debounceMs: number = 1000): UseUserInteractionReturn {
  const [isUserInteracting, setIsUserInteracting] = useState(false);
  const [isScrolling, setIsScrolling] = useState(false);
  const [manualPause, setManualPause] = useState(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const interactionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolling(true);
      setIsUserInteracting(true);

      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      scrollTimeoutRef.current = setTimeout(() => {
        setIsScrolling(false);
        setIsUserInteracting(false);
      }, debounceMs);
    };

    const handleMouseMove = () => {
      setIsUserInteracting(true);

      if (interactionTimeoutRef.current) {
        clearTimeout(interactionTimeoutRef.current);
      }

      interactionTimeoutRef.current = setTimeout(() => {
        setIsUserInteracting(false);
      }, debounceMs * 2); // Longer timeout for mouse movement
    };

    const handleKeyDown = () => {
      setIsUserInteracting(true);

      if (interactionTimeoutRef.current) {
        clearTimeout(interactionTimeoutRef.current);
      }

      interactionTimeoutRef.current = setTimeout(() => {
        setIsUserInteracting(false);
      }, debounceMs);
    };

    // Add event listeners with passive flag for better scroll performance
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('keydown', handleKeyDown, { passive: true });
    window.addEventListener('touchmove', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('touchmove', handleScroll);

      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      if (interactionTimeoutRef.current) clearTimeout(interactionTimeoutRef.current);
    };
  }, [debounceMs]);

  const pauseUpdates = () => setManualPause(true);
  const resumeUpdates = () => setManualPause(false);

  return {
    isUserInteracting: isUserInteracting || manualPause,
    isScrolling,
    pauseUpdates,
    resumeUpdates
  };
}
