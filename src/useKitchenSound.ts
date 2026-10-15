import { useCallback, useEffect, useRef, useState } from 'react';

// Browsers may suspend audio until a user gesture. Keep the alert until audio
// actually runs, rather than silently losing an order received before that tap.
export function useKitchenSound() {
  const [enabled, setEnabled] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const audio = useRef<AudioContext | null>(null);
  const buffer = useRef<AudioBuffer | null>(null);
  const playing = useRef<AudioBufferSourceNode | null>(null);
  const enabledRef = useRef(true),
    pending = useRef(false);
  const activateRef = useRef<() => void>(() => {});
  const flush = useCallback(() => {
    const context = audio.current;
    if (!enabledRef.current || !pending.current || !buffer.current || context?.state !== 'running')
      return;
    try {
      playing.current?.stop();
      const source = context.createBufferSource();
      source.buffer = buffer.current;
      source.connect(context.destination);
      source.onended = () => {
        source.disconnect();
        if (playing.current === source) playing.current = null;
      };
      source.start();
      playing.current = source;
      pending.current = false;
    } catch {
      setError(
        'Не удалось воспроизвести сигнал. Проверьте звук устройства. Новые заказы видны в очереди.',
      );
    }
  }, []);
  useEffect(() => {
    let mounted = true;
    let loading: Promise<void> | null = null;
    const controller = new AbortController();
    const failed = () => {
      if (mounted)
        setError(
          'Не удалось включить звук. Нажмите «Активировать звук» и проверьте настройки браузера.',
        );
    };
    const sync = () => {
      if (!mounted) return;
      setReady(audio.current?.state === 'running' && !!buffer.current);
      if (audio.current?.state === 'running' && buffer.current) {
        setError('');
        flush();
      }
    };
    const activate = () => {
      if (!enabledRef.current || !mounted) return;
      try {
        if (!audio.current) {
          audio.current = new AudioContext();
          audio.current.addEventListener('statechange', sync);
        }
        const context = audio.current;
        if (!buffer.current && !loading) {
          loading = fetch('/audio/new-order-313025.mp3', { signal: controller.signal })
            .then((response) => {
              if (!response.ok) throw new Error('Audio unavailable');
              return response.arrayBuffer();
            })
            .then((bytes) => context.decodeAudioData(bytes))
            .then((decoded) => {
              if (!mounted) return;
              buffer.current = decoded;
              sync();
            })
            .catch(() => {
              if (!mounted) return;
              loading = null;
              setReady(false);
              setError(
                'Не удалось загрузить звук заказа. Нажмите «Активировать звук», чтобы повторить.',
              );
            });
        }
        sync();
        // Do not await: browsers can leave this promise pending until a gesture.
        if (context.state !== 'running') void context.resume().then(sync).catch(failed);
      } catch {
        failed();
      }
    };
    activateRef.current = activate;
    const gesture = (event: Event) => {
      // The sound button handles its own gesture, keeping activate/mute distinct.
      if (event.target instanceof Element && event.target.closest('[data-kitchen-sound]')) return;
      activate();
    };
    const visible = () => {
      if (document.visibilityState === 'visible') activate();
    };
    document.addEventListener('click', gesture, true);
    document.addEventListener('keydown', gesture, true);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', activate);
    activate();
    return () => {
      mounted = false;
      controller.abort();
      document.removeEventListener('click', gesture, true);
      document.removeEventListener('keydown', gesture, true);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('focus', activate);
      const context = audio.current;
      playing.current?.stop();
      playing.current = null;
      buffer.current = null;
      audio.current = null;
      context?.removeEventListener('statechange', sync);
      if (context && context.state !== 'closed') void context.close().catch(() => {});
    };
  }, [flush]);
  const alert = useCallback(() => {
    if (!enabledRef.current) return;
    pending.current = true;
    activateRef.current();
    flush();
  }, [flush]);
  const toggle = () => {
    if (enabledRef.current && ready) {
      enabledRef.current = false;
      setEnabled(false);
      pending.current = false;
      playing.current?.stop();
      playing.current = null;
      setError('');
    } else {
      enabledRef.current = true;
      setEnabled(true);
      activateRef.current();
    }
  };
  return { enabled, ready, error, alert, toggle };
}
