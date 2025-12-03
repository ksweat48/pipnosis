import { supabase } from '@/lib/supabase';

interface SymbolAvailability {
  symbol: string;
  available_for_historical: boolean;
  available_for_realtime: boolean;
  last_checked: string;
  error_message?: string;
  broker_symbol_name?: string;
}

interface ValidationResult {
  symbol: string;
  available: boolean;
  reason?: string;
  brokerName?: string;
}

class SymbolValidatorService {
  private cache: Map<string, ValidationResult> = new Map();
  private cacheExpiry = 24 * 60 * 60 * 1000; // 24 hours

  async validateSymbol(symbol: string): Promise<ValidationResult> {
    const cached = this.cache.get(symbol);
    if (cached) {
      return cached;
    }

    const result = await this.checkSymbolAvailability(symbol);
    this.cache.set(symbol, result);

    await this.saveToDatabase(symbol, result);

    return result;
  }

  async validateMultipleSymbols(symbols: string[]): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];

    for (const symbol of symbols) {
      const result = await this.validateSymbol(symbol);
      results.push(result);
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return results;
  }

  async getAvailableSymbols(symbols: string[]): Promise<string[]> {
    const results = await this.validateMultipleSymbols(symbols);
    return results
      .filter(r => r.available)
      .map(r => r.symbol);
  }

  async getUnavailableSymbols(symbols: string[]): Promise<Array<{ symbol: string; reason: string }>> {
    const results = await this.validateMultipleSymbols(symbols);
    return results
      .filter(r => !r.available)
      .map(r => ({ symbol: r.symbol, reason: r.reason || 'Unknown error' }));
  }

  private async checkSymbolAvailability(symbol: string): Promise<ValidationResult> {
    try {
      const dbResult = await this.checkDatabase(symbol);
      if (dbResult) {
        return dbResult;
      }

      return {
        symbol,
        available: true,
        reason: 'Symbol not yet verified, assuming available'
      };
    } catch (error) {
      console.error(`[SymbolValidator] Error validating ${symbol}:`, error);
      return {
        symbol,
        available: false,
        reason: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async checkDatabase(symbol: string): Promise<ValidationResult | null> {
    try {
      const { data, error } = await supabase
        .from('symbol_availability')
        .select('*')
        .eq('symbol', symbol)
        .single();

      if (error || !data) {
        return null;
      }

      const lastChecked = new Date(data.last_checked);
      const now = new Date();

      if (now.getTime() - lastChecked.getTime() > this.cacheExpiry) {
        return null;
      }

      return {
        symbol: data.symbol,
        available: data.available_for_historical,
        reason: data.error_message,
        brokerName: data.broker_symbol_name
      };
    } catch (error) {
      console.warn('[SymbolValidator] Database check failed:', error);
      return null;
    }
  }

  private async saveToDatabase(symbol: string, result: ValidationResult): Promise<void> {
    try {
      const availability: Partial<SymbolAvailability> = {
        symbol: result.symbol,
        available_for_historical: result.available,
        available_for_realtime: true,
        last_checked: new Date().toISOString(),
        error_message: result.reason,
        broker_symbol_name: result.brokerName
      };

      const { error } = await supabase
        .from('symbol_availability')
        .upsert(availability, {
          onConflict: 'symbol',
          ignoreDuplicates: false
        });

      if (error) {
        console.warn('[SymbolValidator] Failed to save to database:', error);
      }
    } catch (error) {
      console.warn('[SymbolValidator] Database save error:', error);
    }
  }

  clearCache(): void {
    this.cache.clear();
  }

  async refreshSymbolStatus(symbol: string): Promise<ValidationResult> {
    this.cache.delete(symbol);
    return this.validateSymbol(symbol);
  }

  async getKnownWorkingSymbols(): Promise<string[]> {
    try {
      const { data, error } = await supabase
        .from('symbol_availability')
        .select('symbol, available_for_historical')
        .order('symbol');

      if (error || !data || data.length === 0) {
        return this.getDefaultWorkingSymbols();
      }

      const symbols = data.map(row => row.symbol);

      if (symbols.length === 0) {
        return this.getDefaultWorkingSymbols();
      }

      return symbols;
    } catch (error) {
      return this.getDefaultWorkingSymbols();
    }
  }

  private getDefaultWorkingSymbols(): string[] {
    return [
      'XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'
    ];
  }
}

export const symbolValidator = new SymbolValidatorService();
