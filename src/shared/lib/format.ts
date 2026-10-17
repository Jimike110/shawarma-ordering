import { type Status } from '@/shared/api/types';

export const statusLabels: Record<Status, string> = {
  new: 'Принят',
  preparing: 'Готовим',
  ready: 'Можно забирать',
  completed: 'Выдан',
  cancelled: 'Отменён',
};

export const rub = (value: number) =>
  new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(value);

export const clock = (value: string) =>
  new Date(value).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  });
