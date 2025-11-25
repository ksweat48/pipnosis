import { useState, useCallback } from 'react';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
  duration?: number;
}

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((
    type: Toast['type'],
    title: string,
    message: string,
    duration = 5000
  ) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newToast: Toast = { id, type, title, message, duration };

    setToasts((prev) => [...prev, newToast]);

    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const success = useCallback((title: string, message: string, duration?: number) => {
    showToast('success', title, message, duration);
  }, [showToast]);

  const error = useCallback((title: string, message: string, duration?: number) => {
    showToast('error', title, message, duration);
  }, [showToast]);

  const warning = useCallback((title: string, message: string, duration?: number) => {
    showToast('warning', title, message, duration);
  }, [showToast]);

  const info = useCallback((title: string, message: string, duration?: number) => {
    showToast('info', title, message, duration);
  }, [showToast]);

  return {
    toasts,
    showToast,
    removeToast,
    success,
    error,
    warning,
    info
  };
}
