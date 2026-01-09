/**
 * EQS (Entry Quality Score) Helper Utilities
 *
 * Centralized utilities for working with EQS scores and grades.
 * Used by entry monitoring system for consistent grading and display.
 */

export type EQSGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

/**
 * Calculate EQS letter grade from numeric score
 */
export function calculateEQSGrade(eqs: number): EQSGrade {
  if (eqs >= 80) return 'A+';
  if (eqs >= 72) return 'A';
  if (eqs >= 65) return 'B';
  if (eqs >= 50) return 'C';
  if (eqs >= 35) return 'D';
  return 'F';
}

/**
 * Get color class for EQS grade (Tailwind CSS)
 */
export function getEQSGradeColor(grade: EQSGrade): string {
  switch (grade) {
    case 'A+':
    case 'A':
      return 'text-green-500';
    case 'B':
      return 'text-blue-500';
    case 'C':
      return 'text-yellow-500';
    case 'D':
      return 'text-orange-500';
    case 'F':
      return 'text-red-500';
  }
}

/**
 * Get background color class for EQS grade (Tailwind CSS)
 */
export function getEQSGradeBgColor(grade: EQSGrade): string {
  switch (grade) {
    case 'A+':
    case 'A':
      return 'bg-green-500/10';
    case 'B':
      return 'bg-blue-500/10';
    case 'C':
      return 'bg-yellow-500/10';
    case 'D':
      return 'bg-orange-500/10';
    case 'F':
      return 'bg-red-500/10';
  }
}

/**
 * Get border color class for EQS grade (Tailwind CSS)
 */
export function getEQSGradeBorderColor(grade: EQSGrade): string {
  switch (grade) {
    case 'A+':
    case 'A':
      return 'border-green-500';
    case 'B':
      return 'border-blue-500';
    case 'C':
      return 'border-yellow-500';
    case 'D':
      return 'border-orange-500';
    case 'F':
      return 'border-red-500';
  }
}

/**
 * Check if EQS grade improved meaningfully
 * Returns true only if letter grade changed (not just score)
 */
export function didGradeImprove(oldEQS: number, newEQS: number): boolean {
  const oldGrade = calculateEQSGrade(oldEQS);
  const newGrade = calculateEQSGrade(newEQS);

  if (oldGrade === newGrade) {
    return false;
  }

  const gradeOrder: EQSGrade[] = ['F', 'D', 'C', 'B', 'A', 'A+'];
  const oldIndex = gradeOrder.indexOf(oldGrade);
  const newIndex = gradeOrder.indexOf(newGrade);

  return newIndex > oldIndex;
}

/**
 * Format EQS score for display
 */
export function formatEQSScore(eqs: number): string {
  return `${Math.round(eqs)}/100`;
}

/**
 * Get human-readable description of EQS grade
 */
export function getEQSGradeDescription(grade: EQSGrade): string {
  switch (grade) {
    case 'A+':
      return 'Excellent - Optimal entry conditions';
    case 'A':
      return 'Very Good - Strong entry setup';
    case 'B':
      return 'Good - Acceptable entry quality';
    case 'C':
      return 'Fair - Marginal entry conditions';
    case 'D':
      return 'Poor - Risky entry timing';
    case 'F':
      return 'Failed - Insufficient entry quality';
  }
}

/**
 * Calculate progress percentage toward required EQS
 */
export function calculateEQSProgress(currentEQS: number, requiredEQS: number): number {
  const progress = (currentEQS / requiredEQS) * 100;
  return Math.min(100, Math.max(0, progress));
}

/**
 * Check if EQS meets or exceeds threshold
 */
export function meetsEQSThreshold(eqs: number, threshold: number): boolean {
  return eqs >= threshold;
}

/**
 * Get the gap between current EQS and required threshold
 */
export function getEQSGap(currentEQS: number, requiredEQS: number): number {
  return Math.max(0, requiredEQS - currentEQS);
}

/**
 * Format time remaining for entry monitor
 */
export function formatTimeRemaining(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (remainingSeconds === 0) {
    return `${minutes}m`;
  }

  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Get emoji icon for EQS grade
 */
export function getEQSGradeEmoji(grade: EQSGrade): string {
  switch (grade) {
    case 'A+':
      return '🌟';
    case 'A':
      return '✨';
    case 'B':
      return '✅';
    case 'C':
      return '⚠️';
    case 'D':
      return '⚠️';
    case 'F':
      return '❌';
  }
}

/**
 * Check if grade is at execution quality
 */
export function isExecutionGrade(grade: EQSGrade, requiredGrade: EQSGrade): boolean {
  const gradeOrder: EQSGrade[] = ['F', 'D', 'C', 'B', 'A', 'A+'];
  const gradeIndex = gradeOrder.indexOf(grade);
  const requiredIndex = gradeOrder.indexOf(requiredGrade);

  return gradeIndex >= requiredIndex;
}
