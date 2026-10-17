export interface Product {
  topping_id?: number;
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
  portion?: string;
  available?: boolean;
  topping_id?: number;
}

export interface OpeningHours {
  day: number;
  open: string;
  close: string;
}

export interface Settings {
  latitude?: number | null;
  longitude?: number | null;
  landmark?: string;
  entrance?: string;
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
  store?: Store;
}

export interface Store {
  intake_blockers?: IntakeBlocker[];
  id: number;
  slug: string;
  published: boolean;
  archived: boolean;
  owner_stopped: boolean;
  stop_reason: string;
  settings: Settings;
  role?: 'owner' | 'manager' | 'worker';
  accepting_orders: boolean;
  intake_message: string;
  counts?: Record<string, number>;
}

export type IntakeBlocker =
  | 'archived'
  | 'unpublished'
  | 'privacy_unpublished'
  | 'owner_stopped'
  | 'paused'
  | 'outside_hours';

export interface StaffAccount {
  account_type?: 'person' | 'kitchen';
  kitchen_store_id?: number;
  device_id?: number;
  device_label?: string;
  id: number;
  username: string;
  display_name: string;
  phone: string;
  email: string;
  owner: boolean;
  active: boolean;
  password_required: boolean;
  last_login_at: string | null;
  memberships: { store_id: number; role: 'manager' | 'worker' }[];
}

export interface CartLine {
  product_id: number;
  quantity: number;
  options?: string[];
}

export interface OrderItem {
  portion?: string;
  product_id: number;
  name: string;
  price: number;
  quantity: number;
  options?: ProductOption[];
}

export type Status = 'new' | 'preparing' | 'ready' | 'completed' | 'cancelled';

export interface Order {
  telegram_handle?: string;
  telegram_delivery?: 'pending' | 'sent' | 'failed';
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
  store_id?: number;
  store_slug?: string;
  shop?: Settings;
  cancelled_by?: string;
}
