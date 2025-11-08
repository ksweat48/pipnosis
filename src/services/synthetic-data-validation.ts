import { supabase } from '../lib/supabase';

export class SyntheticDataValidator {
  static async ensureNoMixing(): Promise<void> {
    const { data: mixedCandles, error } = await supabase
      .from('forex_candles')
      .select('id, is_synthetic')
      .eq('is_synthetic', true)
      .limit(1);

    if (mixedCandles && mixedCandles.length > 0) {
      console.error('[CRITICAL] Synthetic data found in production forex_candles table!');
      throw new Error('Data integrity violation: Synthetic data detected in production tables');
    }

    const { data: realSyntheticCandles, error: error2 } = await supabase
      .from('synthetic_candles')
      .select('id, is_synthetic')
      .eq('is_synthetic', false)
      .limit(1);

    if (realSyntheticCandles && realSyntheticCandles.length > 0) {
      console.error('[CRITICAL] Real data found in synthetic_candles table!');
      throw new Error('Data integrity violation: Real data detected in synthetic tables');
    }
  }

  static isSyntheticResult(result: any): boolean {
    return 'isSynthetic' in result && result.isSynthetic === true;
  }

  static validateSyntheticSession(session: any): void {
    if (!session.is_synthetic) {
      throw new Error('Session is not marked as synthetic');
    }

    if (!session.synthetic_generation_id) {
      throw new Error('Synthetic session missing generation ID');
    }
  }

  static async verifySyntheticGeneration(generationId: string, userId: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('synthetic_data_generations')
      .select('id, user_id')
      .eq('id', generationId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) {
      console.error('[Synthetic Validator] Generation not found:', generationId);
      return false;
    }

    return true;
  }

  static getSyntheticBadge(): string {
    return 'SYNTHETIC';
  }

  static getSyntheticWarningMessage(): string {
    return 'This data is synthetic and generated for training purposes only. It does not represent real market conditions.';
  }

  static async cleanupOldSyntheticData(daysOld: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const { data: oldGenerations } = await supabase
      .from('synthetic_data_generations')
      .select('id')
      .lt('created_at', cutoffDate.toISOString());

    if (!oldGenerations || oldGenerations.length === 0) {
      return 0;
    }

    const generationIds = oldGenerations.map(g => g.id);

    await supabase
      .from('synthetic_candles')
      .delete()
      .in('synthetic_session_id', generationIds);

    const { error } = await supabase
      .from('synthetic_data_generations')
      .delete()
      .in('id', generationIds);

    if (error) {
      console.error('[Synthetic Validator] Error cleaning up:', error);
      return 0;
    }

    console.log(`[Synthetic Validator] Cleaned up ${oldGenerations.length} old synthetic generations`);
    return oldGenerations.length;
  }

  static logSyntheticUsage(userId: string, action: string, details: any): void {
    console.log(`[Synthetic Usage] User: ${userId}, Action: ${action}`, details);
  }
}

export const syntheticValidator = new SyntheticDataValidator();
