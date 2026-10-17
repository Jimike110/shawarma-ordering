export interface Report {
  orders: number;
  statuses: Record<string, number>;
  completed_value: number;
  average_basket: number;
  preparation_minutes: number;
  preparation_samples: number;
  ready_minutes: number;
  ready_samples: number;
  late_ready: number;
  deadline_samples: number;
  daily: { date: string; orders: number; completed_value: number }[];
  products: { name: string; quantity: number; value: number }[];
  stores: {
    store_id: number;
    orders: number;
    completed_value: number;
    preparation_minutes: number;
    preparation_samples: number;
  }[];
}
