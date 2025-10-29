import { supabase } from './supabase';

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

class ConnectionValidator {
  async validateConnection(): Promise<ValidationResult> {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: []
    };

    try {
      const { error } = await supabase.from('user_profiles').select('count').limit(1);

      if (error) {
        result.isValid = false;
        result.errors.push(error.message);
      }
    } catch (err) {
      result.isValid = false;
      result.errors.push(`Connection validation failed: ${err}`);
    }

    return result;
  }
}

export const connectionValidator = new ConnectionValidator();
