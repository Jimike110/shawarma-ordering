import { type ReactNode } from 'react';

const preparationTimes = [5, 10, 15, 20, 30];

export function TimePresets({
  value,
  onChange,
  disabled = false,
  label,
  values = preparationTimes,
  extra,
}: {
  value: number;
  onChange: (minutes: number) => void;
  disabled?: boolean;
  label: string;
  values?: readonly number[];
  extra?: ReactNode;
}) {
  return (
    <div className="time-presets" role="group" aria-label={label}>
      {values.map((minutes) => (
        <button
          type="button"
          key={minutes}
          disabled={disabled}
          aria-pressed={value === minutes}
          onClick={() => onChange(minutes)}
        >
          {minutes} мин
        </button>
      ))}
      {extra}
    </div>
  );
}
