export interface Product {
  id: number;
  name: string;
  description: string;
  price: number;
  image: string;
  weight: string;
  category: string;
  available: boolean;
  sort_order: number;
  ingredients: string;
  allergens: string;
  options: ProductOption[];
}
export interface ProductOption {
  id: string;
  label: string;
  price: number;
}
export interface OpeningHours {
  day: number;
  open: string;
  close: string;
}
export interface Settings {
  paused: boolean;
  prep_minutes: number;
  pause_message: string;
  shop_name: string;
  address: string;
  city: string;
  phone: string;
  hours_note: string;
  map_url: string;
  opening_hours: OpeningHours[];
  schedule_enabled: boolean;
  demo_mode: boolean;
}
export interface Menu {
  products: Product[];
  settings: Settings;
  accepting_orders: boolean;
  intake_message: string;
  estimated_minutes: number;
}
export interface CartLine {
  product_id: number;
  quantity: number;
  options?: string[];
}
export interface OrderItem {
  product_id: number;
  name: string;
  price: number;
  quantity: number;
  options?: ProductOption[];
}
export type Status = 'new' | 'preparing' | 'ready' | 'completed' | 'cancelled';
export interface Order {
  id?: number;
  number: number;
  name?: string;
  note?: string;
  status: Status;
  total: number;
  items: OrderItem[];
  estimated_ready_at: string;
  created_at: string;
  updated_at: string;
  token?: string;
  cancellation_reason?: string;
}
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
