import { Minus, Plus } from 'lucide-react';

export function Quantity({
  value,
  onChange,
  name,
  disabled = false,
  canIncrease = true,
  max = 20,
  min = 0,
}: {
  value: number;
  onChange: (n: number) => void;
  name: string;
  disabled?: boolean;
  canIncrease?: boolean;
  max?: number;
  min?: number;
}) {
  return (
    <div className="quantity">
      <button
        type="button"
        disabled={disabled || value <= min}
        aria-label={'Уменьшить: ' + name}
        onClick={() => onChange(value - 1)}
      >
        <Minus size={17} />
      </button>
      <span aria-label="Количество">{value}</span>
      <button
        type="button"
        disabled={disabled || !canIncrease || value >= max}
        aria-label={'Добавить: ' + name}
        onClick={() => onChange(value + 1)}
      >
        <Plus size={17} />
      </button>
    </div>
  );
}
