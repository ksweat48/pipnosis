/**
 * useNotificationPermission
 *
 * SSOT Authority: Single hook for requesting and tracking push notification permission.
 * CCIP Compliant: Non-blocking, graceful degradation, no duplicate requests.
 *
 * Responsibilities:
 * - Request Notification permission once per user (tracks via localStorage)
 * - Subscribe to push notifications via pushSubscriptionService
 * - Expose current permission state for UI feedback
 *
 * Governance:
 * - Only prompts after a user gesture (login) — never on first page load
 * - Respects browser 'denied' state without re-prompting
 * - Permission state is the SSOT — no database query needed to check
 */

import { useEffect, useState } from 'react';
import { pushSubscriptionService } from '../services/push-subscription-service';

type PermissionState = 'unknown' | 'granted' | 'denied' | 'prompt';

const PERMISSION_ASKED_KEY = 'pipnosis_push_permission_asked';

export function useNotificationPermission(userId: string | undefined) {
  const [permissionState, setPermissionState] = useState<PermissionState>('unknown');

  useEffect(() => {
    if (!userId) return;

    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      return;
    }

    const currentPermission = Notification.permission;

    if (currentPermission === 'granted') {
      setPermissionState('granted');
      pushSubscriptionService.subscribe().catch(() => {});
      return;
    }

    if (currentPermission === 'denied') {
      setPermissionState('denied');
      return;
    }

    // Only ask once — don't nag users on every login
    const alreadyAsked = localStorage.getItem(PERMISSION_ASKED_KEY);
    if (alreadyAsked) {
      setPermissionState('prompt');
      return;
    }

    // Defer the permission prompt by 5 seconds after login
    // so it doesn't feel intrusive immediately on load
    const timer = setTimeout(async () => {
      try {
        localStorage.setItem(PERMISSION_ASKED_KEY, '1');
        const result = await Notification.requestPermission();
        setPermissionState(result as PermissionState);

        if (result === 'granted') {
          await pushSubscriptionService.subscribe();
        }
      } catch {
        // Non-blocking — notifications are optional
      }
    }, 5000);

    return () => clearTimeout(timer);
  }, [userId]);

  return permissionState;
}
