import { errorHandler } from '@/lib/error-handler';

class AnalyticsService {
  private isEnabled: boolean;

  constructor() {
    this.isEnabled = !errorHandler.isWebContainerEnvironment();

    if (!this.isEnabled) {
      console.info('📊 Analytics disabled in preview environment');
    }
  }

  trackEvent(eventName: string, properties?: Record<string, any>): void {
    if (!this.isEnabled) {
      return;
    }

    try {
      console.debug('Analytics event:', eventName, properties);
    } catch (error) {
      errorHandler.logWarning('Analytics tracking failed', 'Analytics');
    }
  }

  trackPageView(pageName: string): void {
    if (!this.isEnabled) {
      return;
    }

    try {
      console.debug('Analytics page view:', pageName);
    } catch (error) {
      errorHandler.logWarning('Analytics page view failed', 'Analytics');
    }
  }

  trackError(error: Error, context?: string): void {
    if (!this.isEnabled) {
      return;
    }

    try {
      console.debug('Analytics error:', context, error.message);
    } catch (err) {
      errorHandler.logWarning('Analytics error tracking failed', 'Analytics');
    }
  }

  identify(userId: string, traits?: Record<string, any>): void {
    if (!this.isEnabled) {
      return;
    }

    try {
      console.debug('Analytics identify:', userId, traits);
    } catch (error) {
      errorHandler.logWarning('Analytics identify failed', 'Analytics');
    }
  }
}

export const analyticsService = new AnalyticsService();
