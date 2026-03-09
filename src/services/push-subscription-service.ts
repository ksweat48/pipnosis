import { supabase } from '@/lib/supabase';

export interface PushSubscriptionData {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface DeviceInfo {
  id: string;
  deviceName: string;
  userAgent: string;
  isActive: boolean;
  lastUsedAt: string;
  createdAt: string;
}

class PushSubscriptionService {
  private subscriptionCache: PushSubscription | null = null;
  private isInitialized: boolean = false;

  private urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }

    // If this is a DER-encoded SPKI key (starts with 0x30), extract the raw key
    // SPKI format: 0x30 [length] [algorithm info] 0x03 [bitstring length] 0x00 [raw key]
    // We need to skip the header and get just the last 65 bytes (raw EC public key)
    if (outputArray.length > 65 && outputArray[0] === 0x30) {
      // Extract the raw key (last 65 bytes)
      return outputArray.slice(outputArray.length - 65);
    }

    return outputArray;
  }

  private async getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
    if (!('serviceWorker' in navigator)) {
      console.warn('[Push] Service Worker not supported');
      return null;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      return registration;
    } catch (error) {
      console.error('[Push] Error getting service worker registration:', error);
      return null;
    }
  }

  async requestPermission(): Promise<NotificationPermission> {
    if (!('Notification' in window)) {
      console.warn('[Push] Notifications not supported');
      return 'denied';
    }

    if (Notification.permission === 'granted') {
      return 'granted';
    }

    if (Notification.permission === 'denied') {
      return 'denied';
    }

    try {
      const permission = await Notification.requestPermission();
      console.log('[Push] Permission result:', permission);
      return permission;
    } catch (error) {
      console.error('[Push] Error requesting permission:', error);
      return 'denied';
    }
  }

  async getPermissionStatus(): Promise<NotificationPermission> {
    if (!('Notification' in window)) {
      return 'denied';
    }
    return Notification.permission;
  }

  async isSubscribed(): Promise<boolean> {
    try {
      const registration = await this.getServiceWorkerRegistration();
      if (!registration) return false;

      const subscription = await registration.pushManager.getSubscription();
      return subscription !== null;
    } catch (error) {
      console.error('[Push] Error checking subscription status:', error);
      return false;
    }
  }

  async subscribe(deviceName?: string, force = false): Promise<PushSubscription | null> {
    try {
      console.log('[Push] Subscribe called, device:', deviceName, 'force:', force);

      const permission = await this.requestPermission();
      if (permission !== 'granted') {
        console.warn('[Push] Permission not granted:', permission);
        return null;
      }

      console.log('[Push] Permission granted');

      const registration = await this.getServiceWorkerRegistration();
      if (!registration) {
        console.error('[Push] No service worker registration');
        return null;
      }

      console.log('[Push] Service worker ready');

      const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey) {
        console.error('[Push] VAPID public key not configured');
        return null;
      }

      // Check for existing subscription
      let existingSubscription = await registration.pushManager.getSubscription();

      if (existingSubscription && force) {
        console.log('[Push] Force re-subscribe - unsubscribing existing');
        await existingSubscription.unsubscribe();
        existingSubscription = null;
      }

      let subscription: PushSubscription;

      if (existingSubscription) {
        console.log('[Push] Using existing browser subscription');
        subscription = existingSubscription;
      } else {
        console.log('[Push] Creating new browser subscription');
        const convertedVapidKey = this.urlBase64ToUint8Array(vapidPublicKey);
        console.log('[Push] VAPID key length:', convertedVapidKey.length, 'bytes');

        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: convertedVapidKey
        });

        console.log('[Push] New subscription created');
      }

      console.log('[Push] Saving subscription to database...');
      await this.saveSubscription(subscription, deviceName);

      this.subscriptionCache = subscription;
      this.isInitialized = true;

      console.log('[Push] Subscribe complete');
      return subscription;
    } catch (error) {
      console.error('[Push] Error subscribing:', error);
      if (error instanceof Error) {
        console.error('[Push] Error details:', error.message, error.stack);
      }
      return null;
    }
  }

  private async saveSubscription(
    subscription: PushSubscription,
    deviceName?: string
  ): Promise<void> {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) {
        console.error('[Push] Error getting user:', userError);
        return;
      }
      if (!user) {
        console.error('[Push] No user found');
        return;
      }

      console.log('[Push] Saving subscription for user:', user.id);

      const subscriptionJson = subscription.toJSON();
      const endpoint = subscriptionJson.endpoint;
      const p256dhKey = subscriptionJson.keys?.p256dh;
      const authKey = subscriptionJson.keys?.auth;

      if (!endpoint || !p256dhKey || !authKey) {
        console.error('[Push] Invalid subscription data', { endpoint: !!endpoint, p256dhKey: !!p256dhKey, authKey: !!authKey });
        return;
      }

      console.log('[Push] Subscription data valid, endpoint:', endpoint);

      const userAgent = navigator.userAgent;
      const finalDeviceName = deviceName || this.getDefaultDeviceName();

      console.log('[Push] Device name:', finalDeviceName);

      // Use SECURITY DEFINER RPC to atomically claim the endpoint for this user.
      // This handles cross-user device sharing: if another user previously registered
      // this same push endpoint (same browser), the RPC deletes the stale row and
      // inserts fresh for the current user — avoiding RLS USING violations on upsert.
      const { data: claimResult, error: claimError } = await supabase
        .rpc('claim_push_subscription_endpoint', {
          p_user_id: user.id,
          p_endpoint: endpoint,
          p_p256dh_key: p256dhKey,
          p_auth_key: authKey,
          p_device_name: finalDeviceName,
          p_user_agent: userAgent
        });

      if (claimError) {
        console.error('[Push] Error claiming subscription endpoint:', claimError);
      } else if (claimResult && !claimResult.success) {
        console.error('[Push] Claim rejected:', claimResult.error);
      }

    } catch (error) {
      console.error('[Push] Error in saveSubscription:', error);
    }
  }

  private getDefaultDeviceName(): string {
    const userAgent = navigator.userAgent;

    if (userAgent.includes('iPhone')) return 'iPhone';
    if (userAgent.includes('iPad')) return 'iPad';
    if (userAgent.includes('Android')) return 'Android Device';
    if (userAgent.includes('Mac')) return 'Mac';
    if (userAgent.includes('Windows')) return 'Windows PC';
    if (userAgent.includes('Linux')) return 'Linux PC';

    if (userAgent.includes('Chrome')) return 'Chrome Browser';
    if (userAgent.includes('Firefox')) return 'Firefox Browser';
    if (userAgent.includes('Safari')) return 'Safari Browser';
    if (userAgent.includes('Edge')) return 'Edge Browser';

    return 'Device';
  }

  async unsubscribe(): Promise<boolean> {
    try {
      const registration = await this.getServiceWorkerRegistration();
      if (!registration) return false;

      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) return true;

      const endpoint = subscription.endpoint;

      const success = await subscription.unsubscribe();

      if (success) {
        await this.removeSubscription(endpoint);
        this.subscriptionCache = null;
        console.log('[Push] Unsubscribed successfully');
      }

      return success;
    } catch (error) {
      console.error('[Push] Error unsubscribing:', error);
      return false;
    }
  }

  private async removeSubscription(endpoint: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('push_subscriptions')
        .delete()
        .eq('endpoint', endpoint);

      if (error) {
        console.error('[Push] Error removing subscription:', error);
      } else {
        console.log('[Push] Subscription removed from database');
      }
    } catch (error) {
      console.error('[Push] Error in removeSubscription:', error);
    }
  }

  async getDevices(): Promise<DeviceInfo[]> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from('push_subscriptions')
        .select('id, device_name, user_agent, is_active, last_used_at, created_at')
        .eq('user_id', user.id)
        .order('last_used_at', { ascending: false });

      if (error) {
        console.error('[Push] Error fetching devices:', error);
        return [];
      }

      return (data || []).map(device => ({
        id: device.id,
        deviceName: device.device_name || 'Unknown Device',
        userAgent: device.user_agent || '',
        isActive: device.is_active,
        lastUsedAt: device.last_used_at,
        createdAt: device.created_at
      }));
    } catch (error) {
      console.error('[Push] Error in getDevices:', error);
      return [];
    }
  }

  async removeDevice(deviceId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('push_subscriptions')
        .delete()
        .eq('id', deviceId);

      if (error) {
        console.error('[Push] Error removing device:', error);
        return false;
      }

      console.log('[Push] Device removed');
      return true;
    } catch (error) {
      console.error('[Push] Error in removeDevice:', error);
      return false;
    }
  }

  async updateDeviceName(deviceId: string, newName: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('push_subscriptions')
        .update({ device_name: newName })
        .eq('id', deviceId);

      if (error) {
        console.error('[Push] Error updating device name:', error);
        return false;
      }

      console.log('[Push] Device name updated');
      return true;
    } catch (error) {
      console.error('[Push] Error in updateDeviceName:', error);
      return false;
    }
  }

  async getCurrentSubscription(): Promise<PushSubscription | null> {
    if (this.subscriptionCache) {
      return this.subscriptionCache;
    }

    try {
      const registration = await this.getServiceWorkerRegistration();
      if (!registration) return null;

      const subscription = await registration.pushManager.getSubscription();
      this.subscriptionCache = subscription;
      return subscription;
    } catch (error) {
      console.error('[Push] Error getting current subscription:', error);
      return null;
    }
  }

  async sendTestNotification(): Promise<boolean> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.error('[Push] No user found');
        return false;
      }

      const isSubscribed = await this.isSubscribed();
      if (!isSubscribed) {
        console.warn('[Push] Not subscribed to push notifications');
        return false;
      }

      console.log('[Push] Test notification would be sent via Edge Function');

      return true;
    } catch (error) {
      console.error('[Push] Error sending test notification:', error);
      return false;
    }
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      const subscription = await this.getCurrentSubscription();
      if (subscription) {
        await this.saveSubscription(subscription);
        this.isInitialized = true;
      }
    } catch (error) {
      console.error('[Push] Error initializing:', error);
    }
  }
}

export const pushSubscriptionService = new PushSubscriptionService();
