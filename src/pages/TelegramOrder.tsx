import { useParams } from 'react-router-dom';
import { Tracking } from './Tracking';
export function TelegramOrder() {
  const { handle } = useParams();
  return <Tracking key={handle} telegramHandle={handle ?? ''} />;
}
