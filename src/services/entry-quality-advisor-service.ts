/**
 * Entry Quality Advisor Service
 *
 * CCIP GOVERNANCE COMPLIANCE:
 * - SSOT: Entry intents and quality advisories are authoritative (single source)
 * - No business logic here - purely data retrieval for UI display
 * - All analysis calculated in database (immutable, auditable)
 * - Real-time subscriptions trigger advisor updates
 *
 * ARCHITECTURE:
 * - Reads from entry_intents (SSOT for entry data)
 * - Reads from entry_quality_advisories (audit trail for learning)
 * - Calls get_entry_advisory_analysis RPC (SSOT for calculations)
 * - Returns data for EntryPriceMonitor component to display
 */

import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import type { EntryIntent } from '@/types/entry';

export interface EntryQualityAdvisory {
  intent_id: string;
  status: string;
  advisor_mode: 'monitoring' | 'post_execution_advisory';
  quality_grade: 'optimal' | 'good' | 'acceptable' | 'suboptimal' | null;
  retrospective_zone: {
    zone_min: number;
    zone_max: number;
    zone_center: number;
    atr_value: number;
  } | null;
  advisory_data: {
    executed_price: number;
    ideal_entry_price: number;
    distance_from_optimal: number;
    message: string;
  } | null;
}

class EntryQualityAdvisorService {
  /**
   * Get entry quality advisory for a specific intent
   * SSOT: Uses RPC function get_entry_advisory_analysis
   */
  async getAdvisoryForIntent(intentId: string): Promise<EntryQualityAdvisory | null> {
    try {
      const { data, error } = await supabase.rpc('get_entry_advisory_analysis', {
        p_intent_id: intentId
      });

      if (error) {
        logger.error('[EntryAdvisor] Error fetching advisory:', error);
        return null;
      }

      if (!data || data.error) {
        logger.warn('[EntryAdvisor] No advisory found for intent:', intentId);
        return null;
      }

      return data as EntryQualityAdvisory;
    } catch (error) {
      logger.error('[EntryAdvisor] Error getting advisory:', error);
      return null;
    }
  }

  /**
   * Get latest advisory for user's active session
   * GOVERNANCE: Returns audit trail for learning
   */
  async getLatestAdvisoryForSession(sessionId: string, userId: string): Promise<any | null> {
    try {
      const { data, error } = await supabase
        .from('entry_quality_advisories')
        .select('*')
        .eq('session_id', sessionId)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        logger.error('[EntryAdvisor] Error fetching latest advisory:', error);
        return null;
      }

      return data;
    } catch (error) {
      logger.error('[EntryAdvisor] Error getting latest advisory:', error);
      return null;
    }
  }

  /**
   * Generate human-readable advisory message
   * GOVERNANCE: Provides user education on entry quality
   */
  getAdvisoryMessage(
    grade: 'optimal' | 'good' | 'acceptable' | 'suboptimal',
    distanceFromOptimal: number
  ): string {
    const messages: Record<typeof grade, string> = {
      optimal: 'Alpha nailed it! Entry was optimal - within 5 pips of best zone',
      good: 'Alpha executed well - within 10 pips of optimal entry',
      acceptable: 'Acceptable entry - within 20 pips. Marginal improvement possible',
      suboptimal: 'Entry was suboptimal - better prices available after execution'
    };

    return `${messages[grade]} (${Math.abs(distanceFromOptimal).toFixed(1)} pips from optimal center)`;
  }

  /**
   * Get quality grade badge color for UI
   * GOVERNANCE: Visual feedback for user understanding
   */
  getGradeColor(grade: 'optimal' | 'good' | 'acceptable' | 'suboptimal' | null): string {
    switch (grade) {
      case 'optimal':
        return 'from-emerald-500 to-green-500';
      case 'good':
        return 'from-blue-500 to-cyan-500';
      case 'acceptable':
        return 'from-yellow-500 to-orange-500';
      case 'suboptimal':
        return 'from-red-500 to-orange-500';
      default:
        return 'from-gray-500 to-gray-600';
    }
  }

  /**
   * Check if entry intent is advisory mode (post-execution)
   */
  isAdvisoryMode(intent: EntryIntent): boolean {
    return intent.status === 'executed' && intent.advisor_mode === 'post_execution_advisory';
  }

  /**
   * Check if advisory data is ready to display
   */
  isAdvisoryReady(advisory: EntryQualityAdvisory | null): boolean {
    return (
      advisory !== null &&
      advisory.advisor_mode === 'post_execution_advisory' &&
      advisory.quality_grade !== null &&
      advisory.advisory_data !== null
    );
  }

  /**
   * Format advisory for display
   * GOVERNANCE: Non-blocking, purely informational
   */
  formatAdvisoryDisplay(advisory: EntryQualityAdvisory): {
    title: string;
    message: string;
    grade: string;
    distance: number;
    executedPrice: number;
    optimalZone: { min: number; max: number; center: number };
  } | null {
    if (!this.isAdvisoryReady(advisory)) return null;

    const data = advisory.advisory_data!;
    const zone = advisory.retrospective_zone!;

    return {
      title: 'Entry Quality Advisory',
      message: data.message,
      grade: advisory.quality_grade!,
      distance: data.distance_from_optimal,
      executedPrice: data.executed_price,
      optimalZone: {
        min: zone.zone_min,
        max: zone.zone_max,
        center: zone.zone_center
      }
    };
  }
}

export const entryQualityAdvisorService = new EntryQualityAdvisorService();
