// In-memory store for the bottom-nav screens (Dashboard, Expenses, Groups,
// Utilities, Reports, Settings) — no data library, just a module-level Map.
//
//   useCachedState(screen, key, initial)
//     Same as useState, but the latest value is kept for the session: when the
//     screen is opened again it starts with the previous data (instantly) and
//     the screen's own fetch refreshes it in the background. Updates that land
//     after the screen unmounted are ignored (Supabase calls can't be cancelled).
//
//   useScreenLoad(screen)
//     { loaded, error, offline, showSkeleton, done(), fail(err), retrying() }
//     Skeleton only on the first load of a screen in this session, shown after
//     200 ms (fast loads don't flicker) and kept for at least 300 ms.
import { useCallback, useEffect, useRef, useState } from 'react';

const store = new Map(); // screen → { loaded: boolean, values: { key: value } }

const bucketOf = (screen) => {
  let b = store.get(screen);
  if (!b) { b = { loaded: false, values: {} }; store.set(screen, b); }
  return b;
};

export const isScreenLoaded = (screen) => !!store.get(screen)?.loaded;

export function useCachedState(screen, key, initial) {
  const [value, setValue] = useState(() => {
    const b = store.get(screen);
    if (b?.loaded && key in b.values) return b.values[key];
    return typeof initial === 'function' ? initial() : initial;
  });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { bucketOf(screen).values[key] = value; }, [screen, key, value]);
  const set = useCallback((next) => { if (mounted.current) setValue(next); }, []);
  return [value, set];
}

const SKELETON_DELAY_MS = 200;
const SKELETON_MIN_MS = 300;

export function useScreenLoad(screen) {
  const [loaded, setLoaded] = useState(() => isScreenLoaded(screen));
  const [error, setError] = useState(null);
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const mounted = useRef(true);
  const shownAt = useRef(0);

  useEffect(() => {
    mounted.current = true;
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      mounted.current = false;
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // waiting = first load still running (no stored data, no error yet)
  const waiting = !loaded && !error;
  useEffect(() => {
    if (waiting) {
      const t = setTimeout(() => { shownAt.current = Date.now(); setShowSkeleton(true); }, SKELETON_DELAY_MS);
      return () => clearTimeout(t);
    }
    if (!showSkeleton) return undefined;
    const t = setTimeout(() => setShowSkeleton(false), Math.max(SKELETON_MIN_MS - (Date.now() - shownAt.current), 0));
    return () => clearTimeout(t);
  }, [waiting, showSkeleton]);

  const done = useCallback(() => {
    if (!mounted.current) return;
    bucketOf(screen).loaded = true;
    setLoaded(true);
    setError(null);
  }, [screen]);

  const fail = useCallback((err) => {
    if (!mounted.current) return;
    console.error(`${screen} failed to load:`, err);
    setError(err || new Error('Could not load'));
  }, [screen]);

  // Retry button: back to the (skeleton) loading state
  const retrying = useCallback(() => { if (mounted.current) setError(null); }, []);

  return { loaded, error, offline, showSkeleton, done, fail, retrying };
}
