import { supabase } from '@/lib/supabase';

class ExtendedSearchService {
  async startExtendedSearch(userId: string, prompt: string, accountBalance: number): Promise<string> {
    try {
      const { data, error } = await supabase
        .from('extended_search_sessions')
        .insert({
          user_id: userId,
          search_criteria: prompt,
          status: 'searching',
          started_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;

      return data.id;
    } catch (error) {
      console.error('Failed to start extended search:', error);
      throw error;
    }
  }
}

export const extendedSearchService = new ExtendedSearchService();
