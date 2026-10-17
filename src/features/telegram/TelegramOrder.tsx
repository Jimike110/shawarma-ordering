import { useParams } from 'react-router-dom';
import { Tracking } from '@/features/orders/Tracking';

export function TelegramOrder() {
  const { handle } = useParams();
  return <Tracking key={handle} telegramHandle={handle ?? ''} />;
}
