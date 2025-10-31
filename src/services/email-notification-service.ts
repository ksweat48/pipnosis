import { supabase } from '../lib/supabase';

export interface EmailNotificationPayload {
  userId: string;
  notificationId: string;
  sessionId: string;
  emailType: 'trade_signal' | 'goal_progress' | 'goal_completion' | 'session_start' | 'alert';
  data: any;
}

class EmailNotificationService {
  async sendNotificationEmail(payload: EmailNotificationPayload): Promise<boolean> {
    try {
      const { data: settings } = await supabase
        .rpc('get_user_email_settings', { p_user_id: payload.userId })
        .maybeSingle();

      if (!settings || !settings.notifications_enabled) {
        console.log('Email notifications disabled for user');
        return false;
      }

      const canSend = await supabase
        .rpc('check_email_rate_limit', {
          p_user_id: payload.userId,
          p_hours: 1,
          p_max_emails: 5
        });

      if (!canSend.data) {
        console.log('Email rate limit exceeded for user');
        return false;
      }

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      const response = await fetch(`${supabaseUrl}/functions/v1/send-goal-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error('Email send request failed:', response.statusText);
        return false;
      }

      const result = await response.json();
      console.log('Email notification sent:', result);
      return true;
    } catch (error) {
      console.error('Error sending email notification:', error);
      return false;
    }
  }

  async sendTradeSignalEmail(
    userId: string,
    sessionId: string,
    notificationId: string,
    signalData: any
  ): Promise<boolean> {
    return this.sendNotificationEmail({
      userId,
      notificationId,
      sessionId,
      emailType: 'trade_signal',
      data: signalData,
    });
  }

  async sendGoalProgressEmail(
    userId: string,
    sessionId: string,
    notificationId: string,
    progressData: any
  ): Promise<boolean> {
    return this.sendNotificationEmail({
      userId,
      notificationId,
      sessionId,
      emailType: 'goal_progress',
      data: progressData,
    });
  }

  async sendGoalCompletionEmail(
    userId: string,
    sessionId: string,
    notificationId: string,
    summaryData: any
  ): Promise<boolean> {
    return this.sendNotificationEmail({
      userId,
      notificationId,
      sessionId,
      emailType: 'goal_completion',
      data: summaryData,
    });
  }

  async updateEmailPreferences(
    userId: string,
    preferences: {
      enabled?: boolean;
      trade_signals?: boolean;
      goal_progress?: boolean;
      goal_completion?: boolean;
      session_start?: boolean;
      high_confidence_only?: boolean;
      min_confidence?: number;
    }
  ): Promise<boolean> {
    try {
      const updates: any = {};

      if (preferences.enabled !== undefined) {
        updates.email_notifications_enabled = preferences.enabled;
      }

      if (Object.keys(preferences).length > 1 || preferences.enabled === undefined) {
        const { data: currentPrefs } = await supabase
          .from('user_profiles')
          .select('email_notification_preferences')
          .eq('id', userId)
          .maybeSingle();

        const currentSettings = currentPrefs?.email_notification_preferences || {};
        updates.email_notification_preferences = {
          ...currentSettings,
          trade_signals: preferences.trade_signals ?? currentSettings.trade_signals,
          goal_progress: preferences.goal_progress ?? currentSettings.goal_progress,
          goal_completion: preferences.goal_completion ?? currentSettings.goal_completion,
          session_start: preferences.session_start ?? currentSettings.session_start,
          high_confidence_only: preferences.high_confidence_only ?? currentSettings.high_confidence_only,
          min_confidence: preferences.min_confidence ?? currentSettings.min_confidence,
        };
      }

      const { error } = await supabase
        .from('user_profiles')
        .update(updates)
        .eq('id', userId);

      if (error) {
        console.error('Error updating email preferences:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error in updateEmailPreferences:', error);
      return false;
    }
  }

  async getEmailPreferences(userId: string): Promise<any> {
    try {
      const { data } = await supabase
        .from('user_profiles')
        .select('email_notifications_enabled, email_notification_preferences')
        .eq('id', userId)
        .maybeSingle();

      return {
        enabled: data?.email_notifications_enabled ?? true,
        preferences: data?.email_notification_preferences || {
          trade_signals: true,
          goal_progress: true,
          goal_completion: true,
          session_start: false,
          high_confidence_only: true,
          min_confidence: 75,
        },
      };
    } catch (error) {
      console.error('Error fetching email preferences:', error);
      return null;
    }
  }

  async getEmailHistory(userId: string, limit: number = 20): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('email_notification_log')
        .select('*')
        .eq('user_id', userId)
        .order('sent_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('Error fetching email history:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error in getEmailHistory:', error);
      return [];
    }
  }
}

export const emailNotificationService = new EmailNotificationService();
