import { useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '@/shared/api/client';
import { usePolling } from '@/shared/hooks/usePolling';
import { Loading, Notice } from '@/shared/ui/Feedback';
import { type PrivacyDocument } from '@/features/privacy/types';

export function Privacy({
  consent = false,
  telegram = false,
}: {
  consent?: boolean;
  telegram?: boolean;
}) {
  const [params] = useSearchParams();
  const version = params.get('version');
  const load = useCallback(
    (signal: AbortSignal) =>
      api<PrivacyDocument>(
        version ? '/privacy/versions/' + encodeURIComponent(version) : '/privacy',
        { signal },
      ),
    [version],
  );
  const { data, loading, error, refresh } = usePolling(load, 60000);
  return (
    <main className="container privacy-page">
      <Link to="/" className="back-link">
        ← В меню
      </Link>
      <h1>
        {telegram
          ? 'Согласие на уведомления в Telegram'
          : consent
            ? 'Согласие на необязательные данные'
            : 'Политика обработки персональных данных'}
      </h1>
      {loading && !data ? (
        <Loading />
      ) : data ? (
        <>
          <p className="muted">
            Публикация №{data.id} ·{' '}
            {new Date(data.published_at).toLocaleDateString('ru-RU', {
              timeZone: 'Europe/Moscow',
            })}{' '}
            · {data.template_version}
          </p>
          <article className="panel privacy-document">
            {telegram
              ? data.telegram_consent || 'Для этой версии согласие Telegram не опубликовано.'
              : consent
                ? data.consent
                : data.policy}
          </article>
          <p>
            <Link to={(consent ? '/privacy' : '/consent') + '?version=' + data.id}>
              {consent ? 'Политика обработки' : 'Отдельное согласие'}
            </Link>
          </p>
        </>
      ) : (
        <>
          <Notice>{error || 'Документы пока не опубликованы.'}</Notice>
          <button className="button" onClick={refresh}>
            Обновить
          </button>
        </>
      )}
      <p className="fine-print">
        Имя и комментарий необязательны. Заказ можно получить по номеру.
      </p>
    </main>
  );
}
