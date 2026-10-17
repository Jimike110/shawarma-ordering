import { ArrowUpRight, MapPin, Phone, Clock3 } from 'lucide-react';
import { type Settings } from '@/shared/api/types';

const weekdays = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

export function ShopInfo({
  settings,
  compact = false,
}: {
  settings: Settings;
  compact?: boolean;
}) {
  const phone = settings.phone?.replace(/[^+\d]/g, '');
  return (
    <div className={'shop-info ' + (compact ? 'compact' : '')}>
      <div className="pickup">
        <MapPin size={20} />
        <div>
          <b>{settings.address || 'Адрес самовывоза уточняйте у сотрудников'}</b>
          <span>{settings.city} · Только самовывоз</span>
        </div>
        {settings.map_url && (
          <a
            className="text-link"
            href={settings.map_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Маршрут <ArrowUpRight size={15} />
          </a>
        )}
      </div>
      {!compact && (
        <>
          <div className="info-row">
            <Clock3 size={18} />
            <span>
              {settings.hours_note ||
                (settings.schedule_enabled
                  ? 'Часы работы · МСК'
                  : 'Часы работы уточняйте у сотрудников')}
            </span>
          </div>
          {settings.schedule_enabled && (
            <div className="hours-list">
              {[1, 2, 3, 4, 5, 6, 0].map((day) => {
                const hours = settings.opening_hours.find((h) => h.day === day);
                return (
                  <span key={day}>
                    <b>{weekdays[day]}</b> {hours ? hours.open + '–' + hours.close : 'Закрыто'}
                  </span>
                );
              })}
            </div>
          )}
          {phone && (
            <a className="info-row text-link" href={'tel:' + phone}>
              <Phone size={18} />
              {settings.phone}
            </a>
          )}
        </>
      )}
    </div>
  );
}
