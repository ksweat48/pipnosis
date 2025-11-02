export interface PasswordValidation {
  isValid: boolean;
  errors: string[];
  strength: 'weak' | 'medium' | 'strong';
}

export function validatePassword(password: string): PasswordValidation {
  const errors: string[] = [];
  let strength: 'weak' | 'medium' | 'strong' = 'weak';

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters');
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  const meetsAllRequirements = password.length >= 8 && /[A-Z]/.test(password) && /[0-9]/.test(password);

  if (meetsAllRequirements) {
    const hasLowerCase = /[a-z]/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);
    const isLong = password.length >= 12;

    if (hasLowerCase && hasSpecialChar && isLong) {
      strength = 'strong';
    } else if (hasLowerCase || password.length >= 10) {
      strength = 'medium';
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    strength,
  };
}

export function passwordsMatch(password: string, confirmPassword: string): boolean {
  return password === confirmPassword && password.length > 0;
}
