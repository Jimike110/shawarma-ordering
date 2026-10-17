import { Component, useEffect, useRef, type ReactNode } from 'react';
import { isRouteErrorResponse, useLocation, useRouteError } from 'react-router-dom';
import { RotateCw, TriangleAlert, UtensilsCrossed } from 'lucide-react';
import '@/app/error.css';

export function RecoveryScreen({
  pathname = window.location.pathname,
  status,
}: {
  pathname?: string;
  status?: number;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const telegram = /^\/tg(?:\/|$)/.test(window.location.pathname);
  const customerPath = pathname.replace(/^\/tg(?=\/|$)/, '') || '/';
  const staff =
    !telegram && (/^\/(owner|staff)(\/|$)/.test(pathname) || pathname === '/kitchen');
  const checkout =
    customerPath === '/checkout' || /^\/s\/[^/]+\/checkout\/?$/.test(customerPath);
  const tracking = customerPath === '/track' || /^\/order\//.test(customerPath);
  const missing = status === 404;
  const denied = status === 401 || status === 403;
  return (
    <main className="recovery-page">
      <section className="recovery-card" aria-labelledby="recovery-title">
        <span className="recovery-mark" aria-hidden="true">
          {missing ? <UtensilsCrossed size={26} /> : <TriangleAlert size={26} />}
        </span>
        <p className="recovery-context">{staff ? 'Панель сотрудников' : 'Заказ с собой'}</p>
        <h1 id="recovery-title" ref={heading} tabIndex={-1}>
          {missing
            ? 'Страница не найдена'
            : denied
              ? 'Не удалось открыть доступ'
              : 'Не удалось открыть страницу'}
        </h1>
        <p>
          {missing
            ? 'Возможно, адрес изменился или в ссылке есть опечатка.'
            : denied
              ? 'Откройте панель и проверьте вход под своей учётной записью.'
              : 'Попробуйте обновить страницу. Если ошибка повторится, вернитесь ' +
                (staff ? 'в панель сотрудников.' : 'в меню.')}
        </p>
        {checkout && (
          <p className="recovery-order-note">
            Если вы уже отправили заказ, сначала проверьте «Мои заказы». Обновление страницы не
            очищает сохранённую попытку отправки.
          </p>
        )}
        {tracking && (
          <p className="recovery-order-note">
            Личная ссылка останется в адресной строке при обновлении страницы.
          </p>
        )}
        <div className="recovery-actions">
          {!missing && (
            <button type="button" className="button" onClick={() => window.location.reload()}>
              <RotateCw size={17} />
              Обновить страницу
            </button>
          )}
          <a className="button secondary" href={staff ? '/kitchen' : telegram ? '/tg/' : '/'}>
            {staff ? 'Открыть панель' : 'Вернуться в меню'}
          </a>
          {!staff && (
            <a className="recovery-history" href={telegram ? '/tg/orders' : '/orders'}>
              Мои заказы
            </a>
          )}
        </div>
        {!missing && (
          <p className="recovery-help">
            Если проблема остаётся, сообщите администратору, на каком экране она возникла.
          </p>
        )}
      </section>
    </main>
  );
}

export function RouteErrorBoundary() {
  const error = useRouteError();
  const { pathname } = useLocation();
  return (
    <RecoveryScreen
      pathname={pathname}
      status={isRouteErrorResponse(error) ? error.status : undefined}
    />
  );
}

// A final independent boundary also covers failures outside router descendants.
// Recovery deliberately does not read contexts, clear storage, or resubmit orders.
export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <RecoveryScreen /> : this.props.children;
  }
}
