/**
 * Active Entry Monitor - DEPRECATED WRAPPER
 *
 * This service now delegates to UnifiedEntryMonitor (SSOT).
 * Kept for backward compatibility during migration.
 *
 * @deprecated Use unifiedEntryMonitor directly
 */

import { unifiedEntryMonitor } from './unified-entry-monitor';
import { EntryPlannerService } from './entry-planner';
import { logger } from '../lib/logger';

export class ActiveEntryMonitor {
  private static instance: ActiveEntryMonitor;

  private constructor() {
    logger.warn('[DEPRECATED] ActiveEntryMonitor is deprecated. Use UnifiedEntryMonitor instead.');
  }

  static getInstance(): ActiveEntryMonitor {
    if (!ActiveEntryMonitor.instance) {
      ActiveEntryMonitor.instance = new ActiveEntryMonitor();
    }
    return ActiveEntryMonitor.instance;
  }

  async startMonitoring(intentId: string, userId: string): Promise<void> {
    logger.debug('[DEPRECATED] ActiveEntryMonitor.startMonitoring -> delegating to UnifiedEntryMonitor');
    return unifiedEntryMonitor.startMonitoring(intentId, userId);
  }

  async stopMonitoring(intentId: string): Promise<void> {
    logger.debug('[DEPRECATED] ActiveEntryMonitor.stopMonitoring -> delegating to UnifiedEntryMonitor');
    return unifiedEntryMonitor.stopMonitoring(intentId);
  }

  stopAllMonitoring(): void {
    logger.debug('[DEPRECATED] ActiveEntryMonitor.stopAllMonitoring -> delegating to UnifiedEntryMonitor');
    return unifiedEntryMonitor.stopAllMonitoring();
  }


  async resumeAllActiveIntents(userId: string): Promise<void> {
    logger.debug('[DEPRECATED] ActiveEntryMonitor.resumeAllActiveIntents -> delegating to UnifiedEntryMonitor');

    try {
      const intents = await EntryPlannerService.getActiveIntents(userId);
      const validIntents = intents.filter(intent => intent.status === 'monitoring');

      for (const intent of validIntents) {
        await unifiedEntryMonitor.startMonitoring(intent.id, userId);
      }

      logger.info(`Resumed monitoring for ${validIntents.length} active intents`);
    } catch (error) {
      logger.error('Error resuming active intents:', error);
    }
  }
}

export const activeEntryMonitor = ActiveEntryMonitor.getInstance();
