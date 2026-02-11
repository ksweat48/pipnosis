import React from 'react';

interface FormattedTokenNumberProps {
  value: number;
  className?: string;
  wholeClassName?: string;
  decimalClassName?: string;
}

export function FormattedTokenNumber({
  value,
  className = '',
  wholeClassName = '',
  decimalClassName = '',
}: FormattedTokenNumberProps) {
  const formatted = value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const [wholePart, decimalPart] = formatted.split('.');

  return (
    <div className={`inline-flex items-start ${className}`}>
      <span className={wholeClassName}>{wholePart}</span>
      <span className={`${decimalClassName} ml-0.5`}>.{decimalPart}</span>
    </div>
  );
}
