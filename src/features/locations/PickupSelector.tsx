import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronDown, MapPin } from 'lucide-react';
import { useMenu } from '@/features/catalog/MenuProvider';
import { rememberPickup, usePickupStores } from '@/features/locations/PickupStoresProvider';
import { PickupPicker } from '@/features/locations/PickupPicker';
import { type Store } from '@/shared/api/types';

export function PickupSelector() {
  const { data: menu } = useMenu();
  const q = usePickupStores();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const open = params.get('pickup') === '1',
    openedHere = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(open);
  useLayoutEffect(() => {
    // Restore after the dialog has closed and the trigger is no longer inert.
    if (wasOpen.current && !open) trigger.current?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open]);
  const current = menu?.store;
  useEffect(() => {
    if (current?.published && !current.archived) rememberPickup(current.slug);
  }, [current?.slug, current?.published, current?.archived]);
  const close = () => {
    if (openedHere.current) {
      openedHere.current = false;
      navigate(-1);
    } else
      setParams(
        (old) => {
          const next = new URLSearchParams(old);
          next.delete('pickup');
          return next;
        },
        { replace: true },
      );
  };
  function choose(store: Store) {
    if (store.id === current?.id) {
      close();
      return;
    }
    rememberPickup(store.slug);
    navigate('/s/' + store.slug, { replace: true, state: { pickupChanged: true } });
  }
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="pickup-selector pickup-selector-button"
        aria-label="Адрес самовывоза"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          openedHere.current = true;
          setParams((old) => {
            const next = new URLSearchParams(old);
            next.set('pickup', '1');
            return next;
          });
        }}
      >
        <MapPin size={19} />
        <span className="pickup-selector-field">
          <small>Самовывоз</small>
          <strong>{current?.settings.address || 'Выбрать точку'}</strong>
        </span>
        <ChevronDown size={16} />
      </button>
      {open &&
        createPortal(
          <PickupDialog close={close}>
            <PickupPicker
              stores={q.data ?? []}
              current={current}
              onChoose={choose}
              close={close}
              error={q.error}
              refresh={q.refresh}
            />
          </PickupDialog>,
          document.body,
        )}
    </>
  );
}

function PickupDialog({ children, close }: { children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => {
      // Close the captured element before React detaches its ref/DOM node.
      dialog.close();
      document.body.style.overflow = previous;
    };
  }, []);
  return (
    <dialog
      className="pickup-dialog"
      ref={ref}
      aria-label="Где заберёте заказ?"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      {children}
    </dialog>
  );
}
